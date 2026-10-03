#if DEBUG
import Foundation

@MainActor enum CalendarUIFixture {
    static func make(root: URL) throws -> CalendarCoordinator {
        let store = try CalendarAccountStore(directory: root.appendingPathComponent("FixtureCalendars"), credentials: FixtureCalendarCredentials())
        let preferences = UserDefaults(suiteName: "calendar-fixture-" + root.lastPathComponent)!
        preferences.removePersistentDomain(forName: "calendar-fixture-" + root.lastPathComponent)
        let result = CalendarCoordinator(store: store, providers: [
            .google: CalendarUIAdapter(provider: .google), .microsoft: CalendarUIAdapter(provider: .microsoft)
        ], notifications: FixtureCalendarNotifications(), preferences: preferences)
        result.fixtureMode = true
        return result
    }
}
private final class FixtureCalendarCredentials: CalendarCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [CalendarAccountKey: CalendarSecret] = [:]
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret? { lock.withLock { values[account] } }
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws { lock.withLock { values[account] = credential } }
    func remove(_ account: CalendarAccountKey) throws { lock.withLock { values.removeValue(forKey: account) } }
}
@MainActor private final class FixtureCalendarNotifications: CalendarNotificationStore {
    func requestPermission() async throws -> Bool { false }
    func permitted() async -> Bool { false }
    func replace(_ reminders: [CalendarReminder]) async throws {}
}
private struct CalendarUIAdapter: CalendarProviderAdapter {
    let provider: CalendarProvider
    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        CalendarAuthorization(account: CalendarAccountKey(provider: provider, subject: "fixture"), displayName: "\(provider.rawValue) fixture account", credential: CalendarSecret(data: Data("fixture".utf8)))
    }
    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret { credential }
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor] {
        [CalendarDescriptor(id: "primary", name: "Team calendar", isDefault: true)]
    }
    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>, window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        CalendarPage(events: [CalendarOccurrence(key: EventOccurrenceKey(provider: provider.rawValue, accountID: account.subject,
            calendarID: "primary", eventID: "meeting", occurrenceID: "stable-fixture-occurrence"),
            title: provider == .google ? "Google planning fixture" : "Microsoft planning fixture",
            start: window.start.addingTimeInterval(3600), end: window.start.addingTimeInterval(7200), timeZoneID: "UTC", isAllDay: false,
            joinURL: "https://example.invalid/fixture-meeting", invitees: ["Jordan (fixture)", "Casey (fixture)"])], next: nil)
    }
}
#endif
