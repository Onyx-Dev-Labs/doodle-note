import AuthenticationServices
import Foundation
import CryptoKit
import Security

struct GoogleCalendarConfiguration: Sendable {
    let clientID: String
    let redirectURI: URL
    init(clientID: String, redirectURI: URL) throws {
        let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
        guard clientID.hasSuffix(".apps.googleusercontent.com"), clientID.count <= 512,
              redirectURI.scheme == scheme, redirectURI.host == nil,
              redirectURI.path == "/oauth2redirect", redirectURI.query == nil, redirectURI.fragment == nil else {
            throw CalendarFailure.unavailable
        }
        self.clientID = clientID
        self.redirectURI = redirectURI
    }
}

struct GoogleAuthorizationAttempt: Sendable {
    let state: String
    let verifier: String
    let configuration: GoogleCalendarConfiguration
    static let readScopes = ["openid", "email", "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
                             "https://www.googleapis.com/auth/calendar.events.readonly"]
    init(configuration: GoogleCalendarConfiguration) throws {
        self.configuration = configuration
        func random() throws -> String {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw CalendarFailure.unavailable }
            return Data(bytes).base64URL
        }
        state = try random()
        verifier = try random()
    }
    var url: URL {
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: Self.readScopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: Data(SHA256.hash(data: Data(verifier.utf8))).base64URL),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent select_account")]
        return components.url!
    }
    func code(from callback: URL) throws -> String {
        guard var parsed = URLComponents(url: callback, resolvingAgainstBaseURL: false), parsed.fragment == nil else {
            throw CalendarFailure.invalidResponse
        }
        let items = parsed.queryItems ?? []
        parsed.query = nil
        guard parsed.url == configuration.redirectURI, Set(items.map(\.name)).count == items.count,
              items.first(where: { $0.name == "state" })?.value == state else { throw CalendarFailure.invalidResponse }
        if items.contains(where: { $0.name == "error" }) { throw CalendarFailure.cancelled }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty, code.count <= 4096 else {
            throw CalendarFailure.invalidResponse
        }
        return code
    }
}

extension Data {
    fileprivate var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Retain one browser per visible presentation owner. Task cancellation terminates the browser session.
@MainActor final class GoogleNativeAuthorization: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let anchor: @MainActor () -> ASPresentationAnchor
    private var session: ASWebAuthenticationSession?
    private var ticket: UUID?
    private var pending: CheckedContinuation<URL, Error>?
    init(anchor: @escaping @MainActor () -> ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor() }
    func open(_ url: URL, callbackScheme: String) async throws -> URL {
        guard pending == nil else { throw CalendarFailure.unavailable }
        let current = UUID()
        ticket = current
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                let browser = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callback, error in
                    Task { @MainActor in
                        if let callback { self?.finish(.success(callback), ticket: current) }
                        else { self?.finish(.failure(error == nil ? CalendarFailure.invalidResponse : CalendarFailure.cancelled), ticket: current) }
                    }
                }
                browser.presentationContextProvider = self
                browser.prefersEphemeralWebBrowserSession = true
                session = browser
                if !browser.start() { finish(.failure(CalendarFailure.unavailable), ticket: current) }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.ticket == current else { return }
                self?.session?.cancel()
                self?.finish(.failure(CalendarFailure.cancelled), ticket: current)
            }
        }
    }
    private func finish(_ result: Result<URL, Error>, ticket: UUID) {
        guard self.ticket == ticket, let pending else { return }
        self.pending = nil
        self.ticket = nil
        session = nil
        pending.resume(with: result)
    }
}
