import AVFoundation
import FluidAudio
import Foundation
import ScreenCaptureKit

/// Run once at app launch so meetings start instantly:
/// - triggers the microphone and screen/system-audio permission prompts
///   (attributed to the host app) before the user ever hits record
/// - loads the streaming ASR model once, downloading it if missing and
///   priming the CoreML compilation cache for subsequent sessions
/// Exits without capturing anything — the mic is never opened.
enum PreflightCommand {
    static func run() async {
        let micGranted = await AVCaptureDevice.requestAccess(for: .audio)
        Events.emit(["event": "status", "stage": "preflight_mic", "granted": micGranted])

        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            Events.emit(["event": "status", "stage": "preflight_screen", "granted": true])
        } catch {
            Events.emit(["event": "status", "stage": "preflight_screen", "granted": false])
            Events.log("preflight: screen/system-audio not granted yet: \(error)")
        }

        do {
            let gate = PercentGate()
            let manager = StreamingUnifiedAsrManager()
            Events.emit(["event": "status", "stage": "preflight_models"])
            try await manager.loadModels(progressHandler: { progress in
                if let pct = gate.advance(progress.fractionCompleted) {
                    Events.emit(["event": "download", "progress": Double(pct) / 100.0])
                }
            })
            await manager.cleanup()
            Events.emit(["event": "ready", "mode": "preflight"])
        } catch {
            Events.error("preflight model load failed: \(error)")
        }
    }
}
