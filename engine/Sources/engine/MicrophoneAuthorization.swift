import AVFoundation

enum MicrophoneAuthorization {
    /// Re-read the OS on every use; setup completion is never an authorization cache.
    /// Injectable calls let tests cover TCC transitions without changing real permissions.
    static func authorize(
        status: () -> AVAuthorizationStatus = { AVCaptureDevice.authorizationStatus(for: .audio) },
        request: () async -> Bool = { await AVCaptureDevice.requestAccess(for: .audio) },
        willRequest: () -> Void = {}
    ) async -> Bool {
        switch status() {
        case .authorized:
            return true
        case .notDetermined:
            willRequest()
            return await request()
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}
