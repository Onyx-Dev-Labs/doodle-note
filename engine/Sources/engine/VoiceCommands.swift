import AVFoundation
import FluidAudio
import Foundation

/// `engine enroll-voice --out <voiceprint.json> [--seconds N] [--input-device <uid>]`
///
/// Records the user reading aloud and stores what their voice sounds like — an
/// embedding and a level, never the audio — for dictation's "Only my voice".
/// Emits `level` events while recording, then one
/// `{"event":"voiceprint","ok":…}` verdict and `done`.
///
/// With --exit-on-stdin-close, stdin lines are commands: {"cmd":"finish"} ends
/// the recording early and keeps it; stdin closing cancels (nothing is saved).
/// `--file <audio>` builds the voiceprint from a recording instead of the mic.
enum EnrollVoiceCommand {
    static func run(_ options: CLIOptions) async throws {
        guard let out = options.values["out"] else {
            throw EngineError.usage("enroll-voice requires --out <voiceprint path>")
        }

        let loading = Task {
            let gate = PercentGate()
            return try await VoiceModels.shared.load { progress in
                if let pct = gate.advance(progress.fractionCompleted) {
                    Events.emit(["event": "download", "progress": Double(pct) / 100.0])
                }
            }
        }

        var samples: [Float]
        var deviceUID: String?
        var deviceName: String?
        if options.values["file"] != nil {
            samples = try AudioConverter().resampleAudioFile(try options.requireFile())
        } else {
            let granted = await MicrophoneAuthorization.authorize(willRequest: {
                Events.emit(["event": "status", "stage": "requesting_permission", "permission": "microphone"])
            })
            guard granted else {
                Events.emit(["event": "voiceprint", "ok": false, "reason": "microphone"])
                Events.emit(["event": "done"])
                return
            }
            deviceUID = AudioInputDevices.resolvedInputUID(options.values["input-device"])
            deviceName = deviceUID.flatMap { AVCaptureDevice(uniqueID: $0)?.localizedName }

            let recording = VoiceRecording()
            let capture = MicCapture(into: recording, enableAEC: false, deviceUID: deviceUID)
            let stopper = Stopper()
            if options.flags.contains("exit-on-stdin-close") {
                watchStdin(finish: { stopper.stop() }, closed: { capture.stop() })
            }
            LevelReporter.shared.setEnabled(true)
            try capture.start()
            Events.emit(["event": "ready", "mode": "enroll"])
            await stopper.wait(timeoutSeconds: options.values["seconds"].flatMap(Double.init) ?? 20)
            capture.stop()
            LevelReporter.shared.setEnabled(false)
            samples = recording.take()
        }

        Events.emit(["event": "status", "stage": "analysing_voice"])
        do {
            let analyzer = SpeakerAnalyzer(models: try await loading.value)
            let voice = try VoiceEnrollment.voiceprint(from: samples, analyzer: analyzer)
            try Voiceprint(
                embedding: voice.embedding, levelDb: voice.levelDb, speechSeconds: voice.speechSeconds,
                deviceUid: deviceUID, deviceName: deviceName,
                createdAtMs: (Date().timeIntervalSince1970 * 1000).rounded()
            ).save(path: out)
            var verdict: [String: Any] = [
                "event": "voiceprint", "ok": true,
                "speechSeconds": voice.speechSeconds, "levelDb": Double(voice.levelDb),
            ]
            if let deviceName { verdict["deviceName"] = deviceName }
            Events.emit(verdict)
        } catch VoiceEnrollment.Failure.notEnoughSpeech(let seconds) {
            Events.emit([
                "event": "voiceprint", "ok": false, "reason": "not_enough_speech",
                "speechSeconds": seconds,
            ])
        } catch {
            Events.log("voice enrollment failed: \(error)")
            Events.emit(["event": "voiceprint", "ok": false, "reason": "failed"])
        }
        Events.emit(["event": "done"])
    }

    private static func watchStdin(finish: @escaping () -> Void, closed: @escaping () -> Void) {
        Thread {
            var buffer = Data()
            while true {
                let chunk = FileHandle.standardInput.availableData
                if chunk.isEmpty { break }
                buffer.append(chunk)
                while let newline = buffer.firstIndex(of: 0x0A) {
                    let line = buffer.subdata(in: buffer.startIndex..<newline)
                    buffer.removeSubrange(buffer.startIndex...newline)
                    if let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                        object["cmd"] as? String == "finish"
                    {
                        finish()
                    }
                }
            }
            // The host went away or cancelled: release the microphone, keep nothing.
            closed()
            exit(0)
        }.start()
    }
}

/// Collects the enrollment recording in memory (it is never written to disk).
private final class VoiceRecording: MicSink, @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [Float] = []
    private let converter = AudioConverter()

    func ingest(_ buffer: AVAudioPCMBuffer) {
        guard let chunk = try? converter.resampleBuffer(buffer) else { return }
        LevelReporter.shared.report(chunk.reduce(0) { max($0, abs($1)) })
        lock.lock()
        samples.append(contentsOf: chunk)
        lock.unlock()
    }

    func take() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        return samples
    }
}

/// `engine voice-check --file <audio> --voiceprint <json> [--out <gated.wav>]`
///
/// Replays a recording through the "Only my voice" gate exactly as live
/// dictation would, for tuning: decisions go to stderr, the totals to one
/// `voice_check` event, and --out writes what the recognizer would have heard.
enum VoiceCheckCommand {
    static func run(_ options: CLIOptions) async throws {
        guard let path = options.values["voiceprint"] else {
            throw EngineError.usage("voice-check requires --voiceprint <path>")
        }
        let samples = try AudioConverter().resampleAudioFile(try options.requireFile())
        let voice = try Voiceprint.load(path: path)
        let gate = VoiceGate(
            analyzer: SpeakerAnalyzer(models: try await VoiceModels.shared.load(), voice: voice.embedding),
            // Levels only compare on the enrollment microphone; say so explicitly.
            enrolledLevelDb: options.flags.contains("same-microphone") ? voice.levelDb : nil,
            log: { Events.log($0) })

        let started = Date()
        var gated: [Float] = []
        var offset = 0
        while offset < samples.count {
            let end = min(samples.count, offset + 1_600)
            gated.append(contentsOf: gate.push(Array(samples[offset..<end])))
            offset = end
        }
        gated.append(contentsOf: gate.finish())
        let elapsed = Date().timeIntervalSince(started)

        if let out = options.values["out"] {
            let buffer = try AudioSupport.makePCMBuffer(gated)
            let file = try AVAudioFile(
                forWriting: URL(fileURLWithPath: out), settings: buffer.format.settings)
            try file.write(from: buffer)
        }
        var report: [String: Any] = [
            "event": "voice_check",
            "audioSeconds": Double(samples.count) / Double(VoiceGate.sampleRate),
            "keptMs": gate.stats.keptMs, "droppedMs": gate.stats.droppedMs,
            "failures": gate.stats.failures, "processingSeconds": elapsed,
            "samplesOut": gated.count, "samplesIn": samples.count,
        ]
        if let nearest = gate.stats.minDistance { report["minDistance"] = Double(nearest) }
        if let farthest = gate.stats.maxDistance { report["maxDistance"] = Double(farthest) }
        Events.emit(report)
    }
}
