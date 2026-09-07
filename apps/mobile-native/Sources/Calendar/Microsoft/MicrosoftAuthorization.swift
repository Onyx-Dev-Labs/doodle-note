import Foundation
import CryptoKit
import Security

struct MicrosoftCalendarConfiguration: Sendable {
    let clientID: String
    let redirectURI: URL
    init(clientID: String, redirectURI: URL) throws {
        guard UUID(uuidString: clientID) != nil,
              let scheme = redirectURI.scheme, scheme.hasPrefix("msauth."), scheme.count > 7,
              scheme.range(of: #"^msauth\.[A-Za-z0-9.-]+$"#, options: .regularExpression) != nil,
              redirectURI.host == "auth", redirectURI.path.isEmpty, redirectURI.port == nil, redirectURI.password == nil,
              redirectURI.query == nil, redirectURI.fragment == nil, redirectURI.user == nil else {
            throw CalendarFailure.unavailable
        }
        self.clientID = clientID
        self.redirectURI = redirectURI
    }
}

@MainActor protocol MicrosoftAuthorizationBrowser: Sendable {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

/// This private envelope is written only through CalendarCredentialStore, never the calendar cache.
struct MicrosoftCredential: Codable, Sendable {
    let account: CalendarAccountKey
    let clientID: String
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    func secret() throws -> CalendarSecret { CalendarSecret(data: try JSONEncoder().encode(self)) }
    static func read(_ secret: CalendarSecret, account: CalendarAccountKey, clientID: String) throws -> Self {
        guard let value = try? JSONDecoder().decode(Self.self, from: secret.data), value.account == account,
              account.provider == .microsoft, value.clientID == clientID,
              !value.accessToken.isEmpty, !value.refreshToken.isEmpty,
              value.expiresAt.timeIntervalSince1970.isFinite else { throw CalendarFailure.reauthenticationRequired }
        return value
    }
}

struct MicrosoftTokenResponse: Decodable {
    let access_token: String
    let token_type: String
    let expires_in: Double
    let refresh_token: String?
    let id_token: String?
    let scope: String?
}

struct MicrosoftIdentity: Decodable {
    let aud: String
    let iss: String
    let tid: String
    let oid: String
    let exp: Double
    let nbf: Double?
    let nonce: String?
    let name: String?
    let preferred_username: String?

    /// Only called on id_token received directly from the pinned TLS token endpoint.
    /// No callback JWT or Graph access token is decoded for identity.
    static func verifiedEndpointResponse(_ jwt: String, clientID: String, nonce: String?, now: Date) throws -> Self {
        let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let payload = decodeBase64URL(String(parts[1])),
              let identity = try? JSONDecoder().decode(Self.self, from: payload),
              identity.aud == clientID, UUID(uuidString: identity.tid) != nil, UUID(uuidString: identity.oid) != nil,
              identity.iss == "https://login.microsoftonline.com/\(identity.tid)/v2.0",
              identity.exp.isFinite, identity.exp > now.timeIntervalSince1970,
              identity.nbf.map({ $0.isFinite && $0 <= now.timeIntervalSince1970 + 60 }) ?? true,
              nonce == nil || identity.nonce == nonce else { throw CalendarFailure.invalidResponse }
        return identity
    }
    var displayName: String {
        let label = preferred_username.flatMap { $0.isEmpty ? nil : $0 } ?? name ?? "Microsoft account"
        return "\(label.prefix(200)) (\(tid.prefix(8))/\(oid.prefix(8)))"
    }
    var account: CalendarAccountKey { CalendarAccountKey(provider: .microsoft, subject: "\(tid.lowercased())/\(oid.lowercased())") }
}

func decodeBase64URL(_ value: String) -> Data? {
    var encoded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
    return Data(base64Encoded: encoded)
}
func microsoftBase64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

struct MicrosoftCalendarAdapter: CalendarProviderAdapter {
    let provider = CalendarProvider.microsoft
    let configuration: MicrosoftCalendarConfiguration
    let browser: any MicrosoftAuthorizationBrowser
    let transport: any MicrosoftHTTPTransport
    let now: @Sendable () -> Date
    static let scopes = "openid profile offline_access https://graph.microsoft.com/Calendars.ReadBasic"

    init(configuration: MicrosoftCalendarConfiguration, browser: any MicrosoftAuthorizationBrowser,
         transport: any MicrosoftHTTPTransport = MicrosoftURLSessionTransport(),
         now: @escaping @Sendable () -> Date = { Date() }) {
        self.configuration = configuration; self.browser = browser; self.transport = transport; self.now = now
    }

    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        guard existing == nil || existing?.provider == .microsoft else { throw CalendarFailure.invalidResponse }
        let verifier = try random(), state = try random(), nonce = try random()
        var url = URLComponents(string: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize")!
        url.queryItems = ["client_id": configuration.clientID, "redirect_uri": configuration.redirectURI.absoluteString,
            "response_type": "code", "response_mode": "query", "scope": Self.scopes, "state": state,
            "nonce": nonce, "prompt": "select_account", "code_challenge_method": "S256",
            "code_challenge": microsoftBase64URL(Data(SHA256.hash(data: Data(verifier.utf8))))]
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        do {
            try Task.checkCancellation()
            let callback = try await browser.authenticate(url: url.url!, callbackScheme: configuration.redirectURI.scheme!)
            try Task.checkCancellation()
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            var base = URLComponents(url: callback, resolvingAgainstBaseURL: false)
            base?.query = nil
            guard base?.url == configuration.redirectURI, callback.fragment == nil,
                  Set(items.map(\.name)).count == items.count,
                  items.first(where: { $0.name == "state" })?.value == state else { throw CalendarFailure.invalidResponse }
            if items.contains(where: { $0.name == "error" }) { throw CalendarFailure.reauthenticationRequired }
            guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty, code.utf8.count <= 65536 else {
                throw CalendarFailure.invalidResponse
            }
            let response = try await tokens(["grant_type": "authorization_code", "code": code,
                "redirect_uri": configuration.redirectURI.absoluteString, "code_verifier": verifier])
            guard let jwt = response.id_token, let refresh = response.refresh_token, !refresh.isEmpty else {
                throw CalendarFailure.invalidResponse
            }
            let identity = try MicrosoftIdentity.verifiedEndpointResponse(jwt, clientID: configuration.clientID, nonce: nonce, now: now())
            guard existing == nil || existing == identity.account else { throw CalendarFailure.invalidResponse }
            try Task.checkCancellation()
            return CalendarAuthorization(account: identity.account, displayName: identity.displayName,
                credential: try envelope(response, account: identity.account, refresh: refresh).secret())
        } catch { throw CalendarFailure.safe(error) }
    }

    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret {
        let old = try MicrosoftCredential.read(credential, account: account, clientID: configuration.clientID)
        if old.expiresAt > now().addingTimeInterval(120) { return credential }
        let response = try await tokens(["grant_type": "refresh_token", "refresh_token": old.refreshToken])
        if let jwt = response.id_token {
            let identity = try MicrosoftIdentity.verifiedEndpointResponse(jwt, clientID: configuration.clientID, nonce: nil, now: now())
            guard identity.account == account else { throw CalendarFailure.invalidResponse }
        }
        return try envelope(response, account: account, refresh: response.refresh_token ?? old.refreshToken).secret()
    }

    private func envelope(_ response: MicrosoftTokenResponse, account: CalendarAccountKey, refresh: String) throws -> MicrosoftCredential {
        guard !refresh.isEmpty else { throw CalendarFailure.invalidResponse }
        return MicrosoftCredential(account: account, clientID: configuration.clientID,
            accessToken: response.access_token, refreshToken: refresh, expiresAt: now().addingTimeInterval(response.expires_in))
    }

    private func tokens(_ fields: [String: String]) async throws -> MicrosoftTokenResponse {
        var request = URLRequest(url: URL(string: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = MicrosoftHTTP.form(fields.merging(["client_id": configuration.clientID, "scope": Self.scopes]) { _, new in new })
        let response = try await transport.send(request)
        if response.status == 400 { throw CalendarFailure.reauthenticationRequired }
        try MicrosoftHTTP.check(response, now: now())
        guard let tokens = try? JSONDecoder().decode(MicrosoftTokenResponse.self, from: response.data),
              tokens.token_type.lowercased() == "bearer", !tokens.access_token.isEmpty, tokens.access_token.utf8.count <= 65536,
              tokens.refresh_token.map({ $0.utf8.count <= 65536 }) ?? true, tokens.id_token.map({ $0.utf8.count <= 65536 }) ?? true,
              tokens.expires_in.isFinite, tokens.expires_in > 0, tokens.expires_in <= 7 * 86400,
              tokens.scope.map({ $0.split(separator: " ").contains { $0 == "Calendars.ReadBasic" || $0 == "https://graph.microsoft.com/Calendars.ReadBasic" } }) ?? true else {
            throw CalendarFailure.invalidResponse
        }
        return tokens
    }

    private func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw CalendarFailure.unavailable }
        return microsoftBase64URL(Data(bytes))
    }
}
