import Foundation
import ScreenCaptureKit

enum EngineError: LocalizedError {
    case usage(String)
    case internalError(String)

    var message: String {
        switch self {
        case .usage(let message), .internalError(let message): return message
        }
    }

    var errorDescription: String? { message }

    static func systemAudio(_ error: Error) -> EngineError {
        let failure = error as NSError
        if failure.domain == SCStreamError.errorDomain,
            failure.code == SCStreamError.Code.userDeclined.rawValue
        {
            return .internalError(
                "System audio access is off. Open System Settings → Privacy & Security → "
                    + "Screen & System Audio Recording and enable DoodleNote. "
                    + "Then quit and reopen the app to try recording again."
            )
        }
        return .internalError("Couldn't start system audio capture. \(error.localizedDescription)")
    }
}
