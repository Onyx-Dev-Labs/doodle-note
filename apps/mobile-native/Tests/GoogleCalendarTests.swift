import XCTest
import CryptoKit
@testable import DoodleNoteNative

actor GoogleFixtureTransport: GoogleCalendarTransport {
    struct Reply: Sendable { let body: String; var status = 200; var headers: [String: String] = [:] }
    var replies: [Reply]
    var requests: [URLRequest] = []
    init(_ replies: [Reply]) { self.replies = replies }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        guard !replies.isEmpty else { throw CalendarFailure.offline }
        let reply = replies.removeFirst()
        return (Data(reply.body.utf8), HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!)
    }
}

final class GoogleCalendarTests: XCTestCase {
    func config() throws -> GoogleCalendarConfiguration {
        try GoogleCalendarConfiguration(clientID: "fixture.apps.googleusercontent.com", redirectURI: URL(string: "com.googleusercontent.apps.fixture:/oauth2redirect")!)
    }
    func adapter(_ replies: [GoogleFixtureTransport.Reply]) throws -> (GoogleCalendarAdapter, GoogleFixtureTransport) {
        let transport = GoogleFixtureTransport(replies)
        let value = GoogleCalendarAdapter(configuration: try config(), transport: transport) { url, _ in
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
            let state = items.first { $0.name == "state" }!.value!
            return URL(string: "com.googleusercontent.apps.fixture:/oauth2redirect?state=\(state)&code=fixture-code")!
        }
        return (value, transport)
    }
    func secret(subject: String = "A", expired: Bool = false) throws -> CalendarSecret {
        let value = GoogleCalendarAdapter.Credential(subject: subject, clientID: "fixture.apps.googleusercontent.com", accessToken: "fixture-access",
            refreshToken: "fixture-refresh", expiresAt: expired ? .distantPast : Date().addingTimeInterval(3600))
        return CalendarSecret(data: try JSONEncoder().encode(value))
    }
    let account = CalendarAccountKey(provider: .google, subject: "A")
    func window() throws -> CalendarWindow {
        try CalendarWindow(start: CalendarDateNormalizer.instant("2026-09-01T00:00:00Z"), end: CalendarDateNormalizer.instant("2026-09-15T00:00:00Z"))
    }
    func token(subject: String) -> [GoogleFixtureTransport.Reply] {
        let scopes = GoogleAuthorizationAttempt.readScopes.joined(separator: " ")
        return [.init(body: "{\"access_token\":\"fixture-access\",\"refresh_token\":\"fixture-refresh\",\"expires_in\":3600,\"token_type\":\"Bearer\",\"scope\":\"\(scopes)\"}"),
                .init(body: "{\"sub\":\"\(subject)\"}")]
    }
    func testNativeConfigurationAndPKCE() throws {
        XCTAssertThrowsError(try GoogleCalendarConfiguration(clientID: "", redirectURI: URL(string: "http://localhost/callback")!))
        let attempt = try GoogleAuthorizationAttempt(configuration: config())
        let next = try GoogleAuthorizationAttempt(configuration: config())
        XCTAssertNotEqual(attempt.state, next.state)
        XCTAssertNotEqual(attempt.verifier, next.verifier)
        XCTAssertEqual(attempt.verifier.count, 43)
        let items = URLComponents(url: attempt.url, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(items.first { $0.name == "code_challenge_method" }?.value, "S256")
        let hash = Data(SHA256.hash(data: Data(attempt.verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(items.first { $0.name == "code_challenge" }?.value, hash)
        XCTAssertFalse(items.contains { $0.name == "client_secret" })
    }
    func testCallbackExactRedirectStateAndDuplicates() throws {
        let attempt = try GoogleAuthorizationAttempt(configuration: config())
        let callback = "com.googleusercontent.apps.fixture:/oauth2redirect?state=\(attempt.state)&code=good"
        XCTAssertEqual(try attempt.code(from: URL(string: callback)!), "good")
        for invalid in [callback + "&code=duplicate", callback + "#fragment", callback.replacingOccurrences(of: attempt.state, with: "wrong"), callback.replacingOccurrences(of: "/oauth2redirect", with: "/other")] {
            XCTAssertThrowsError(try attempt.code(from: URL(string: invalid)!))
        }
        XCTAssertThrowsError(try attempt.code(from: URL(string: "com.googleusercontent.apps.fixture:/oauth2redirect?state=\(attempt.state)&error=access_denied")!))
    }
    func testTwoAuthorizedSubjectsAndMismatch() async throws {
        let (value, transport) = try adapter(token(subject: "A") + token(subject: "B") + token(subject: "wrong"))
        let a = try await value.authorize(existing: nil)
        let b = try await value.authorize(existing: nil)
        XCTAssertNotEqual(a.account, b.account)
        XCTAssertEqual(a.account.subject, "A")
        XCTAssertEqual(b.account.subject, "B")
        do { _ = try await value.authorize(existing: account); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let requests = await transport.requests
        XCTAssertTrue(requests.filter { $0.httpMethod == "POST" }.allSatisfy { !String(decoding: $0.httpBody!, as: UTF8.self).contains("client_secret") })
        XCTAssertEqual(requests[1].url?.host, "openidconnect.googleapis.com")
    }
    func testVerifiedEmailDisplayAndCanonicalScopeAlias() async throws {
        var replies = token(subject: "A")
        replies[0] = .init(body: replies[0].body.replacingOccurrences(of: "openid email ", with: "openid https://www.googleapis.com/auth/userinfo.email "))
        replies[1] = .init(body: "{\"sub\":\"A\",\"email\":\"first@example.invalid\",\"email_verified\":true}")
        let (value, _) = try adapter(replies)
        let result = try await value.authorize(existing: nil)
        XCTAssertEqual(result.displayName, "first@example.invalid")
        XCTAssertEqual(result.account.subject, "A")
    }

    func testUnverifiedEmailIsNeverUsedAsIdentityOrDisplay() async throws {
        var replies = token(subject: "B")
        replies[1] = .init(body: "{\"sub\":\"B\",\"email\":\"unverified@example.invalid\",\"email_verified\":false}")
        let (value, _) = try adapter(replies)
        let result = try await value.authorize(existing: nil)
        XCTAssertEqual(result.displayName, "Google account B")
        XCTAssertEqual(result.account.subject, "B")
    }

    func testRefreshRotationAndRevocation() async throws {
        let (value, _) = try adapter([.init(body: "{\"access_token\":\"new-access\",\"refresh_token\":\"rotated\",\"token_type\":\"Bearer\",\"expires_in\":3600}"),
                                      .init(body: "{\"error\":\"invalid_grant\"}", status: 400)])
        let result = try await value.renewCredential(account: account, credential: secret(expired: true))
        let decoded = try JSONDecoder().decode(GoogleCalendarAdapter.Credential.self, from: result.data)
        XCTAssertEqual(decoded.refreshToken, "rotated")
        do { _ = try await value.renewCredential(account: account, credential: secret(expired: true)); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .reauthenticationRequired) }
        do { _ = try await value.renewCredential(account: CalendarAccountKey(provider: .google, subject: "B"), credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .reauthenticationRequired) }
    }
    func testAllCalendarPagesAndNoPartialSuccess() async throws {
        let (value, transport) = try adapter([.init(body: "{\"items\":[{\"id\":\"one\",\"primary\":true}],\"nextPageToken\":\"page2\"}"),
            .init(body: "{\"items\":[{\"id\":\"two\"},{\"id\":\"removed\",\"deleted\":true}]}"),
            .init(body: "{\"items\":[{\"id\":\"one\"}],\"nextPageToken\":\"page2\"}"), .init(body: "{}", status: 503)])
        let calendars = try await value.calendars(account: account, credential: secret())
        XCTAssertEqual(calendars.map(\.id), ["one", "two"])
        let requests = await transport.requests
        XCTAssertTrue(requests[1].url!.absoluteString.contains("pageToken=page2"))
        do { _ = try await value.calendars(account: account, credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .transient) }
    }
    func testRecurringRescheduleAllDayCancellationAndContextBoundPages() async throws {
        let first = """
        {"timeZone":"America/Chicago","items":[
        {"id":"instance","hangoutLink":"https://meet.google.com/fixture","attendees":[{"displayName":"Jordan"},{"email":"room@example.invalid","resource":true}],"recurringEventId":"series","originalStartTime":{"dateTime":"2026-09-04T10:00:00-05:00"},"start":{"dateTime":"2026-09-05T10:00:00-05:00"},"end":{"dateTime":"2026-09-05T11:00:00-05:00"}},
        {"id":"cancelled","status":"cancelled"}],"nextPageToken":"two"}
        """
        let second = """
        {"timeZone":"America/Chicago","items":[{"id":"day","start":{"date":"2026-09-06"},"end":{"date":"2026-09-07"}}]}
        """
        let (value, _) = try adapter([.init(body: first), .init(body: second), .init(body: "{\"items\":[]}")])
        let page = try await value.events(account: account, credential: secret(), calendarIDs: ["a/b", "z"], window: window(), cursor: nil)
        XCTAssertEqual(page.events.count, 1)
        XCTAssertEqual(page.events.first?.key.eventID, "series")
        XCTAssertEqual(page.events.first?.safeJoinURL?.host, "meet.google.com")
        XCTAssertEqual(page.events.first?.invitees, ["Jordan"])
        XCTAssertEqual(page.events.first?.key.occurrenceID, "instant:\(try CalendarDateNormalizer.instant("2026-09-04T10:00:00-05:00").timeIntervalSince1970)")
        let next = try await value.events(account: account, credential: secret(), calendarIDs: ["a/b", "z"], window: window(), cursor: page.next)
        XCTAssertEqual(next.events.first?.isAllDay, true)
        XCTAssertEqual(next.events.first?.start, try CalendarDateNormalizer.instant("2026-09-06T05:00:00Z"))
        XCTAssertNotNil(next.next)
        do { _ = try await value.events(account: account, credential: secret(), calendarIDs: ["other"], window: window(), cursor: page.next); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let final = try await value.events(account: account, credential: secret(), calendarIDs: ["a/b", "z"], window: window(), cursor: next.next)
        XCTAssertNil(final.next)
    }
    func testRateLimitAndMalformedEventsAreExplicit() async throws {
        let (value, _) = try adapter([.init(body: "{}", status: 429, headers: ["Retry-After":"120"]), .init(body: "{\"items\":[{\"id\":\"broken\"}]}")])
        do { _ = try await value.calendars(account: account, credential: secret()); XCTFail() }
        catch { guard case .rateLimited(let date) = error as? CalendarFailure else { return XCTFail() }; XCTAssertGreaterThan(date.timeIntervalSinceNow, 110) }
        do { _ = try await value.events(account: account, credential: secret(), calendarIDs: ["one"], window: window(), cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
    }
    func test403ThrottlePermissionsAndMissingAllDayTimezone() async throws {
        let (value, _) = try adapter([
            .init(body: "{\"error\":{\"errors\":[{\"reason\":\"userRateLimitExceeded\"}]}}", status: 403),
            .init(body: "{\"error\":{\"errors\":[{\"reason\":\"insufficientPermissions\"}]}}", status: 403),
            .init(body: "{\"items\":[{\"id\":\"ambiguous\",\"start\":{\"date\":\"2026-09-06\"},\"end\":{\"date\":\"2026-09-07\"}}]}")])
        do { _ = try await value.calendars(account: account, credential: secret()); XCTFail() }
        catch { guard case .rateLimited = error as? CalendarFailure else { return XCTFail() } }
        do { _ = try await value.calendars(account: account, credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .reauthenticationRequired) }
        do { _ = try await value.events(account: account, credential: secret(), calendarIDs: ["one"], window: window(), cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
    }

    func testCanceledAndReplayedAuthorizationCannotExchangeCode() async throws {
        let transport = GoogleFixtureTransport([])
        let value = GoogleCalendarAdapter(configuration: try config(), transport: transport) { _, _ in throw CancellationError() }
        do { _ = try await value.authorize(existing: nil); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
        let oldAttempt = try GoogleAuthorizationAttempt(configuration: config())
        let replay = GoogleCalendarAdapter(configuration: try config(), transport: transport) { _, _ in
            URL(string: "com.googleusercontent.apps.fixture:/oauth2redirect?state=\(oldAttempt.state)&code=old")!
        }
        do { _ = try await replay.authorize(existing: nil); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let afterReplay = await transport.requests
        XCTAssertTrue(afterReplay.isEmpty)
    }
}
