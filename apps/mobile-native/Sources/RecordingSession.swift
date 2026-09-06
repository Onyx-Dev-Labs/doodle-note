import AVFoundation
import Observation

@MainActor @Observable
final class RecordingSession {
    private(set) var noteID: UUID?
    private(set) var busy = false
    private(set) var startedAt: Date?
    var problem: String?
    let speech = LocalSpeech()
    let speakers = StreamingSpeakers()
    private var engine: AVAudioEngine?
    private var writer: AudioChunkWriter?
    private var captureFailed = false
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private let recordPermission: @MainActor () async -> Bool
    var permitsPlayback: Bool { noteID == nil && !busy }

    init(recordPermission: @escaping @MainActor () async -> Bool = {
        await AVAudioApplication.requestRecordPermission()
    }) { self.recordPermission = recordPermission }

    func start(_ id: UUID, library: NoteLibrary) async {
        guard noteID == nil, !busy, let note = library.note(id), let disk = library.disk else { return }
        busy = true
        captureFailed = false
        defer { busy = false }
        guard await recordPermission() else {
            problem = CaptureError.microphone.localizedDescription
            return
        }
        do {
            let directory = try disk.audioDirectory(for: id)
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try audioSession.setActive(true)
            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.format }
            let offset = try disk.audioFiles(for: id).reduce(0.0) { total, url in
                let file = try AVAudioFile(forReading: url)
                return total + Double(file.length) / file.processingFormat.sampleRate
            }
            let speechFeed = await speech.start(language: note.language, offset: offset) { passage in
                library.update(id) { $0.apply(passage) }
            }
            let speakerFeed = await speakers.start(offset: offset) { sessionID, turns in
                library.update(id) { note in
                    var annotations = note.speakerAnnotations ?? SpeakerAnnotations()
                    annotations.replace(sessionID: sessionID, with: turns)
                    note.speakerAnnotations = annotations
                }
            }
            guard library.update(id, { $0.captureState = .recording }) else {
                speechFeed?.1.finish()
                speakerFeed?.finish()
                await speech.finish()
                await speakers.finish()
                try? audioSession.setActive(false)
                return
            }
            let writer = AudioChunkWriter(directory: directory,
                speechFormat: speechFeed?.0, speechInput: speechFeed?.1, speakerInput: speakerFeed,
                onCaptureError: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.noteID == id else { return }
                        self.problem = message
                        self.captureFailed = true
                        await self.stop(library: library, interrupted: true)
                    }
                }, onSpeechError: { [weak self] message in
                    Task { @MainActor in self?.speech.fail(message) }
                }, onSpeakerError: { [weak self] message in
                    Task { @MainActor in self?.speakers.fail(message) }
                })
            self.writer = writer
            self.engine = engine
            self.noteID = id
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in writer.append(buffer) }
            engine.prepare()
            try engine.start()
            startedAt = Date()
            interruptionObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] event in
                    guard let raw = event.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                          raw == AVAudioSession.InterruptionType.began.rawValue else { return }
                    Task { @MainActor in await self?.stop(library: library, interrupted: true) }
                }
            routeObserver = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                    Task { @MainActor in await self?.stop(library: library, interrupted: true) }
                }
        } catch {
            problem = "Recording could not start. \(error.localizedDescription)"
            busy = false
            if noteID != nil { await stop(library: library, interrupted: true) }
            else { try? AVAudioSession.sharedInstance().setActive(false) }
        }
    }

    func stop(library: NoteLibrary, interrupted: Bool = false) async {
        guard let id = noteID, !busy else { return }
        busy = true
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
        interruptionObserver = nil
        routeObserver = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        await writer?.finish()
        writer = nil
        library.update(id) { $0.captureState = (interrupted || captureFailed) ? .interrupted : .finished }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        await speech.finish()
        await speakers.finish()
        noteID = nil
        startedAt = nil
        busy = false
    }
}
