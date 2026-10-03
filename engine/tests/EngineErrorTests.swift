// swiftc -parse-as-library engine/Sources/engine/EngineError.swift \
//   engine/tests/EngineErrorTests.swift -o /tmp/doodle-error-tests && /tmp/doodle-error-tests
import Foundation
import ScreenCaptureKit

@main
struct EngineErrorTests {
    static func main() {
        let denied = NSError(
            domain: SCStreamError.errorDomain,
            code: SCStreamError.Code.userDeclined.rawValue,
            userInfo: [NSLocalizedDescriptionKey: "The user declined TCCs for application, window, display capture."]
        )
        let message = EngineError.systemAudio(denied).localizedDescription
        precondition(message.hasPrefix("System audio access is off."))
        precondition(message.contains("Screen & System Audio Recording"))
        precondition(!message.contains("TCC") && !message.contains("internalError"))
        // The code alone must not classify an unrelated error as denied access.
        for (domain, code) in [("OtherDomain", denied.code), (SCStreamError.errorDomain, -3803)] {
            let failure = NSError(domain: domain, code: code,
                userInfo: [NSLocalizedDescriptionKey: "Different failure"])
            let text = EngineError.systemAudio(failure).localizedDescription
            precondition(text == "Couldn't start system audio capture. Different failure")
        }
        // Persistent sessions and the one-shot CLI expose the same authored message.
        for failure in [EngineError.internalError("Microphone access is off."), .usage("Choose a source.")] {
            precondition(failure.localizedDescription == failure.message)
        }
        print("PASS: denied access is actionable, unrelated failures stay distinct, authored errors have no Swift wrapper")
    }
}
