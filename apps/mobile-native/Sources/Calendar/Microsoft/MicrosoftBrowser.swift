import AuthenticationServices

@MainActor protocol MicrosoftBrowserSession: AnyObject {
    func start() -> Bool
    func cancel()
}

@MainActor private final class MicrosoftNativeSession: MicrosoftBrowserSession {
    let session: ASWebAuthenticationSession
    init(url: URL, scheme: String, provider: any ASWebAuthenticationPresentationContextProviding,
         completion: @escaping @Sendable (URL?, Error?) -> Void) {
        session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme, completionHandler: completion)
        session.presentationContextProvider = provider
        session.prefersEphemeralWebBrowserSession = true
    }
    func start() -> Bool { session.start() }
    func cancel() { session.cancel() }
}

@MainActor final class MicrosoftSystemBrowser: NSObject, MicrosoftAuthorizationBrowser, ASWebAuthenticationPresentationContextProviding {
    private let anchor: @MainActor () -> ASPresentationAnchor
    typealias Factory = @MainActor (URL, String, any ASWebAuthenticationPresentationContextProviding, @escaping @Sendable (URL?, Error?) -> Void) -> any MicrosoftBrowserSession
    private let makeSession: Factory
    private var session: (any MicrosoftBrowserSession)?
    private var pending: CheckedContinuation<URL, Error>?
    private var attempt: UUID?

    init(anchor: @escaping @MainActor () -> ASPresentationAnchor, makeSession: Factory? = nil) {
        self.anchor = anchor
        self.makeSession = makeSession ?? { MicrosoftNativeSession(url: $0, scheme: $1, provider: $2, completion: $3) }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor() }

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try Task.checkCancellation()
        guard attempt == nil else { throw CalendarFailure.unavailable }
        let id = UUID()
        attempt = id
        return try await withTaskCancellationHandler {
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                let session = makeSession(url, callbackScheme, self) { [weak self] url, error in
                    Task { @MainActor [weak self] in
                        self?.finish(id, url: url, error: error)
                    }
                }
                self.session = session
                if !session.start() { finish(id, url: nil, error: CalendarFailure.unavailable) }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(id, url: nil, error: CalendarFailure.cancelled) }
        }
    }

    private func finish(_ id: UUID, url: URL?, error: Error?) {
        guard attempt == id else { return }
        attempt = nil
        let continuation = pending
        pending = nil
        let previous = session
        session = nil
        previous?.cancel()
        if let url, error == nil { continuation?.resume(returning: url) }
        else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            continuation?.resume(throwing: CalendarFailure.cancelled)
        } else { continuation?.resume(throwing: error as? CalendarFailure ?? .unavailable) }
    }
}
