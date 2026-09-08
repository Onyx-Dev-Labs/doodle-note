import AVFoundation
import UIKit
import Observation

@MainActor @Observable
final class RecordingSession {
    private(set) var noteID: UUID?
    private(set) var preparingNoteID: UUID?
    private(set) var busy = false
    private(set) var startedAt: Date?
    private(set) var lastReport: AudioChunkWriter.Report?
    var problem: String?
    let speech = LocalSpeech()
    let speakers = StreamingSpeakers()
    let voices: VoiceProfiles
    private var hardware: (any CaptureHardware)?
    private var writer: AudioChunkWriter?
    private var captureFailed = false
    private var canceled = false
    private var previousTranscriptComplete = false
    private var speechStarted = false
    #if DEBUG
    private var fixturePermission: FixtureCapturePermission?
    func allowFixtureCapture() { fixturePermission?.allow() }
    #endif
    private var attemptID: UUID?
    private var observers: [NSObjectProtocol] = []
    private let recordPermission: @MainActor () async -> Bool
    private let makeHardware: @MainActor () throws -> any CaptureHardware
    private let analysisEnabled: Bool
    private let writerFault: @Sendable (AudioChunkWriter.Stage) throws -> Void
    var permitsPlayback: Bool { noteID == nil && !busy }

    init(recordPermission: @escaping @MainActor () async -> Bool = {
        await AVAudioApplication.requestRecordPermission()
    }, makeHardware: @escaping @MainActor () throws -> any CaptureHardware = { try SystemCaptureHardware() },
         analysisEnabled: Bool = true,
         writerFault: @escaping @Sendable (AudioChunkWriter.Stage) throws -> Void = { _ in },
         voiceRoot: URL = URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteNative/VoiceProfiles")) {
        voices = VoiceProfiles(root: voiceRoot)
        #if DEBUG
        if CommandLine.arguments.contains("--ui-testing") && CommandLine.arguments.contains("--capture-fixture") {
            let permission = FixtureCapturePermission()
            self.fixturePermission = permission
            self.recordPermission = { await permission.request() }
            self.makeHardware = { FixtureCaptureHardware(interrupt: CommandLine.arguments.contains("--capture-interruption-fixture")) }
            self.analysisEnabled = false
        } else {
            self.recordPermission = recordPermission
            self.makeHardware = makeHardware
            self.analysisEnabled = analysisEnabled
        }
        #else
        self.recordPermission = recordPermission
        self.makeHardware = makeHardware
        self.analysisEnabled = analysisEnabled
        #endif
        self.writerFault = writerFault
    }

    private func valid(_ token: UUID, _ id: UUID, _ library: NoteLibrary) -> Bool {
        attemptID == token && !canceled && library.note(id) != nil && !library.storageBusy
    }

    func start(_ id: UUID, library: NoteLibrary) async {
        guard noteID == nil, !busy, !library.storageBusy, !library.loading,
              let note = library.note(id), let disk = library.disk else { return }
        let token = UUID()
        attemptID = token
        preparingNoteID = id
        busy = true
        canceled = false
        captureFailed = false
        lastReport = nil
        problem = nil
        Task { await voices.refresh() }
        defer { preparingNoteID = nil; busy = false }
        guard await recordPermission() else {
            if !canceled { problem = CaptureError.microphone.localizedDescription }
            attemptID = nil
            return
        }
        guard valid(token, id, library) else { attemptID = nil; return }
        var finishPendingFeeds: (() -> Void)?
        do {
            let hardware = try makeHardware()
            self.hardware = hardware
            installObservers(hardware, library: library, token: token)
            let offset = try disk.recordingOffset(for: id)
            previousTranscriptComplete = offset == 0 || note.metadata?.cloudTranscriptStatus == .complete
            let speechFeed = analysisEnabled ? await speech.start(language: note.language, offset: offset) { [weak self] passage in
                guard self?.attemptID == token else { return }
                library.update(id) { if !$0.apply(passage) { $0.transcriptNeedsReview = true } }
            } : nil
            speechStarted = speechFeed != nil
            finishPendingFeeds = { speechFeed?.1.finish() }
            guard valid(token, id, library) else {
                speechFeed?.1.finish()
                await abandon(id, library: library)
                return
            }
            let speakerFeed = analysisEnabled ? await speakers.start(offset: offset) { [weak self] sessionID, turns in
                guard self?.attemptID == token else { return }
                library.update(id) { note in
                    var annotations = note.speakerAnnotations ?? SpeakerAnnotations()
                    annotations.replace(sessionID: sessionID, with: turns)
                    note.speakerAnnotations = annotations
                }
            } : nil
            finishPendingFeeds = { speechFeed?.1.finish(); speakerFeed?.finish() }
            guard valid(token, id, library), library.update(id, {
                $0.captureState = .recording
                $0.metadata?.cloudTranscriptStatus = .partial
                $0.speechSessions = ($0.speechSessions ?? []) + [.init(id: token, start: offset, end: nil, language: note.language)]
            }) else {
                speechFeed?.1.finish(); speakerFeed?.finish()
                await abandon(id, library: library)
                return
            }
            guard await library.flush(noteID: id), valid(token, id, library) else {
                speechFeed?.1.finish(); speakerFeed?.finish()
                await abandon(id, library: library)
                return
            }
            // All awaits and cancellation checks precede filesystem creation and engine start.
            let directory = try disk.audioDirectory(for: id)
            let writer = AudioChunkWriter(directory: directory,
                speechFormat: speechFeed?.0, speechInput: speechFeed?.1, speakerInput: speakerFeed,
                onCaptureError: { [weak self] message in
                    Task { @MainActor in
                        guard let self, self.attemptID == token else { return }
                        self.problem = message
                        self.captureFailed = true
                        await self.stop(library: library, interrupted: true)
                    }
                }, onSpeechError: { [weak self] message in
                    Task { @MainActor in
                        guard self?.attemptID == token else { return }
                        self?.speech.fail(message)
                    }
                }, onSpeakerError: { [weak self] message in
                    Task { @MainActor in
                        guard self?.attemptID == token else { return }
                        self?.speakers.fail(message)
                    }
                }, fault: writerFault, timelineStart: offset)
            self.writer = writer
            finishPendingFeeds = nil
            self.noteID = id
            try hardware.start(writer: writer)
            startedAt = Date()
        } catch {
            finishPendingFeeds?()
            problem = "Recording could not start. \(error.localizedDescription)"
            await abandon(id, library: library)
        }
    }

    private func abandon(_ id: UUID, library: NoteLibrary) async {
        clearObservers()
        hardware?.stop()
        let closingWriter = writer
        if let closingWriter { lastReport = await closingWriter.finish() }
        writer = nil
        hardware?.deactivate(); hardware = nil
        if library.note(id)?.captureState == .recording {
            library.update(id) { $0.captureState = .interrupted; $0.metadata?.cloudTranscriptStatus = .interrupted }
            await library.flush()
        }
        if let closingWriter { _ = await closingWriter.finishAnalysis() }
        await speech.finish(); await speakers.finish()
        noteID = nil; startedAt = nil; attemptID = nil
    }

    func stop(library: NoteLibrary, interrupted: Bool = false) async {
        if busy {
            if preparingNoteID != nil {
                canceled = true
                #if DEBUG
                fixturePermission?.allow()
                #endif
                problem = interrupted ? "Recording preparation was interrupted. Choose Record to try again." : "Recording preparation canceled."
            }
            if interrupted { captureFailed = true }
            return
        }
        guard let id = noteID else { return }
        busy = true
        defer { busy = false }
        clearObservers()
        hardware?.stop()
        let closingWriter = writer
        let report = await closingWriter?.finish()
        lastReport = report
        writer = nil
        if let report, !report.complete {
            captureFailed = true
            problem = "Recording stopped with incomplete audio. \(report.failures.joined(separator: " "))"
        }
        library.update(id) { $0.captureState = (interrupted || captureFailed) ? .interrupted : .finished }
        if !(await library.flush(noteID: id)) {
            problem = "Audio capture stopped, but its note status could not be saved. Keep the app open and retry saving."
            library.update(id) { $0.captureState = .interrupted; $0.metadata?.cloudTranscriptStatus = .interrupted }
            await library.flush(noteID: id)
        }
        hardware?.deactivate(); hardware = nil
        if let closingWriter, !(await closingWriter.finishAnalysis()) {
            speech.fail("Transcription processing timed out. Source audio is preserved.")
            speakers.fail("Speaker processing timed out. Source audio is preserved.")
        }
        let speechComplete = await speech.finish()
        await speakers.finish()
        if let annotations = library.note(id)?.speakerAnnotations, let sessionID = annotations.turns.last?.sessionID {
            applySpeakers(annotations.turns.filter { $0.sessionID == sessionID }, sessionID: sessionID, id: id, library: library)
        }
        let endpoint = try? library.disk?.recordingOffset(for: id)
        library.update(id) { note in
            note.metadata?.cloudTranscriptStatus = !interrupted && !captureFailed && previousTranscriptComplete && speechStarted && speechComplete && note.transcriptNeedsReview != true && note.passages.allSatisfy(\.isFinal) ? .complete : .interrupted
            if let index = note.speechSessions?.firstIndex(where: { $0.id == attemptID }) {
                note.speechSessions?[index].end = endpoint
            }
        }
        if !(await library.flush(noteID: id)), problem == nil {
            problem = "Transcription is incomplete. Saved audio and corrections are preserved."
        }
        noteID = nil; startedAt = nil; attemptID = nil
    }

    private func applySpeakers(_ turns: [SpeakerTurn], sessionID: UUID, id: UUID, library: NoteLibrary) {
        library.update(id) { note in
            var annotations = note.speakerAnnotations ?? SpeakerAnnotations()
            annotations.replace(sessionID: sessionID, with: turns)
            if let disk = library.disk, let plan = try? disk.playbackTimeline(for: id) {
                let snapshot = annotations
                SpeakerIdentity.reconcile(&annotations, selected: voices.selectedProfiles) { key in
                    SpeakerIdentity.probe(for: key, annotations: snapshot, plan: plan)
                }
            }
            note.speakerAnnotations = annotations
        }
    }

    private func installObservers(_ hardware: any CaptureHardware, library: NoteLibrary, token: UUID) {
        func observe(_ name: Notification.Name, object: AnyObject? = nil,
                     accept: @escaping @Sendable (Notification) -> Bool = { _ in true }) {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] event in
                guard accept(event) else { return }
                Task { @MainActor in
                    guard let self, self.attemptID == token else { return }
                    self.problem = "Recording was interrupted. Saved audio is retained. Choose Resume to continue."
                    await self.stop(library: library, interrupted: true)
                }
            })
        }
        observe(AVAudioSession.interruptionNotification) {
            ($0.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
        }
        observe(.AVAudioEngineConfigurationChange, object: hardware.notificationObject)
        observe(AVAudioSession.routeChangeNotification) {
            guard let raw = $0.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return false }
            return reason == .oldDeviceUnavailable || reason == .newDeviceAvailable || reason == .noSuitableRouteForCategory
        }
        observe(UIApplication.didBecomeActiveNotification) { _ in
            AVAudioApplication.shared.recordPermission == .denied
        }
        observe(AVAudioSession.mediaServicesWereLostNotification)
        observe(AVAudioSession.mediaServicesWereResetNotification)
    }

    private func clearObservers() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
    }
}
