#if DEBUG
import SwiftUI

/// Preview-only adapter. Never used by the app's production account flow.
actor CalendarFixtureAdapter: CalendarProviderAdapter {
    nonisolated let provider: CalendarProvider
    let subject: String
    var failure: CalendarFailure?
    init(provider: CalendarProvider, subject: String) { self.provider = provider; self.subject = subject }
    func setFailure(_ failure: CalendarFailure?) { self.failure = failure }
    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization {
        CalendarAuthorization(account: CalendarAccountKey(provider: provider, subject: subject),
            displayName: "Fixture \(provider.rawValue) \(subject)", credential: CalendarSecret(data: Data("preview-only".utf8)))
    }
    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret { credential }
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor] {
        if let failure { throw failure }
        return [CalendarDescriptor(id: "primary", name: "Fixture calendar", isDefault: true)]
    }
    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>, window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        CalendarPage(events: [CalendarOccurrence(key: EventOccurrenceKey(provider: provider.rawValue,
            accountID: subject, calendarID: "primary", eventID: "fixture", occurrenceID: "original-occurrence"),
            title: "Fixture planning meeting", start: window.start, end: window.end, timeZoneID: "UTC", isAllDay: false)], next: nil)
    }
}

private final class PreviewCalendarCredentials: CalendarCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [CalendarAccountKey: CalendarSecret] = [:]
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret? { lock.withLock { values[account] } }
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws { lock.withLock { values[account] = credential } }
    func remove(_ account: CalendarAccountKey) throws { lock.withLock { values.removeValue(forKey: account) } }
}

struct CalendarContractPreview: View {
    @State private var store: CalendarAccountStore?
    @State private var snapshots: [CalendarConnection] = []
    @State private var message = "Fixture only. No network or real accounts."
    private let first = CalendarFixtureAdapter(provider: .google, subject: "A")
    private let second = CalendarFixtureAdapter(provider: .microsoft, subject: "B")

    var body: some View {
        NavigationStack {
            List {
                Text(message)
                Button("Connect fixture accounts") { run { store in
                    _ = try await store.connect(using: first)
                    _ = try await store.connect(using: second)
                } }
                Button("Refresh fixtures") { run { store in
                    for adapter in [first, second] {
                        await adapter.setFailure(nil)
                        try await store.refresh(CalendarAccountKey(provider: adapter.provider, subject: adapter.subject), using: adapter,
                            window: CalendarWindow(start: Date(), end: Date().addingTimeInterval(3600)))
                    }
                } }
                ForEach(snapshots, id: \.account) { connection in
                    Section(connection.displayName) {
                        Text("State: \(connection.state.rawValue), cached events: \(connection.events.count)")
                        ForEach(connection.events, id: \.key) { Text($0.title) }
                        Button("Simulate offline refresh") { run { store in
                            let adapter = connection.account.provider == .google ? first : second
                            await adapter.setFailure(.offline)
                            try await store.refresh(connection.account, using: adapter,
                                window: CalendarWindow(start: Date(), end: Date().addingTimeInterval(3600)))
                        } }
                        Button("Require reauthentication") { run { store in
                            let adapter = connection.account.provider == .google ? first : second
                            await adapter.setFailure(.reauthenticationRequired)
                            try await store.refresh(connection.account, using: adapter,
                                window: CalendarWindow(start: Date(), end: Date().addingTimeInterval(3600)))
                        } }
                        Button("Reauthenticate") { run { store in
                            let adapter = connection.account.provider == .google ? first : second
                            await adapter.setFailure(nil)
                            _ = try await store.connect(using: adapter, existing: connection.account)
                        } }
                        Button("Disconnect account") { run { try await $0.disconnect(connection.account) } }
                    }
                }
            }.navigationTitle("Calendar contract fixture")
        }.task {
            do { store = try CalendarAccountStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("calendar-preview-\(UUID())"), credentials: PreviewCalendarCredentials()) }
            catch { message = "Fixture storage unavailable" }
        }
    }
    private func run(_ operation: @escaping @MainActor (CalendarAccountStore) async throws -> Void) {
        Task {
            guard let store else { return }
            do { try await operation(store); message = "Fixture operation completed" }
            catch { message = "Fixture result: \(CalendarFailure.safe(error))" }
            snapshots = await store.snapshots()
        }
    }
}

#Preview { CalendarContractPreview() }
#endif
