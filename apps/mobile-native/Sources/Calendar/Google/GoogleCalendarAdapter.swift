import Foundation

actor GoogleCalendarAdapter: CalendarProviderAdapter {
    nonisolated let provider = CalendarProvider.google
    private let configuration: GoogleCalendarConfiguration
    private let transport: any GoogleCalendarTransport
    private let browser: @Sendable (URL, String) async throws -> URL
    private var authorizationTicket: UUID?

    init(configuration: GoogleCalendarConfiguration, transport: any GoogleCalendarTransport = GoogleURLTransport(),
         browser: @escaping @Sendable (URL, String) async throws -> URL) {
        self.configuration = configuration
        self.transport = transport
        self.browser = browser
    }

    struct Credential: Codable, Sendable {
        let subject: String
        let clientID: String
        let accessToken: String
        let refreshToken: String
        let expiresAt: Date
    }
    private struct Token: Decodable {
        let access_token: String
        let token_type: String
        let expires_in: Double
        let refresh_token: String?
        let scope: String?
    }
    private struct UserInfo: Decodable { let sub: String; let email: String?; let email_verified: Bool? }

    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        if let existing, existing.provider != .google { throw CalendarFailure.invalidResponse }
        let ticket = UUID()
        authorizationTicket = ticket
        defer { if authorizationTicket == ticket { authorizationTicket = nil } }
        do {
            let attempt = try GoogleAuthorizationAttempt(configuration: configuration)
            let callback = try await browser(attempt.url, configuration.redirectURI.scheme!)
            try current(ticket)
            let code = try attempt.code(from: callback)
            let token: Token = try await request("https://oauth2.googleapis.com/token", form: [
                "client_id": configuration.clientID, "redirect_uri": configuration.redirectURI.absoluteString,
                "code": code, "code_verifier": attempt.verifier, "grant_type": "authorization_code"])
            try current(ticket)
            try validate(token)
            guard let refresh = token.refresh_token, !refresh.isEmpty,
                  Set(GoogleAuthorizationAttempt.readScopes).isSubset(of: grantedScopes(token.scope ?? "")) else {
                throw CalendarFailure.reauthenticationRequired
            }
            let user: UserInfo = try await request("https://openidconnect.googleapis.com/v1/userinfo", bearer: token.access_token)
            try current(ticket)
            guard !user.sub.isEmpty, user.sub.count <= 2048,
                  existing == nil || existing?.subject == user.sub else { throw CalendarFailure.invalidResponse }
            let secret = Credential(subject: user.sub, clientID: configuration.clientID, accessToken: token.access_token,
                refreshToken: refresh, expiresAt: Date().addingTimeInterval(token.expires_in))
            return CalendarAuthorization(account: CalendarAccountKey(provider: .google, subject: user.sub), displayName: user.email_verified == true ? String((user.email ?? "Google account \(user.sub.prefix(16))").prefix(320)) : "Google account \(user.sub.prefix(16))",
                                         credential: CalendarSecret(data: try JSONEncoder().encode(secret)))
        } catch { throw CalendarFailure.safe(error) }
    }
    private func current(_ ticket: UUID) throws {
        guard authorizationTicket == ticket, !Task.isCancelled else { throw CalendarFailure.cancelled }
    }
    private func credential(_ secret: CalendarSecret, for account: CalendarAccountKey) throws -> Credential {
        guard account.provider == .google, let value = try? JSONDecoder().decode(Credential.self, from: secret.data),
              value.subject == account.subject, value.clientID == configuration.clientID,
              !value.accessToken.isEmpty, !value.refreshToken.isEmpty, value.expiresAt.timeIntervalSince1970.isFinite else {
            throw CalendarFailure.reauthenticationRequired
        }
        return value
    }
    private func grantedScopes(_ scope: String) -> Set<String> {
        Set(scope.split(separator: " ").map { $0 == "https://www.googleapis.com/auth/userinfo.email" ? "email" : String($0) })
    }
    private func validate(_ token: Token) throws {
        guard token.token_type.lowercased() == "bearer", !token.access_token.isEmpty, token.access_token.count <= 32_768,
              token.expires_in.isFinite, token.expires_in > 0, token.expires_in <= 86400 else { throw CalendarFailure.invalidResponse }
    }
    func renewCredential(account: CalendarAccountKey, credential secret: CalendarSecret) async throws -> CalendarSecret {
        let old = try credential(secret, for: account)
        guard old.expiresAt.timeIntervalSinceNow < 60 else { return secret }
        let token: Token = try await request("https://oauth2.googleapis.com/token", form: ["client_id": configuration.clientID,
            "refresh_token": old.refreshToken, "grant_type": "refresh_token"])
        try Task.checkCancellation()
        try validate(token)
        if let scope = token.scope,
           !Set(GoogleAuthorizationAttempt.readScopes).isSubset(of: grantedScopes(scope)) {
            throw CalendarFailure.reauthenticationRequired
        }
        let value = Credential(subject: old.subject, clientID: old.clientID, accessToken: token.access_token,
            refreshToken: token.refresh_token ?? old.refreshToken, expiresAt: Date().addingTimeInterval(token.expires_in))
        return CalendarSecret(data: try JSONEncoder().encode(value))
    }

    private struct CalendarList: Decodable {
        struct Item: Decodable { let id: String; let summary: String?; let primary: Bool?; let deleted: Bool?; let accessRole: String? }
        let items: [Item]?
        let nextPageToken: String?
    }
    func calendars(account: CalendarAccountKey, credential secret: CalendarSecret) async throws -> [CalendarDescriptor] {
        let token = try credential(secret, for: account)
        var result: [CalendarDescriptor] = []
        var page: String? = nil
        var seen: Set<String> = []
        repeat {
            var query = [URLQueryItem(name: "maxResults", value: "250"), URLQueryItem(name: "minAccessRole", value: "reader")]
            if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
            let response: CalendarList = try await request("https://www.googleapis.com/calendar/v3/users/me/calendarList", query: query, bearer: token.accessToken)
            for item in response.items ?? [] where item.deleted != true && item.accessRole != "freeBusyReader" {
                guard !item.id.isEmpty else { throw CalendarFailure.invalidResponse }
                result.append(CalendarDescriptor(id: item.id, name: item.summary ?? "Calendar", isDefault: item.primary == true))
            }
            guard result.count <= 1000 else { throw CalendarFailure.invalidResponse }
            page = response.nextPageToken
            if let page { guard !page.isEmpty, seen.insert(page).inserted, seen.count < 100 else { throw CalendarFailure.invalidResponse } }
        } while page != nil
        return result
    }

    private struct Cursor: Codable {
        let subject: String
        let calendars: [String]
        let window: CalendarWindow
        let index: Int
        let page: String?
    }
    private struct EventList: Decodable {
        let timeZone: String?
        let items: [Event]?
        let nextPageToken: String?
    }
    private struct Event: Decodable {
        struct Moment: Decodable { let dateTime: String?; let date: String?; let timeZone: String? }
        let id: String
        let status: String?
        let summary: String?
        struct Attendee: Decodable { let displayName: String?; let email: String?; let resource: Bool? }
        struct Conference: Decodable {
            struct Entry: Decodable { let entryPointType: String?; let uri: String? }
            let entryPoints: [Entry]?
        }
        let attendees: [Attendee]?
        let hangoutLink: String?
        let conferenceData: Conference?
        let recurringEventId: String?
        let originalStartTime: Moment?
        let start: Moment?
        let end: Moment?
    }
    func events(account: CalendarAccountKey, credential secret: CalendarSecret, calendarIDs: Set<String>,
                window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        let token = try credential(secret, for: account)
        _ = try CalendarWindow(start: window.start, end: window.end)
        let calendars = calendarIDs.sorted()
        guard calendars.count <= 1000 else { throw CalendarFailure.invalidResponse }
        guard !calendars.isEmpty else { return CalendarPage(events: [], next: nil) }
        let position: Cursor
        if let cursor {
            guard cursor.count <= 16_384, let data = Data(base64Encoded: cursor),
                  let value = try? JSONDecoder().decode(Cursor.self, from: data), value.subject == account.subject,
                  value.calendars == calendars, value.window == window, calendars.indices.contains(value.index) else {
                throw CalendarFailure.invalidResponse
            }
            position = value
        } else { position = Cursor(subject: account.subject, calendars: calendars, window: window, index: 0, page: nil) }
        let calendar = calendars[position.index]
        let format = ISO8601DateFormatter()
        var query = [URLQueryItem(name: "timeMin", value: format.string(from: window.start)),
            URLQueryItem(name: "timeMax", value: format.string(from: window.end)), URLQueryItem(name: "singleEvents", value: "true"),
            URLQueryItem(name: "showDeleted", value: "true"), URLQueryItem(name: "maxResults", value: "250")]
        if let page = position.page { query.append(URLQueryItem(name: "pageToken", value: page)) }
        guard let encoded = calendar.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw CalendarFailure.invalidResponse }
        let response: EventList = try await request("https://www.googleapis.com/calendar/v3/calendars/\(encoded)/events", query: query, bearer: token.accessToken)
        let events = try (response.items ?? []).filter { $0.status != "cancelled" }.map { event -> CalendarOccurrence in
            guard let start = event.start, let end = event.end else { throw CalendarFailure.invalidResponse }
            if start.date != nil, start.timeZone == nil && response.timeZone == nil { throw CalendarFailure.invalidResponse }
            let zone = start.timeZone ?? response.timeZone ?? "UTC"
            guard TimeZone(identifier: zone) != nil else { throw CalendarFailure.invalidResponse }
            func instant(_ moment: Event.Moment) throws -> Date {
                if let value = moment.dateTime, moment.date == nil { return try CalendarDateNormalizer.instant(value) }
                if let value = moment.date, moment.dateTime == nil { return try CalendarDateNormalizer.day(value, timeZoneID: moment.timeZone ?? zone) }
                throw CalendarFailure.invalidResponse
            }
            let beginning = try instant(start)
            let ending = try instant(end)
            guard ending > beginning, (start.date == nil) == (end.date == nil) else { throw CalendarFailure.invalidResponse }
            let occurrence: String
            if event.recurringEventId != nil {
                guard let original = event.originalStartTime else { throw CalendarFailure.invalidResponse }
                if let day = original.date {
                    _ = try instant(original)
                    occurrence = "date:\(day)"
                } else { occurrence = "instant:\(try instant(original).timeIntervalSince1970)" }
            } else { occurrence = event.id }
            return CalendarOccurrence(key: EventOccurrenceKey(provider: "google", accountID: account.subject,
                calendarID: calendar, eventID: event.recurringEventId ?? event.id, occurrenceID: occurrence),
                title: event.summary ?? "Untitled event", start: beginning, end: ending, timeZoneID: zone, isAllDay: start.date != nil,
                joinURL: event.hangoutLink ?? event.conferenceData?.entryPoints?.first(where: { $0.entryPointType == "video" })?.uri,
                invitees: event.attendees?.filter { $0.resource != true }.prefix(100).compactMap { $0.displayName ?? $0.email }.map { String($0.prefix(320)) })
        }
        let nextPosition: Cursor?
        if let page = response.nextPageToken {
            guard !page.isEmpty, page != position.page, page.count <= 8192 else { throw CalendarFailure.invalidResponse }
            nextPosition = Cursor(subject: account.subject, calendars: calendars, window: window, index: position.index, page: page)
        } else if position.index + 1 < calendars.count {
            nextPosition = Cursor(subject: account.subject, calendars: calendars, window: window, index: position.index + 1, page: nil)
        } else { nextPosition = nil }
        let next = try nextPosition.map { try JSONEncoder().encode($0).base64EncodedString() }
        return CalendarPage(events: events, next: next)
    }

    private func request<T: Decodable>(_ endpoint: String, query: [URLQueryItem] = [], bearer: String? = nil,
                                       form: [String: String]? = nil) async throws -> T {
        try Task.checkCancellation()
        var components = URLComponents(string: endpoint)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let form {
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            let safe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
            request.httpBody = form.sorted { $0.key < $1.key }.map {
                "\($0.key.addingPercentEncoding(withAllowedCharacters: safe)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: safe)!)"
            }.joined(separator: "&").data(using: .utf8)
        }
        do {
            let (data, response) = try await transport.send(request)
            try Task.checkCancellation()
            guard data.count <= 8 * 1024 * 1024, response.url?.host == request.url?.host else { throw CalendarFailure.invalidResponse }
            if response.statusCode == 401 { throw CalendarFailure.reauthenticationRequired }
            let errorObject = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let googleError = errorObject?["error"] as? [String: Any]
            let reasons = (googleError?["errors"] as? [[String: Any]])?.compactMap { $0["reason"] as? String } ?? []
            if response.statusCode == 429 || (response.statusCode == 403 && reasons.contains(where: {
                ["rateLimitExceeded", "userRateLimitExceeded"].contains($0)
            })) {
                let retry = response.value(forHTTPHeaderField: "Retry-After") ?? ""
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
                let seconds = Double(retry) ?? formatter.date(from: retry)?.timeIntervalSinceNow ?? 60
                throw CalendarFailure.rateLimited(retryAt: Date().addingTimeInterval(seconds.isFinite ? min(max(seconds, 1), 86400) : 60))
            }
            if response.statusCode == 403 && reasons.contains(where: { ["authError", "insufficientPermissions"].contains($0) }) {
                throw CalendarFailure.reauthenticationRequired
            }
            if response.statusCode >= 500 { throw CalendarFailure.transient }
            if response.statusCode == 400, let error = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               error["error"] as? String == "invalid_grant" { throw CalendarFailure.reauthenticationRequired }
            guard (200..<300).contains(response.statusCode) else { throw CalendarFailure.unavailable }
            guard let value = try? JSONDecoder().decode(T.self, from: data) else { throw CalendarFailure.invalidResponse }
            return value
        } catch { throw CalendarFailure.safe(error) }
    }
}
