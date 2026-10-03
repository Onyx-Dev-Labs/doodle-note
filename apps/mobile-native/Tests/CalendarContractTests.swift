import XCTest
@testable import DoodleNoteNative

final class MemoryCalendarCredentials: CalendarCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [CalendarAccountKey: CalendarSecret] = [:]
    var removalFails = false
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret? { lock.withLock { values[account] } }
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws { lock.withLock { values[account] = credential } }
    func remove(_ account: CalendarAccountKey) throws {
        try lock.withLock {
            if removalFails { throw CalendarFailure.storage }
            values.removeValue(forKey: account)
        }
    }
}

actor MockCalendarAdapter: CalendarProviderAdapter {
    nonisolated let provider: CalendarProvider
    let subject: String
    var failure: CalendarFailure?
    var suspended = false
    var continuation: CheckedContinuation<CalendarAuthorization, Error>?
    var pendingRead: CheckedContinuation<[CalendarDescriptor], Error>?
    var suspendRead = false
    var suspendRenew = false
    var pendingRenew: CheckedContinuation<CalendarSecret, Error>?
    func pauseRenew() { suspendRenew = true }
    func waitingRenew() -> Bool { pendingRenew != nil }
    func resumeRenew() { pendingRenew?.resume(returning: CalendarSecret(data: Data("stale-rotation".utf8))); pendingRenew = nil }
    var pageCalls = 0
    var seenCredentials: [Data] = []
    init(_ provider: CalendarProvider, subject: String = "subject") { self.provider = provider; self.subject = subject }
    func configure(failure: CalendarFailure? = nil, suspended: Bool = false, suspendRead: Bool = false) {
        self.failure = failure; self.suspended = suspended; self.suspendRead = suspendRead
    }
    func authorization() -> CalendarAuthorization {
        CalendarAuthorization(account: CalendarAccountKey(provider: provider, subject: subject), displayName: "Fixture account",
                              credential: CalendarSecret(data: Data("fixture-secret-never-in-cache".utf8)))
    }
    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        if suspended { return try await withCheckedThrowingContinuation { continuation = $0 } }
        if let failure { throw failure }
        return authorization()
    }
    func resumeAuthorization() { continuation?.resume(returning: authorization()); continuation = nil }
    func waiting() -> Bool { continuation != nil }
    func waitingRead() -> Bool { pendingRead != nil }
    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret {
        if suspendRenew { return try await withCheckedThrowingContinuation { pendingRenew = $0 } }
        return CalendarSecret(data: Data("rotated-fixture".utf8))
    }
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor] {
        seenCredentials.append(credential.data)
        if suspendRead { return try await withCheckedThrowingContinuation { pendingRead = $0 } }
        if let failure { throw failure }
        return [CalendarDescriptor(id: "primary", name: "Calendar", isDefault: true)]
    }
    func resumeRead() {
        pendingRead?.resume(returning: [CalendarDescriptor(id: "primary", name: "Calendar", isDefault: true)])
        pendingRead = nil
    }
    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>,
                window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        seenCredentials.append(credential.data)
        pageCalls += 1
        return CalendarPage(events: [CalendarOccurrence(key: EventOccurrenceKey(provider: provider.rawValue,
            accountID: subject, calendarID: "primary", eventID: "event", occurrenceID: cursor ?? "first"),
            title: "Fixture meeting", start: window.start, end: window.end, timeZoneID: "America/Chicago", isAllDay: false)],
            next: cursor == nil ? "second" : nil)
    }
}

final class CalendarContractTests: XCTestCase {
    func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    func window() throws -> CalendarWindow { try CalendarWindow(start: Date(timeIntervalSince1970: 100), end: Date(timeIntervalSince1970: 200)) }

    func testBothProviderAdaptersSatisfyMultiAccountCacheContract() async throws {
        for provider in CalendarProvider.allCases {
            let directory = try root()
            let secrets = MemoryCalendarCredentials()
            let store = try CalendarAccountStore(directory: directory, credentials: secrets)
            let first = MockCalendarAdapter(provider, subject: "a")
            let second = MockCalendarAdapter(provider, subject: "b")
            let a = try await store.connect(using: first)
            let b = try await store.connect(using: second)
            try await store.refresh(a, using: first, window: window())
            try await store.refresh(b, using: second, window: window())
            XCTAssertEqual(try secrets.read(a)?.data, Data("rotated-fixture".utf8))
            let seen = await first.seenCredentials
            XCTAssertTrue(seen.allSatisfy { $0 == Data("rotated-fixture".utf8) })
            try await store.select([], for: a)
            let reopened = try CalendarAccountStore(directory: directory, credentials: secrets)
            let snapshots = await reopened.snapshots()
            XCTAssertEqual(snapshots.count, 2)
            XCTAssertEqual(snapshots.first { $0.account == a }?.events.count, 0)
            XCTAssertEqual(snapshots.first { $0.account == b }?.events.count, 2)
            XCTAssertFalse(String(decoding: try Data(contentsOf: directory.appendingPathComponent("calendar-cache.json")), as: UTF8.self).contains("fixture-secret"))
            await second.configure(failure: .offline)
            do { try await reopened.refresh(b, using: second, window: window()); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .offline) }
            let offline = await reopened.snapshots()
            XCTAssertEqual(offline.first { $0.account == b }?.events.count, 2)
            try await reopened.disconnect(a)
            XCTAssertNil(try secrets.read(a))
            XCTAssertNotNil(try secrets.read(b))
            let remaining = await reopened.snapshots()
            XCTAssertEqual(remaining.map(\.account), [b])
        }
    }

    func testCanceledAuthorizationCannotRestoreDisconnectedAccount() async throws {
        let store = try CalendarAccountStore(directory: root(), credentials: MemoryCalendarCredentials())
        let adapter = MockCalendarAdapter(.google)
        await adapter.configure(suspended: true)
        let task = Task { try await store.connect(using: adapter) }
        while !(await adapter.waiting()) { await Task.yield() }
        await store.cancelConnect(.google)
        await adapter.resumeAuthorization()
        do { _ = try await task.value; XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let values = await store.snapshots()
        XCTAssertTrue(values.isEmpty)
    }

    func testDisconnectInvalidatesInFlightRefreshAndRetriesFailedCredentialRemoval() async throws {
        let directory = try root()
        let secrets = MemoryCalendarCredentials()
        let store = try CalendarAccountStore(directory: directory, credentials: secrets)
        let adapter = MockCalendarAdapter(.microsoft)
        let account = try await store.connect(using: adapter)
        await adapter.configure(suspendRead: true)
        let window = try window()
        let task = Task { try await store.refresh(account, using: adapter, window: window) }
        while !(await adapter.waitingRead()) { await Task.yield() }
        secrets.removalFails = true
        do { try await store.disconnect(account); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .storage) }
        await adapter.resumeRead()
        do { try await task.value; XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let pending = await store.snapshots()
        XCTAssertEqual(pending.first?.state, .disconnecting)
        XCTAssertEqual(pending.first?.events, [])
        secrets.removalFails = false
        let reopened = try CalendarAccountStore(directory: directory, credentials: secrets)
        try await reopened.finishPendingDisconnects()
        let values = await reopened.snapshots()
        XCTAssertTrue(values.isEmpty)
        XCTAssertNil(try secrets.read(account))
    }

    func testReauthenticationPreservesSubjectPreferencesAndRateLimit() async throws {
        let store = try CalendarAccountStore(directory: root(), credentials: MemoryCalendarCredentials())
        let adapter = MockCalendarAdapter(.google)
        let account = try await store.connect(using: adapter)
        try await store.refresh(account, using: adapter, window: window())
        try await store.select([], for: account)
        await adapter.configure(failure: .reauthenticationRequired)
        do { try await store.refresh(account, using: adapter, window: window()); XCTFail() } catch {}
        await adapter.configure()
        let same = try await store.connect(using: adapter, existing: account)
        XCTAssertEqual(same, account)
        let values = await store.snapshots()
        XCTAssertEqual(values.first?.selectedCalendarIDs, [])
        let retry = Date().addingTimeInterval(120)
        await adapter.configure(failure: .rateLimited(retryAt: retry))
        do { try await store.refresh(account, using: adapter, window: window()); XCTFail() } catch {}
        await adapter.configure()
        do { try await store.refresh(account, using: adapter, window: window()); XCTFail() } catch {
            XCTAssertEqual(error as? CalendarFailure, .rateLimited(retryAt: retry))
        }
    }

    func testFailedConnectLeavesDurableCleanupIntent() async throws {
        let directory = try root()
        let secrets = MemoryCalendarCredentials()
        secrets.removalFails = true
        let writer = FailingCalendarWriter()
        let store = try CalendarAccountStore(directory: directory, credentials: secrets, persist: writer.write)
        let adapter = MockCalendarAdapter(.google)
        do { _ = try await store.connect(using: adapter); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .storage) }
        let pending = await store.snapshots()
        XCTAssertEqual(pending.first?.state, .disconnecting)
        secrets.removalFails = false
        let reopened = try CalendarAccountStore(directory: directory, credentials: secrets)
        try await reopened.finishPendingDisconnects()
        let values = await reopened.snapshots()
        XCTAssertTrue(values.isEmpty)
        XCTAssertNil(try secrets.read(CalendarAccountKey(provider: .google, subject: "subject")))
    }

    func testOldRefreshCannotClearNewRefreshAfterReconnect() async throws {
        let store = try CalendarAccountStore(directory: root(), credentials: MemoryCalendarCredentials())
        let old = MockCalendarAdapter(.google)
        let account = try await store.connect(using: old)
        await old.configure(suspendRead: true)
        let window = try window()
        let first = Task { try await store.refresh(account, using: old, window: window) }
        while !(await old.waitingRead()) { await Task.yield() }
        try await store.disconnect(account)
        let new = MockCalendarAdapter(.google)
        _ = try await store.connect(using: new)
        await new.configure(suspendRead: true)
        let second = Task { try await store.refresh(account, using: new, window: window) }
        while !(await new.waitingRead()) { await Task.yield() }
        await old.resumeRead()
        do { try await first.value; XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        let stillRefreshing = await store.isRefreshing(account)
        XCTAssertTrue(stillRefreshing)
        await new.resumeRead()
        try await second.value
        let finished = await store.isRefreshing(account)
        XCTAssertFalse(finished)
    }

    func testFailedReauthenticationInvalidatesOlderTokenRotation() async throws {
        let secrets = MemoryCalendarCredentials()
        let writer = FailingCalendarWriter(failAfter: 2)
        let store = try CalendarAccountStore(directory: root(), credentials: secrets, persist: writer.write)
        let adapter = MockCalendarAdapter(.google)
        let account = try await store.connect(using: adapter)
        await adapter.pauseRenew()
        let window = try window()
        let refresh = Task { try await store.refresh(account, using: adapter, window: window) }
        while !(await adapter.waitingRenew()) { await Task.yield() }
        do { _ = try await store.connect(using: adapter, existing: account); XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .storage) }
        await adapter.resumeRenew()
        do { try await refresh.value; XCTFail() } catch { XCTAssertEqual(error as? CalendarFailure, .cancelled) }
        XCTAssertEqual(try secrets.read(account)?.data, Data("fixture-secret-never-in-cache".utf8))
        let snapshots = await store.snapshots()
        XCTAssertEqual(snapshots.count, 1)
    }

    func testCorruptCachedWindowIsRejectedWithoutOverwritingFile() async throws {
        let directory = try root()
        let store = try CalendarAccountStore(directory: directory, credentials: MemoryCalendarCredentials())
        let adapter = MockCalendarAdapter(.google)
        let account = try await store.connect(using: adapter)
        try await store.refresh(account, using: adapter, window: window())
        let file = directory.appendingPathComponent("calendar-cache.json")
        var object = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        var connections = object["connections"] as! [[String: Any]]
        connections[0]["window"] = ["start": 100, "end": 0]
        object["connections"] = connections
        let bytes = try JSONSerialization.data(withJSONObject: object)
        try bytes.write(to: file)
        XCTAssertThrowsError(try CalendarAccountStore(directory: directory, credentials: MemoryCalendarCredentials()))
        XCTAssertEqual(try Data(contentsOf: file), bytes)
    }

    func testIdentityAndDateNormalization() throws {
        XCTAssertNotEqual(CalendarAccountKey(provider: .google, subject: "a:b").storageKey,
                          CalendarAccountKey(provider: .microsoft, subject: "a:b").storageKey)
        XCTAssertThrowsError(try CalendarDateNormalizer.instant("2026-11-01T01:30:00"))
        let first = try CalendarDateNormalizer.instant("2026-11-01T01:30:00-05:00")
        let second = try CalendarDateNormalizer.instant("2026-11-01T01:30:00-06:00")
        XCTAssertEqual(second.timeIntervalSince(first), 3600)
        XCTAssertThrowsError(try CalendarDateNormalizer.day("2026-02-30", timeZoneID: "America/Chicago"))
        XCTAssertThrowsError(try CalendarDateNormalizer.day("2026-02-01", timeZoneID: "invalid"))
        XCTAssertEqual(String(reflecting: CalendarSecret(data: Data("private".utf8))), "<calendar credential>")
    }

    func testKeychainPerAccountRoundTrip() throws {
        let store = KeychainCalendarCredentials(service: "test.calendar.\(UUID().uuidString)")
        let a = CalendarAccountKey(provider: .google, subject: "a")
        let b = CalendarAccountKey(provider: .google, subject: "b")
        defer { try? store.remove(a); try? store.remove(b) }
        do { try store.write(CalendarSecret(data: Data("first".utf8)), for: a) }
        catch let error as CalendarKeychainFailure where error.status == -34018 {
            XCTAssertNil(try? store.read(a))
            throw XCTSkip("Unsigned simulator has no Keychain entitlement; run the documented ad-hoc signed validation.")
        }
        try store.write(CalendarSecret(data: Data("second".utf8)), for: b)
        try store.write(CalendarSecret(data: Data("updated".utf8)), for: a)
        XCTAssertEqual(try store.read(a)?.data, Data("updated".utf8))
        try store.remove(a)
        try store.remove(a)
        XCTAssertNil(try store.read(a))
        XCTAssertEqual(try store.read(b)?.data, Data("second".utf8))
    }
}

final class FailingCalendarWriter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private let failAfter: Int
    init(failAfter: Int = 1) { self.failAfter = failAfter }
    func write(_ data: Data, _ url: URL) throws {
        try lock.withLock {
            count += 1
            if count > failAfter { throw CalendarFailure.storage }
            try data.write(to: url, options: .atomic)
        }
    }
}
