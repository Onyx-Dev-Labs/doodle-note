import AVFoundation
import Observation

@MainActor @Observable
final class LocalPlayback: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    var problem: String?
    private var player: AVAudioPlayer?
    private var remaining: [URL] = []

    func play(files: [URL], at seconds: TimeInterval = 0) {
        stop()
        problem = nil
        var offset = max(0, seconds)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            for (index, url) in files.enumerated() {
                let candidate = try AVAudioPlayer(contentsOf: url)
                if offset >= candidate.duration { offset -= candidate.duration; continue }
                remaining = Array(files.dropFirst(index + 1))
                player = candidate
                candidate.delegate = self
                candidate.currentTime = offset
                isPlaying = candidate.play()
                if !isPlaying { problem = "The saved audio could not be played." }
                return
            }
            stop()
        } catch { problem = "Playback failed. The audio files are preserved. \(error.localizedDescription)"; stop() }
    }

    func stop() {
        player?.stop()
        player = nil
        remaining = []
        isPlaying = false
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let finishedID = ObjectIdentifier(player)
        Task { @MainActor in
            guard let current = self.player, ObjectIdentifier(current) == finishedID else { return }
            if flag && !remaining.isEmpty { play(files: remaining) }
            else { stop() }
        }
    }
}
