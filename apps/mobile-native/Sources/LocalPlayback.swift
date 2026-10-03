import AVFoundation
import Observation

private final class PlaybackObservers {
    var tokens: [NSObjectProtocol] = []
    func clear() { for token in tokens { NotificationCenter.default.removeObserver(token) }; tokens.removeAll() }
    deinit { clear() }
}

@MainActor @Observable
final class LocalPlayback: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    var problem: String?
    private var player: AVAudioPlayer?
    private var plan: AudioTimeline.Plan?
    private var segmentIndex = 0
    private var ownsAudioSession = false
    private let observers = PlaybackObservers()

    private var attemptID: UUID?

    private func installObservers(token: UUID) {
        func observe(_ name: Notification.Name, accept: @escaping @Sendable (Notification) -> Bool = { _ in true }) {
            observers.tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] event in
                guard accept(event) else { return }
                Task { @MainActor in
                    guard let self, self.attemptID == token, self.player != nil else { return }
                    self.problem = "Playback was interrupted. Choose Play to listen again."
                    self.stop()
                }
            })
        }
        observe(AVAudioSession.interruptionNotification) {
            ($0.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
        }
        observe(AVAudioSession.routeChangeNotification) {
            ($0.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
        }
        observe(AVAudioSession.mediaServicesWereLostNotification)
        observe(AVAudioSession.mediaServicesWereResetNotification)
    }

    func play(plan: AudioTimeline.Plan, at seconds: TimeInterval) {
        stop()
        problem = nil
        let token = UUID()
        attemptID = token
        installObservers(token: token)
        do {
            let target = try plan.resolve(seconds)
            self.plan = plan
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            ownsAudioSession = true
            try playSegment(target.index, offset: target.offset)
        } catch { problem = error.localizedDescription; stop() }
    }

    private func playSegment(_ index: Int, offset: TimeInterval = 0) throws {
        guard let plan, plan.segments.indices.contains(index), plan.segments[index].available else {
            throw AudioTimeline.Failure.unavailable
        }
        let segment = plan.segments[index]
        let candidate = try AVAudioPlayer(contentsOf: segment.url)
        segmentIndex = index
        player = candidate
        candidate.delegate = self
        candidate.currentTime = offset
        isPlaying = candidate.play()
        if !isPlaying { throw AudioTimeline.Failure.unavailable }
    }

    func stop() {
        attemptID = nil
        observers.clear()
        player?.stop()
        player = nil
        plan = nil
        isPlaying = false
        if ownsAudioSession {
            ownsAudioSession = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finishedID = ObjectIdentifier(player)
        Task { @MainActor in
            guard let current = self.player, ObjectIdentifier(current) == finishedID, let plan else { return }
            do {
                guard flag else { throw AudioTimeline.Failure.unavailable }
                let next = segmentIndex + 1
                guard plan.segments.indices.contains(next) else { stop(); return }
                guard abs(plan.segments[next].start - plan.segments[segmentIndex].end) < 0.000_001 else {
                    throw AudioTimeline.Failure.unavailable
                }
                try playSegment(next)
            } catch { problem = error.localizedDescription; stop() }
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let failedID = ObjectIdentifier(player)
        Task { @MainActor in
            guard let current = self.player, ObjectIdentifier(current) == failedID else { return }
            problem = "Local audio playback failed. Original files are preserved."
            stop()
        }
    }
}
