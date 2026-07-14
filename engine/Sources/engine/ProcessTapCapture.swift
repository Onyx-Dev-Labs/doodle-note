import AVFoundation
import CoreAudio
import Foundation

/// System-audio capture via Core Audio process taps (macOS 14.2+).
///
/// The ScreenCaptureKit path works but drags in the scariest permission on
/// macOS — "Screen & System Audio Recording". A process tap captures ONLY
/// audio: macOS shows a "record system audio" prompt instead, backed by
/// NSAudioCaptureUsageDescription. Mechanics: create a global mono tap of
/// every process's output, wrap it in a private aggregate device, and read
/// buffers from the aggregate's IOProc. Selectable backend — SCK remains
/// the default until this has soaked in the wild.
@available(macOS 14.2, *)
final class ProcessTapCapture: SystemCaptureBackend {
    private let pipeline: ChannelPipeline
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var tapFormat: AVAudioFormat?
    private let queue = DispatchQueue(label: "engine.tap-audio")

    init(into pipeline: ChannelPipeline) {
        self.pipeline = pipeline
    }

    func start() async throws {
        Events.emit([
            "event": "status", "stage": "requesting_permission", "permission": "system_audio",
        ])

        // 1. Global mono tap of everything (we play no audio ourselves).
        //    Creating the tap is what fires the TCC prompt.
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        description.name = "DoodleNote system audio"
        description.isPrivate = true
        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr, tapID != kAudioObjectUnknown else {
            throw EngineError.internalError(
                "system audio tap failed (\(status)) — permission denied or unsupported")
        }

        // 2. The tap's stream format (sample rate follows the output device).
        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var asbd = AudioStreamBasicDescription()
        var asbdSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        status = AudioObjectGetPropertyData(tapID, &formatAddress, 0, nil, &asbdSize, &asbd)
        guard status == noErr, let format = AVAudioFormat(streamDescription: &asbd) else {
            cleanup()
            throw EngineError.internalError("could not read tap format (\(status))")
        }
        tapFormat = format

        // 3. Private aggregate device wrapping the tap.
        let aggregateUID = UUID().uuidString
        let descriptionDict: [String: Any] = [
            kAudioAggregateDeviceUIDKey: aggregateUID,
            kAudioAggregateDeviceNameKey: "DoodleNote Tap",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [] as [[String: Any]],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                    kAudioSubTapDriftCompensationKey: true,
                ]
            ],
        ]
        status = AudioHardwareCreateAggregateDevice(descriptionDict as CFDictionary, &aggregateID)
        guard status == noErr, aggregateID != kAudioObjectUnknown else {
            cleanup()
            throw EngineError.internalError("tap aggregate device failed (\(status))")
        }

        // 4. Pull buffers off the aggregate and feed the ASR pipeline.
        let pipeline = self.pipeline
        let capturedFormat = format
        status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, queue) {
            _, inputData, _, _, _ in
            guard
                let buffer = AVAudioPCMBuffer(
                    pcmFormat: capturedFormat,
                    bufferListNoCopy: inputData,
                    deallocator: nil),
                let copy = AudioSupport.copy(buffer)
            else { return }
            pipeline.ingest(copy)
        }
        guard status == noErr, ioProcID != nil else {
            cleanup()
            throw EngineError.internalError("tap IOProc failed (\(status))")
        }

        status = AudioDeviceStart(aggregateID, ioProcID)
        guard status == noErr else {
            cleanup()
            throw EngineError.internalError("tap device start failed (\(status))")
        }
        Events.emit([
            "event": "status", "stage": "permission_granted", "permission": "system_audio",
        ])
    }

    func stop() async {
        cleanup()
    }

    private func cleanup() {
        if let procID = ioProcID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
            ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }
}

/// Inaudible proof-of-life for the tap: taps read each process's DIGITAL
/// output stream before the mix, so an ultra-quiet tone (~-62 dB, silent on
/// any speaker) still lands in the capture bit-for-bit. Permission-denied
/// taps deliver exact zeros, so any nonzero peak means the tap is alive.
@available(macOS 14.2, *)
enum TapProbe {
    /// Peak amplitude of the played tone; anything captured above
    /// `threshold` (well over the zero floor, well under the tone) passes.
    static let toneAmplitude: Float = 0.0008
    static let threshold: Float = 0.00005

    /// Play the probe tone for `seconds`. Inaudible by design — do NOT turn
    /// this up; the beep annoyed real users and silence is the whole point.
    static func playTone(seconds: Double) -> (AVAudioEngine, AVAudioPlayerNode)? {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: nil)
        engine.mainMixerNode.outputVolume = 1.0
        let format = engine.mainMixerNode.outputFormat(forBus: 0)
        let frames = AVAudioFrameCount(format.sampleRate * seconds)
        guard let tone = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        tone.frameLength = frames
        for c in 0..<Int(format.channelCount) {
            guard let data = tone.floatChannelData?[c] else { continue }
            for i in 0..<Int(frames) {
                data[i] = sinf(Float(i) * 2 * .pi * 440 / Float(format.sampleRate)) * toneAmplitude
            }
        }
        do {
            try engine.start()
            player.scheduleBuffer(tone, completionHandler: nil)
            player.play()
            return (engine, player)
        } catch {
            Events.log("tap probe tone failed to play: \(error)")
            return nil
        }
    }
}

/// `engine tap-selftest`: prove the tap actually HEARS something before the
/// app trusts it (silently — see TapProbe).
@available(macOS 14.2, *)
enum TapSelfTest {
    struct Verdict {
        let ok: Bool
        let peak: Float
        let reason: String?
    }

    /// Start a throwaway tap, play the inaudible probe, measure what it
    /// heard. Shared by the CLI selftest and launch preflight.
    static func measure() async -> Verdict {
        await runMeasurement()
    }

    static func run() async {
        let verdict = await runMeasurement()
        var payload: [String: Any] = [
            "event": "tap_selftest",
            "ok": verdict.ok,
            "peak": Double(verdict.peak),
        ]
        if let reason = verdict.reason { payload["reason"] = reason }
        Events.emit(payload)
    }

    private static func runMeasurement() async -> Verdict {
        final class Probe: @unchecked Sendable {
            private let lock = NSLock()
            private var peakValue: Float = 0
            var peak: Float {
                lock.lock()
                defer { lock.unlock() }
                return peakValue
            }
            func observe(_ buffer: AVAudioPCMBuffer) {
                var localPeak: Float = 0
                let channels = Int(buffer.format.channelCount)
                for c in 0..<channels {
                    guard let data = buffer.floatChannelData?[c] else { continue }
                    for i in 0..<Int(buffer.frameLength) {
                        localPeak = max(localPeak, abs(data[i]))
                    }
                }
                lock.lock()
                peakValue = max(peakValue, localPeak)
                lock.unlock()
            }
        }

        let probe = Probe()
        let pipeline = ChannelPipeline(channel: "system", probe: probe.observe)
        let tap = ProcessTapCapture(into: pipeline)
        do {
            try await tap.start()
        } catch {
            return Verdict(ok: false, peak: 0, reason: String(describing: error))
        }

        let playback = TapProbe.playTone(seconds: 1.2)

        try? await Task.sleep(nanoseconds: 2_000_000_000)
        playback?.1.stop()
        playback?.0.stop()
        await tap.stop()

        let heard = probe.peak > TapProbe.threshold
        return Verdict(
            ok: heard,
            peak: probe.peak,
            reason: heard
                ? nil
                : "the tap captured only silence — System Audio Recording permission is likely missing"
        )
    }
}
