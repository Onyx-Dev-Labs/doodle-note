import XCTest
import CryptoKit
import AuthenticationServices
@testable import DoodleNoteNative

actor MicrosoftFixtureHTTP: MicrosoftHTTPTransport {
    let handler: @Sendable (URLRequest, Int) async throws -> MicrosoftHTTPResponse
    var requests: [URLRequest] = []
    init(_ handler: @escaping @Sendable (URLRequest, Int) async throws -> MicrosoftHTTPResponse) { self.handler = handler }
    func send(_ request: URLRequest) async throws -> MicrosoftHTTPResponse {
        requests.append(request)
        return try await handler(request, requests.count)
    }
    func count() -> Int { requests.count }
}
@MainActor final class MicrosoftFixtureBrowser: MicrosoftAuthorizationBrowser {
    var last: URL?
    var wrongState = false
    var cancelled = false
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        if cancelled { throw CalendarFailure.cancelled }
        last = url
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let state = items.first { $0.name == "state" }!.value!
        return URL(string: "msauth.ai.doodlenote.native.prototype://auth?code=fixture-code&state=\(wrongState ? "wrong" : state)")!
    }
    func nonce() -> String { URLComponents(url: last!, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "nonce" }!.value! }
}

@MainActor final class MicrosoftCalendarTests: XCTestCase {
    static let client = "11111111-1111-1111-1111-111111111111"
    static let tenant = "22222222-2222-2222-2222-222222222222"
    static let object = "33333333-3333-3333-3333-333333333333"
    static let date = Date(timeIntervalSince1970: 1_800_000_000)
    var account: CalendarAccountKey { CalendarAccountKey(provider: .microsoft, subject: "\(Self.tenant)/\(Self.object)") }
    func configuration() throws -> MicrosoftCalendarConfiguration {
        try .init(clientID: Self.client, redirectURI: URL(string: "msauth.ai.doodlenote.native.prototype://auth")!)
    }
    func secret(account: CalendarAccountKey? = nil, expired: Bool = false) throws -> CalendarSecret {
        try MicrosoftCredential(account: account ?? self.account, clientID: Self.client, accessToken: "fixture-access",
            refreshToken: "fixture-refresh", expiresAt: Self.date.addingTimeInterval(expired ? -1 : 3600)).secret()
    }
    nonisolated static func json(_ object: Any, status: Int = 200) throws -> MicrosoftHTTPResponse {
        MicrosoftHTTPResponse(data: try JSONSerialization.data(withJSONObject: object), status: status)
    }
    nonisolated static func token(nonce: String, oid: String = "33333333-3333-3333-3333-333333333333") throws -> MicrosoftHTTPResponse {
        let claims: [String: Any] = ["aud": "11111111-1111-1111-1111-111111111111", "iss": "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0",
            "tid": "22222222-2222-2222-2222-222222222222", "oid": oid, "exp": 1_800_003_600, "nonce": nonce, "name": "Synthetic account", "preferred_username": "fixture@example.invalid"]
        let jwt = "header." + microsoftBase64URL(try JSONSerialization.data(withJSONObject: claims)) + ".fixture"
        return try json(["access_token": "new-fixture-access", "refresh_token": "rotated-fixture-refresh",
                         "token_type": "Bearer", "expires_in": 3600, "id_token": jwt, "scope": "Calendars.ReadBasic"])
    }
    nonisolated static func event(id: String = "event", type: String = "singleInstance", start: String = "2027-01-15T10:00:00.0000000",
                                  cancelled: Bool = false, allDay: Bool = false) -> [String: Any] {
        ["id": id, "subject": "Fixture meeting", "type": type, "seriesMasterId": "series-stable",
         "originalStart": "2027-01-15T09:00:00Z", "originalStartTimeZone": "Pacific Standard Time",
         "start": ["dateTime": start, "timeZone": "UTC"], "end": ["dateTime": "2027-01-16T08:00:00.0000000", "timeZone": "UTC"],
         "isAllDay": allDay, "isCancelled": cancelled,
         "onlineMeeting": ["joinUrl": "https://teams.microsoft.com/fixture"],
         "attendees": [["type": "required", "emailAddress": ["name": "Jordan"]], ["type": "resource", "emailAddress": ["name": "Room"]]]]
    }
    func window() throws -> CalendarWindow {
        try CalendarWindow(start: CalendarDateNormalizer.instant("2027-01-01T00:00:00Z"), end: CalendarDateNormalizer.instant("2027-02-01T00:00:00Z"))
    }
    func adapter(_ http: MicrosoftFixtureHTTP, browser: MicrosoftFixtureBrowser? = nil) throws -> MicrosoftCalendarAdapter {
        try MicrosoftCalendarAdapter(configuration: configuration(), browser: browser ?? MicrosoftFixtureBrowser(), transport: http, now: { Date(timeIntervalSince1970: 1_800_000_000) })
    }

    func testAuthorizationUsesPKCEAndVerifiedEndpointIdentity() async throws {
        let browser = MicrosoftFixtureBrowser()
        let http = MicrosoftFixtureHTTP { request, _ in
            XCTAssertEqual(request.url?.host, "login.microsoftonline.com")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = String(data: request.httpBody!, encoding: .utf8)!
            XCTAssertFalse(body.contains("client_secret"))
            XCTAssertTrue(body.contains("code_verifier="))
            let authorization = await browser.last!
            let items = URLComponents(url: authorization, resolvingAgainstBaseURL: false)!.queryItems!
            let form = URLComponents(string: "https://fixture.invalid/?" + body)!.queryItems!
            let verifier = form.first { $0.name == "code_verifier" }!.value!
            XCTAssertEqual(items.first { $0.name == "code_challenge" }!.value!, microsoftBase64URL(Data(SHA256.hash(data: Data(verifier.utf8)))))
            XCTAssertEqual(items.first { $0.name == "response_type" }!.value!, "code")
            XCTAssertFalse(items.first { $0.name == "scope" }!.value!.contains("Write"))
            return try Self.token(nonce: await browser.nonce())
        }
        let result = try await adapter(http, browser: browser).authorize(existing: nil)
        XCTAssertEqual(result.account, account)
        XCTAssertEqual(result.displayName, "fixture@example.invalid (22222222/33333333)")
        XCTAssertFalse(String(describing: result.credential).contains("fixture-access"))
    }

    func testWrongStateAndCancellationNeverExchangeCode() async throws {
        let http = MicrosoftFixtureHTTP { _, _ in throw CalendarFailure.invalidResponse }
        let browser = MicrosoftFixtureBrowser(); browser.wrongState = true
        do { _ = try await adapter(http, browser: browser).authorize(existing: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        browser.cancelled = true
        do { _ = try await adapter(http, browser: browser).authorize(existing: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let count = await http.count(); XCTAssertEqual(count, 0)
    }

    func testWrongNonceAndReauthAccountAreRejected() async throws {
        let browser = MicrosoftFixtureBrowser()
        let http = MicrosoftFixtureHTTP { _, _ in try Self.token(nonce: "wrong") }
        do { _ = try await adapter(http, browser: browser).authorize(existing: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let other = MicrosoftFixtureHTTP { _, _ in try Self.token(nonce: await browser.nonce(), oid: "44444444-4444-4444-4444-444444444444") }
        do { _ = try await adapter(other, browser: browser).authorize(existing: account); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
    }

    func testRefreshRotationAndRevokedConsent() async throws {
        let http = MicrosoftFixtureHTTP { request, _ in
            XCTAssertTrue(String(data: request.httpBody!, encoding: .utf8)!.contains("grant_type=refresh_token"))
            return try Self.json(["access_token": "fresh", "refresh_token": "rotated", "token_type": "Bearer", "expires_in": 3600])
        }
        let provider = try adapter(http)
        let fresh = try await provider.renewCredential(account: account, credential: secret(expired: true))
        let decoded = try MicrosoftCredential.read(fresh, account: account, clientID: Self.client)
        XCTAssertEqual(decoded.refreshToken, "rotated")
        _ = try await provider.renewCredential(account: account, credential: fresh)
        let count = await http.count(); XCTAssertEqual(count, 1)
        let rejected = MicrosoftFixtureHTTP { _, _ in try Self.json(["error": "invalid_grant", "error_description": "sensitive"], status: 400) }
        do { _ = try await adapter(rejected).renewCredential(account: account, credential: secret(expired: true)); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .reauthenticationRequired) }
    }

    func testCalendarDiscoveryFollowsAllPagesAndRejectsHostEscape() async throws {
        let http = MicrosoftFixtureHTTP { request, number in
            XCTAssertEqual(request.httpMethod ?? "GET", "GET")
            if number == 1 { return try Self.json(["value": [["id": "a", "name": "A", "isDefaultCalendar": true]], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars?$skip=1"]) }
            return try Self.json(["value": [["id": "b", "name": "B"]]])
        }
        let result = try await adapter(http).calendars(account: account, credential: secret())
        XCTAssertEqual(result.map(\.id), ["a", "b"])
        let bad = MicrosoftFixtureHTTP { _, _ in try Self.json(["value": [], "@odata.nextLink": "https://evil.invalid/v1.0/me/calendars"]) }
        do { _ = try await adapter(bad).calendars(account: account, credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let count = await bad.count(); XCTAssertEqual(count, 1)
    }

    func testAllCalendarPagesRecurrenceExceptionsCancellationAndTimeZones() async throws {
        let http = MicrosoftFixtureHTTP { request, number in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Prefer"), "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
            if number == 1 { return try Self.json(["value": [Self.event(type: "occurrence"), Self.event(id: "cancelled", cancelled: true)],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/a/calendarView?$skiptoken=page2"]) }
            if number == 2 { return try Self.json(["value": [Self.event(id: "moved", type: "exception", start: "2027-01-15T13:00:00+02:00")]]) }
            XCTAssertTrue(request.url!.path.contains("/b/"))
            return try Self.json(["value": [Self.event(id: "all-day", start: "2027-01-15T08:00:00.0000000", allDay: true)]])
        }
        let provider = try adapter(http), range = try window(), credential = try secret()
        let one = try await provider.events(account: account, credential: credential, calendarIDs: ["a", "b"], window: range, cursor: nil)
        let two = try await provider.events(account: account, credential: credential, calendarIDs: ["a", "b"], window: range, cursor: one.next)
        let three = try await provider.events(account: account, credential: credential, calendarIDs: ["a", "b"], window: range, cursor: two.next)
        XCTAssertEqual(one.events[0].safeJoinURL?.host, "teams.microsoft.com")
        XCTAssertEqual(one.events[0].invitees, ["Jordan"])
        XCTAssertEqual(one.events.count, 1); XCTAssertEqual(one.events[0].key, two.events[0].key)
        XCTAssertNotEqual(one.events[0].start, two.events[0].start)
        XCTAssertEqual(three.events[0].timeZoneID, "America/Los_Angeles"); XCTAssertTrue(three.events[0].isAllDay)
        XCTAssertNil(three.next)
    }

    func testCredentialsAndCursorsCannotCrossAccountsOrSelections() async throws {
        let http = MicrosoftFixtureHTTP { _, _ in try Self.json(["value": [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/a/calendarView?$skip=1"]) }
        let provider = try adapter(http)
        let other = CalendarAccountKey(provider: .microsoft, subject: "other")
        do { _ = try await provider.calendars(account: other, credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .reauthenticationRequired) }
        let page = try await provider.events(account: account, credential: secret(), calendarIDs: ["a"], window: window(), cursor: nil)
        do { _ = try await provider.events(account: other, credential: secret(account: other), calendarIDs: ["a"], window: window(), cursor: page.next); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        do { _ = try await provider.events(account: account, credential: secret(), calendarIDs: ["b"], window: window(), cursor: page.next); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let count = await http.count(); XCTAssertEqual(count, 1)
    }

    func testThrottlingAndMalformedTimeAreExplicit() async throws {
        let http = MicrosoftFixtureHTTP { _, _ in MicrosoftHTTPResponse(data: Data(), status: 429, retryAfter: "120") }
        do { _ = try await adapter(http).calendars(account: account, credential: secret()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .rateLimited(retryAt: Self.date.addingTimeInterval(120))) }
        let invalid = MicrosoftFixtureHTTP { _, _ in try Self.json(["value": [Self.event(start: "not-a-time")]]) }
        do { _ = try await adapter(invalid).events(account: account, credential: secret(), calendarIDs: ["a"], window: window(), cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        XCTAssertEqual(MicrosoftTimeZones.iana("India Standard Time"), "Asia/Calcutta")
        XCTAssertNil(MicrosoftTimeZones.iana("invented zone"))
    }

    func testAllDayDSTKeepsExclusiveEndAndSourceZone() async throws {
        let http = MicrosoftFixtureHTTP { _, _ in
            var event = Self.event(allDay: true)
            event["start"] = ["dateTime": "2027-03-14T08:00:00", "timeZone": "UTC"]
            event["end"] = ["dateTime": "2027-03-15T07:00:00", "timeZone": "UTC"]
            return try Self.json(["value": [event]])
        }
        let range = try CalendarWindow(start: CalendarDateNormalizer.instant("2027-03-01T00:00:00Z"), end: CalendarDateNormalizer.instant("2027-04-01T00:00:00Z"))
        let page = try await adapter(http).events(account: account, credential: secret(), calendarIDs: ["a"], window: range, cursor: nil)
        let event = try XCTUnwrap(page.events.first)
        XCTAssertEqual(event.end.timeIntervalSince(event.start), 23 * 3600)
        XCTAssertEqual(event.start, try CalendarDateNormalizer.day("2027-03-14", timeZoneID: event.timeZoneID))
        XCTAssertEqual(event.end, try CalendarDateNormalizer.day("2027-03-15", timeZoneID: event.timeZoneID))
    }

    func testEndpointIdentityRejectsWrongAudienceIssuerAndExpiredClaims() throws {
        let response = try Self.token(nonce: "expected")
        let token = try JSONDecoder().decode(MicrosoftTokenResponse.self, from: response.data).id_token!
        let claims = try JSONSerialization.jsonObject(with: decodeBase64URL(String(token.split(separator: ".")[1]))!) as! [String: Any]
        for (field, value) in [("aud", "other-client"), ("iss", "https://evil.invalid/v2.0"), ("tid", "invalid"), ("oid", "invalid"), ("nonce", "other")] {
            var changed = claims; changed[field] = value
            let jwt = "header." + microsoftBase64URL(try JSONSerialization.data(withJSONObject: changed)) + ".fixture"
            XCTAssertThrowsError(try MicrosoftIdentity.verifiedEndpointResponse(jwt, clientID: Self.client, nonce: "expected", now: Self.date))
        }
        XCTAssertThrowsError(try MicrosoftIdentity.verifiedEndpointResponse(token, clientID: Self.client, nonce: "expected", now: Self.date.addingTimeInterval(7200)))
    }

    func testConfigurationRejectsNonNativeRedirects() throws {
        for uri in ["https://example.com", "file:///tmp/a", "ftp://auth", "msauth.app://auth:80", "msauth.app://auth?x=1"] {
            XCTAssertThrowsError(try MicrosoftCalendarConfiguration(clientID: Self.client, redirectURI: URL(string: uri)!))
        }
    }
    func testPartialFailureKeepsCompleteCacheAndDisconnectRemovesOnlyProviderData() async throws {
        let browser = MicrosoftFixtureBrowser()
        let http = MicrosoftFixtureHTTP { request, number in
            if request.httpMethod == "POST" { return try Self.token(nonce: await browser.nonce()) }
            if request.url!.path.hasSuffix("/calendars") {
                return try Self.json(["value": [["id": "a", "name": "Calendar A", "isDefaultCalendar": true]]])
            }
            if number == 3 { return try Self.json(["value": [Self.event(id: "cached")]]) }
            if number == 5 { return try Self.json(["value": [Self.event(id: "partial")], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/a/calendarView?$skip=1"]) }
            throw CalendarFailure.offline
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let credentials = MemoryCalendarCredentials()
        let store = try CalendarAccountStore(directory: root, credentials: credentials)
        let provider = try adapter(http, browser: browser)
        let key = try await store.connect(using: provider)
        try await store.refresh(key, using: provider, window: window())
        try await store.select(["a"], for: key)
        do { try await store.refresh(key, using: provider, window: window()); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .offline) }
        let snapshot = await store.snapshots()[0]
        XCTAssertEqual(snapshot.events.map(\.key.eventID), ["cached"])
        XCTAssertEqual(snapshot.failure, .offline)
        let restarted = try CalendarAccountStore(directory: root, credentials: credentials)
        let restored = await restarted.snapshots()[0]
        XCTAssertEqual(restored.selectedCalendarIDs, ["a"])
        XCTAssertEqual(restored.events, snapshot.events)
        try await restarted.disconnect(key)
        let remaining = await restarted.snapshots()
        XCTAssertTrue(remaining.isEmpty); XCTAssertNil(try credentials.read(key))
    }

    func testOversizedSelectionAndMissingAllDayZoneFail() async throws {
        let http = MicrosoftFixtureHTTP { _, _ in
            var event = Self.event(allDay: true)
            event.removeValue(forKey: "originalStartTimeZone")
            return try Self.json(["value": [event]])
        }
        let provider = try adapter(http)
        do { _ = try await provider.events(account: account, credential: secret(), calendarIDs: Set((0...1000).map(String.init)), window: window(), cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
        let before = await http.count(); XCTAssertEqual(before, 0)
        do { _ = try await provider.events(account: account, credential: secret(), calendarIDs: ["a"], window: window(), cursor: nil); XCTFail() }
        catch { XCTAssertEqual(error as? CalendarFailure, .invalidResponse) }
    }

    func testLateBrowserCancellationCannotCompleteNewAttempt() async throws {
        var sessions: [MicrosoftFakeSession] = []
        let browser = MicrosoftSystemBrowser(anchor: { fatalError("Synthetic session never requests a presentation window") }, makeSession: { _, _, _, completion in
            let session = MicrosoftFakeSession(completion: completion)
            sessions.append(session)
            return session
        })
        let url = URL(string: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize")!
        let first = Task { try await browser.authenticate(url: url, callbackScheme: "msauth.fixture") }
        while sessions.count < 1 { await Task.yield() }
        let old = sessions[0]
        first.cancel()
        do { _ = try await first.value; XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let second = Task { try await browser.authenticate(url: url, callbackScheme: "msauth.fixture") }
        while sessions.count < 2 { await Task.yield() }
        old.completion(nil, CalendarFailure.cancelled)
        await Task.yield()
        XCTAssertFalse(sessions[1].cancelled)
        let callback = URL(string: "msauth.fixture://auth?code=new")!
        sessions[1].completion(callback, nil)
        let result = try await second.value
        XCTAssertEqual(result, callback)
    }

}

@MainActor private final class MicrosoftFakeSession: MicrosoftBrowserSession {
    let completion: @Sendable (URL?, Error?) -> Void
    var cancelled = false
    init(completion: @escaping @Sendable (URL?, Error?) -> Void) { self.completion = completion }
    func start() -> Bool { true }
    func cancel() { cancelled = true }
}
