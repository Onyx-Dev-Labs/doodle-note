import AVFoundation

/// A narrow boundary allows interruption/cancellation tests without opening a microphone.
@MainActor protocol CaptureHardware: AnyObject {
    var format: AVAudioFormat { get }
    var notificationObject: AnyObject? { get }
    func start(writer: AudioChunkWriter) throws
    func stop()
    func deactivate()
}

@MainActor final class SystemCaptureHardware: CaptureHardware {
    private let engine = AVAudioEngine()
    private var installed = false
    var format: AVAudioFormat { engine.inputNode.outputFormat(forBus: 0) }
    var notificationObject: AnyObject? { engine }

    init() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.format }
        } catch {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }
    func start(writer: AudioChunkWriter) throws {
        engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in writer.append(buffer) }
        installed = true
        engine.prepare()
        try engine.start()
    }
    func stop() {
        if installed { engine.inputNode.removeTap(onBus: 0); installed = false }
        engine.stop()
    }
    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

#if DEBUG
/// Permission stays pending until a test explicitly responds or cancels preparation.
/// A wall-clock delay can expire while XCTest is still delivering its Cancel tap.
@MainActor final class FixtureCapturePermission {
    private var pending: CheckedContinuation<Bool, Never>?
    func request() async -> Bool {
        await withCheckedContinuation { pending = $0 }
    }
    func allow() {
        let reply = pending
        pending = nil
        reply?.resume(returning: true)
    }
}

/// Silent synthetic fixture; only selected with both explicit UI-test launch flags.
@MainActor final class FixtureCaptureHardware: CaptureHardware {
    let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
    private let source = NSObject()
    var notificationObject: AnyObject? { source }
    private let interrupt: Bool
    private var interruption: Task<Void, Never>?
    init(interrupt: Bool) { self.interrupt = interrupt }
    func start(writer: AudioChunkWriter) throws {
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 32_000)!
        buffer.frameLength = 32_000
        memset(buffer.floatChannelData![0], 0, 32_000 * 4)
        writer.append(buffer)
        if interrupt {
            interruption = Task {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: source)
            }
        }
    }
    func stop() { interruption?.cancel(); interruption = nil }
    func deactivate() {}
}
#endif
