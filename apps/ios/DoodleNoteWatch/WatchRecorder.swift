import AVFoundation
import SwiftUI
import WatchKit

@MainActor @Observable
final class WatchRecorder: NSObject, AVAudioRecorderDelegate {
    private(set) var current: WatchRecording?
    private(set) var preparing = false
    var error: String?
    private var recorder: AVAudioRecorder?
    private let store: WatchRecordingStore
    private let saved: () -> Void

    init(store: WatchRecordingStore, saved: @escaping () -> Void) {
        self.store = store
        self.saved = saved
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
            name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
            name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        recover()
    }

    func start() async {
        guard current == nil, !preparing else { return }
        preparing = true
        error = nil
        defer { preparing = false }
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            error = "Allow microphone access in Settings to record a meeting."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            // watchOS does not support setPreferredInput. Bluetooth routing
            // options are omitted so this uses the built-in microphone.
            try FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
            let capacity = try store.directory.resourceValues(forKeys: [.volumeAvailableCapacityKey])
            if let available = capacity.volumeAvailableCapacity, available < 64_000_000 {
                throw CocoaError(.fileWriteOutOfSpace)
            }
            let recording = WatchRecording()
            try store.save(recording)
            let audio = try AVAudioRecorder(url: store.audioURL(recording.id), settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ])
            audio.delegate = self
            guard audio.record(forDuration: 86_400) else { throw CocoaError(.fileWriteUnknown) }
            recorder = audio
            current = recording
            WKInterfaceDevice.current().play(.start)
        } catch {
            self.error = "Could not start recording: \(error.localizedDescription)"
            try? AVAudioSession.sharedInstance().setActive(false)
        }
    }

    func stop() {
        guard var recording = current, let recorder else { return }
        recorder.stop()
        if let file = try? AVAudioFile(forReading: store.audioURL(recording.id)), file.length > 0 {
            recording.duration = Double(file.length) / file.processingFormat.sampleRate
        }
        current = nil
        self.recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        do {
            recording.status = recording.duration > 0 ? .ready : .interrupted
            try store.save(recording)
            WKInterfaceDevice.current().play(.stop)
            saved()
        } catch {
            self.error = "Audio is saved, but its details could not be updated. Reopen Doodle Note to recover it."
        }
    }

    @objc private func interrupted(_ notification: Notification) {
        if notification.name == AVAudioSession.interruptionNotification,
           notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt != AVAudioSession.InterruptionType.began.rawValue { return }
        guard current != nil else { return }
        stop()
        error = "Recording was interrupted. The audio captured so far has been saved."
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            self.stop()
            self.error = "Recording stopped because of an audio error. Check the saved recording on your iPhone."
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            guard self.recorder === recorder else { return }
            self.stop()
            if !flag { self.error = "Recording ended unexpectedly. The captured audio has been saved." }
        }
    }

    private func recover() {
        do {
            for var recording in try store.recordings() where recording.status == .recording {
                if let file = try? AVAudioFile(forReading: store.audioURL(recording.id)), file.length > 0 {
                    recording.duration = Double(file.length) / file.processingFormat.sampleRate
                    recording.status = .ready
                } else { recording.status = .interrupted }
                try store.save(recording)
            }
        } catch { self.error = "Saved recordings could not be read. Your audio files are still on this watch." }
    }
}
