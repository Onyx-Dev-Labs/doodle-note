import AVFoundation
import FluidAudio
import Foundation
import ScreenCaptureKit

/// Full preflight is explicit onboarding; background launch uses models-only
/// warmup so it never probes audio hardware or requests recording permissions.
enum PreflightCommand {
    static func run(modelsOnly: Bool = false) async {
        if !modelsOnly {
            await checkPermissions()
        }
        await warmModels()
    }

    private static func checkPermissions() async {
        let micGranted = await MicrophoneAuthorization.authorize()
        Events.emit(["event": "status", "stage": "preflight_mic", "granted": micGranted])

        // System audio: the tap needs only the audio-capture permission —
        // preflight fires THAT prompt, so new users never see "screen
        // recording". Pre-14.2 keeps the old ScreenCaptureKit poke.
        if #available(macOS 14.2, *) {
            let verdict = await TapSelfTest.measure()
            Events.emit(["event": "status", "stage": "preflight_screen", "granted": verdict.ok])
            if !verdict.ok { Events.log("preflight: system-audio tap not working yet: \(verdict.reason ?? "silent")") }
        } else {
            do {
                _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                Events.emit(["event": "status", "stage": "preflight_screen", "granted": true])
            } catch {
                Events.emit(["event": "status", "stage": "preflight_screen", "granted": false])
                Events.log("preflight: screen/system-audio not granted yet: \(error)")
            }
        }
    }

    private static func warmModels() async {
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
