import XCTest
@testable import DoodleNoteNative

@MainActor final class CalendarExperienceTests: XCTestCase {
    private func event(start: Date = Date().addingTimeInterval(3600)) -> CalendarOccurrence {
        CalendarOccurrence(key: EventOccurrenceKey(provider: "google", accountID: "account", calendarID: "calendar", eventID: "event", occurrenceID: "occurrence"),
            title: "Planning", start: start, end: start.addingTimeInterval(3600), timeZoneID: "America/Chicago", isAllDay: false,
            joinURL: "https://meet.google.com/fixture", invitees: ["Jordan"])
    }
    func testConcurrentHomeAndReminderOpenOneNoteAndPreserveEditsAfterReschedule() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        let original = event()
        async let first = library.openEventNote(original, libraryID: LibraryRecord.localID)
        async let second = library.openEventNote(original, libraryID: LibraryRecord.localID)
        let ids = try await [first, second]
        XCTAssertEqual(ids[0], ids[1]); XCTAssertEqual(library.visibleNotes.count, 1)
        library.update(ids[0]) { $0.title = "My title"; $0.text = "Private notes"; $0.ink = Data([1, 2, 3]) }
        let changed = CalendarOccurrence(key: original.key, title: "Provider renamed", start: original.start.addingTimeInterval(86400), end: original.end.addingTimeInterval(86400), timeZoneID: original.timeZoneID, isAllDay: false)
        let reopened = try await library.openEventNote(changed, libraryID: LibraryRecord.localID)
        XCTAssertEqual(reopened, ids[0]); XCTAssertEqual(library.note(reopened)?.title, "My title")
        XCTAssertEqual(library.note(reopened)?.text, "Private notes"); XCTAssertEqual(library.note(reopened)?.ink, Data([1, 2, 3]))
        let persisted = NoteLibrary(root: root); await persisted.waitUntilLoaded()
        let persistedID = try await persisted.openEventNote(original, libraryID: LibraryRecord.localID)
        XCTAssertEqual(persistedID, reopened); XCTAssertEqual(persisted.visibleNotes.count, 1)
        XCTAssertEqual(persisted.note(reopened)?.metadata?.event, original.key)
    }
    func testMissingLibraryCannotCreateEventNote() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        do { _ = try await library.openEventNote(event(), libraryID: UUID()); XCTFail("Unknown library accepted") } catch {}
        XCTAssertTrue(library.visibleNotes.isEmpty)
    }
    func testReminderPlanOffByDefaultUsesAbsoluteDSTInstantAndExcludesAllDayPastAndDistant() throws {
        let now = try CalendarDateNormalizer.instant("2026-11-01T05:00:00Z")
        let meeting = event(start: try CalendarDateNormalizer.instant("2026-11-01T07:30:00Z"))
        XCTAssertTrue(CalendarReminderScheduler.plan(events: [meeting], libraryID: LibraryRecord.localID, now: now, enabled: false, leadMinutes: 5).isEmpty)
        let allDay = CalendarOccurrence(key: meeting.key, title: meeting.title, start: meeting.start, end: meeting.end, timeZoneID: meeting.timeZoneID, isAllDay: true)
        let plan = CalendarReminderScheduler.plan(events: [meeting, allDay, event(start: now), event(start: now.addingTimeInterval(15 * 86400))], libraryID: LibraryRecord.localID, now: now, enabled: true, leadMinutes: 5)
        XCTAssertEqual(plan.count, 1)
        XCTAssertEqual(plan.first?.fireAt, try CalendarDateNormalizer.instant("2026-11-01T07:25:00Z"))
        let route = try XCTUnwrap(plan.first?.route)
        XCTAssertEqual(try JSONDecoder().decode(CalendarReminderRoute.self, from: JSONEncoder().encode(route)), route)
        XCTAssertEqual(route.identifier, plan[0].route.identifier)
    }
    func testSerialReminderReplacementFinishesWithCancellation() async {
        let notifications = ReminderProbe(); notifications.suspend = true
        let scheduler = CalendarReminderScheduler(notifications: notifications)
        let plan = CalendarReminderScheduler.plan(events: [event()], libraryID: LibraryRecord.localID, now: Date(), enabled: true, leadMinutes: 5)
        let first = Task { await scheduler.replace(plan) }
        while notifications.continuation == nil { await Task.yield() }
        let second = Task { await scheduler.replace([]) }
        await Task.yield(); notifications.resume()
        await first.value; await second.value
        XCTAssertEqual(notifications.plans.last, [])
    }
    func testCalendarSelectionOfflineAndDisconnectCancelRemindersButKeepNote() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let name = UUID().uuidString; let preferences = UserDefaults(suiteName: name)!
        defer { preferences.removePersistentDomain(forName: name) }
        let notifications = ReminderProbe(); notifications.allowed = true
        let adapter = ExperienceAdapter()
        let store = try CalendarAccountStore(directory: root.appendingPathComponent("calendars"), credentials: ExperienceCredentials())
        let account = try await store.connect(using: adapter)
        let coordinator = CalendarCoordinator(store: store, providers: [.google: adapter], notifications: notifications, preferences: preferences)
        await coordinator.start(); await coordinator.enableReminders(true)
        XCTAssertEqual(coordinator.upcoming.count, 1); XCTAssertEqual(notifications.plans.last?.count, 1)
        let meeting = try XCTUnwrap(coordinator.upcoming.first)
        let library = NoteLibrary(root: root.appendingPathComponent("notes"))
        let id = try await library.openEventNote(meeting, libraryID: LibraryRecord.localID)
        await adapter.setOffline(true); await coordinator.refresh()
        XCTAssertEqual(coordinator.upcoming.count, 1); XCTAssertEqual(notifications.plans.last, [])
        await adapter.setOffline(false); await coordinator.refresh()
        XCTAssertEqual(notifications.plans.last?.count, 1)
        coordinator.open(CalendarReminderRoute(event: meeting.key, libraryID: LibraryRecord.localID))
        XCTAssertEqual(coordinator.selectedEvent?.key, meeting.key)
        async let hide: Void = coordinator.select("primary", enabled: false, account: account)
        async let show: Void = coordinator.select("secondary", enabled: true, account: account)
        _ = await (hide, show)
        let selection = await store.snapshots().first?.selectedCalendarIDs
        XCTAssertEqual(selection, ["secondary"])
        await coordinator.select("secondary", enabled: false, account: account)
        XCTAssertTrue(coordinator.upcoming.isEmpty); XCTAssertEqual(notifications.plans.last, [])
        await coordinator.disconnect(account)
        XCTAssertTrue(coordinator.snapshots.isEmpty); XCTAssertNotNil(library.note(id))
        coordinator.open(CalendarReminderRoute(event: meeting.key, libraryID: LibraryRecord.localID))
        XCTAssertNotNil(coordinator.problem); XCTAssertNil(coordinator.selectedEvent)
    }
    func testJoinURLRejectsUnsafeSchemesAndEmbeddedCredentials() {
        var meeting = event()
        XCTAssertNotNil(meeting.safeJoinURL)
        for invalidURL in ["javascript:alert(1)", "file:///etc/passwd", "https://user:password@example.com", "https:///missing"] {
            meeting.joinURL = invalidURL; XCTAssertNil(meeting.safeJoinURL)
        }
    }
    func testDeniedPermissionNeverEnablesReminders() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let name = UUID().uuidString; let preferences = UserDefaults(suiteName: name)!
        defer { preferences.removePersistentDomain(forName: name) }
        let notifications = ReminderProbe()
        let store = try CalendarAccountStore(directory: root)
        let coordinator = CalendarCoordinator(store: store, providers: [:], notifications: notifications, preferences: preferences)
        XCTAssertFalse(coordinator.remindersEnabled)
        await coordinator.enableReminders(true)
        XCTAssertFalse(coordinator.remindersEnabled); XCTAssertNotNil(coordinator.problem)
        XCTAssertEqual(notifications.plans.last, [])
    }
}

@MainActor private final class ReminderProbe: CalendarNotificationStore {
    var plans: [[CalendarReminder]] = []
    var allowed = false
    var suspend = false
    var continuation: CheckedContinuation<Void, Never>?
    func requestPermission() async throws -> Bool { allowed }
    func permitted() async -> Bool { allowed }
    func replace(_ reminders: [CalendarReminder]) async throws {
        if suspend { suspend = false; await withCheckedContinuation { continuation = $0 } }
        plans.append(reminders)
    }
    func resume() { continuation?.resume(); continuation = nil }
}

private actor ExperienceAdapter: CalendarProviderAdapter {
    nonisolated let provider = CalendarProvider.google
    private var offline = false
    func setOffline(_ value: Bool) { offline = value }
    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        CalendarAuthorization(account: CalendarAccountKey(provider: provider, subject: "fixture"), displayName: "Fixture", credential: CalendarSecret(data: Data([1])))
    }
    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret { credential }
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor] {
        if offline { throw CalendarFailure.offline }
        return [CalendarDescriptor(id: "primary", name: "Calendar", isDefault: true), CalendarDescriptor(id: "secondary", name: "Second", isDefault: false)]
    }
    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>, window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        CalendarPage(events: [CalendarOccurrence(key: EventOccurrenceKey(provider: provider.rawValue, accountID: account.subject, calendarID: "primary", eventID: "meeting", occurrenceID: "stable"), title: "Fixture", start: window.start.addingTimeInterval(3600), end: window.start.addingTimeInterval(7200), timeZoneID: "UTC", isAllDay: false)], next: nil)
    }
}
private final class ExperienceCredentials: CalendarCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [CalendarAccountKey: CalendarSecret] = [:]
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret? { lock.withLock { values[account] } }
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws { lock.withLock { values[account] = credential } }
    func remove(_ account: CalendarAccountKey) throws { lock.withLock { values.removeValue(forKey: account) } }
}
