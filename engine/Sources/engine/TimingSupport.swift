import FluidAudio
import Foundation

/// Token timings → compact JSON payloads. These are what lets the notes layer
/// build timestamped transcript segments (transcript_segments.start_ms/end_ms)
/// and, later, word-level speaker attribution.
enum Timings {
    static func payload(_ timings: [TokenTiming]) -> [[String: Any]] {
        timings.map { t in
            [
                "token": t.token,
                "startSec": round3(t.startTime),
                "endSec": round3(t.endTime),
                "confidence": round3(Double(t.confidence)),
            ]
        }
    }

    private static func round3(_ value: Double) -> Double {
        (value * 1000).rounded() / 1000
    }
}
