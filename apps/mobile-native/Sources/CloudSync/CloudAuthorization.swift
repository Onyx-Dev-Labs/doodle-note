import AuthenticationServices
import CryptoKit
import Foundation
import Security

enum CloudSyncFailure: LocalizedError {
    case unavailable, invalidResponse, signedOut, permission, subscription, changed, unsupported, cancelled
    var errorDescription: String? {
        switch self {
        case .unavailable: "Cloud sync is unavailable. Your saved notes remain on this device."
        case .invalidResponse: "The cloud response could not be verified. Try connecting again."
        case .signedOut: "Connect the same account to reopen its saved notes."
        case .permission: "This account no longer has access to that workspace."
        case .subscription: "Cloud sync is paused. Local notes remain available. Manage your subscription on the website."
        case .changed: "This note changed. Review its versions before continuing."
        case .unsupported: "This note uses a newer format. Update DoodleNote before editing it."
        case .cancelled: "Connection cancelled."
        }
    }
}

/// No token appears in a Codable note, outbox, diagnostic, or callback description.
struct CloudSecret: Sendable {
    let value: String
    init(_ value: String) throws {
        guard value.range(of: "^dn(sy|id)_[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw CloudSyncFailure.invalidResponse
        }
        self.value = value
    }
    var identityOnly: Bool { value.hasPrefix("dnid_") }
}

struct CloudLinkAttempt: Sendable {
    let state: String
    let baseURL: URL
    init(baseURL: URL = URL(string: "https://www.doodlenote.ai")!) throws {
        guard baseURL.scheme == "https", baseURL.host != nil, baseURL.user == nil,
              baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/" else { throw CloudSyncFailure.invalidResponse }
        self.baseURL = baseURL
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw CloudSyncFailure.unavailable
        }
        state = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    var url: URL {
        var components = URLComponents(url: baseURL.appendingPathComponent("link-device"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "scheme", value: "doodlenote"),
                                URLQueryItem(name: "name", value: "DoodleNote iPhone / iPad"),
                                URLQueryItem(name: "state", value: state)]
        return components.url!
    }
    func secret(from callback: URL) throws -> CloudSecret {
        guard let parsed = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parsed.scheme == "doodlenote", parsed.host == "link", parsed.path.isEmpty,
              parsed.port == nil, parsed.user == nil, parsed.password == nil, parsed.fragment == nil else {
            throw CloudSyncFailure.invalidResponse
        }
        let items = parsed.queryItems ?? []
        guard Set(items.map(\.name)).count == items.count,
              Set(items.map(\.name)).isSubset(of: ["token", "email", "workspace", "state"]),
              items.first(where: { $0.name == "state" })?.value == state,
              let token = items.first(where: { $0.name == "token" })?.value else {
            throw CloudSyncFailure.invalidResponse
        }
        // Email and workspace display labels in the callback are not authentication identity.
        return try CloudSecret(token)
    }
}

@MainActor final class CloudLinkBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let anchor: @MainActor () -> ASPresentationAnchor
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    private var generation: UUID?
    init(anchor: @escaping @MainActor () -> ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor() }
    func open(_ attempt: CloudLinkAttempt) async throws -> CloudSecret {
        guard continuation == nil else { throw CloudSyncFailure.unavailable }
        let ticket = UUID()
        generation = ticket
        let callback: URL = try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { pending in
                continuation = pending
                let browser = ASWebAuthenticationSession(url: attempt.url, callbackURLScheme: "doodlenote") { [weak self] url, _ in
                    Task { @MainActor in
                        self?.finish(url.map(Result.success) ?? .failure(CloudSyncFailure.cancelled), ticket: ticket)
                    }
                }
                browser.presentationContextProvider = self
                browser.prefersEphemeralWebBrowserSession = true
                session = browser
                if !browser.start() { finish(.failure(CloudSyncFailure.unavailable), ticket: ticket) }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                guard self?.generation == ticket else { return }
                self?.session?.cancel()
                self?.finish(.failure(CloudSyncFailure.cancelled), ticket: ticket)
            }
        }
        return try attempt.secret(from: callback)
    }
    private func finish(_ result: Result<URL, Error>, ticket: UUID) {
        guard generation == ticket, let continuation else { return }
        self.continuation = nil
        generation = nil
        session = nil
        continuation.resume(with: result)
    }
}
