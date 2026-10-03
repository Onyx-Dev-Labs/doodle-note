import SwiftUI
import Observation

extension CalendarOccurrence: Identifiable { var id: EventOccurrenceKey { key } }

@MainActor @Observable final class CalendarCoordinator {
    private let store: CalendarAccountStore
    private let providers: [CalendarProvider: any CalendarProviderAdapter]
    private let notifications: any CalendarNotificationStore
    private let scheduler: CalendarReminderScheduler
    private let preferences: UserDefaults
    private var connects: [CalendarProvider: Task<Void, Never>] = [:]
    private var refreshing = false
    private var refreshAgain = false
    private var reloadIntent = UUID()
    private var started = false
    private var starting = false
    private var reminderIntent = UUID()
    private var permissionIntent = UUID()
    private var pendingRoute: CalendarReminderRoute?
    private(set) var snapshots: [CalendarConnection] = []
    private(set) var loading = true
    private(set) var busyProviders: Set<CalendarProvider> = []
    var problem: String?
    var selectedEvent: CalendarOccurrence?
    var actionLibraryID = LibraryRecord.localID
    private(set) var remindersEnabled: Bool
    private(set) var leadMinutes: Int
    var fixtureMode = false

    init(store: CalendarAccountStore, providers: [CalendarProvider: any CalendarProviderAdapter],
         notifications: any CalendarNotificationStore, preferences: UserDefaults = .standard) {
        self.store = store; self.providers = providers; self.notifications = notifications; self.preferences = preferences
        scheduler = CalendarReminderScheduler(notifications: notifications)
        remindersEnabled = preferences.bool(forKey: "calendar.reminders")
        let lead = preferences.object(forKey: "calendar.lead") == nil ? 5 : preferences.integer(forKey: "calendar.lead")
        leadMinutes = [0, 5, 10, 15].contains(lead) ? lead : 5
    }
    var upcoming: [CalendarOccurrence] {
        let now = Date(), limit = now.addingTimeInterval(14 * 86400)
        return snapshots.filter { $0.state != .disconnecting }.flatMap(\.events)
            .filter { $0.end > now && $0.start < limit }.sorted { $0.start < $1.start }
    }
    func configured(_ provider: CalendarProvider) -> Bool { providers[provider] != nil }
    func accountName(_ key: EventOccurrenceKey) -> String {
        snapshots.first { $0.account.provider.rawValue == key.provider && $0.account.subject == key.accountID }?.displayName ?? key.provider
    }
    func start() async {
        guard !started, !starting else { return }
        starting = true
        defer { starting = false }
        do { try await store.finishPendingDisconnects() } catch { problem = "An account disconnect needs retrying in Calendar settings." }
        #if DEBUG
        if fixtureMode {
            for adapter in providers.values { _ = try? await store.connect(using: adapter) }
        }
        #endif
        await reload()
        loading = false
        started = true
        await refresh()
    }
    func reload() async {
        let intent = UUID(); reloadIntent = intent
        let latest = await store.snapshots()
        guard reloadIntent == intent else { return }
        snapshots = latest
        if let selectedEvent { self.selectedEvent = upcoming.first { $0.key == selectedEvent.key } }
        if !loading, let route = pendingRoute {
            pendingRoute = nil
            open(route)
        }
        await reconcileReminders()
    }
    func refresh() async {
        guard started else { return }
        if refreshing { refreshAgain = true; return }
        refreshing = true
        defer { refreshing = false }
        repeat {
            refreshAgain = false
            loading = true
            let accounts = await store.snapshots()
            for snapshot in accounts where snapshot.state == .connected {
                guard let adapter = providers[snapshot.account.provider] else { continue }
                do { try await store.refresh(snapshot.account, using: adapter,
                    window: CalendarWindow(start: Date(), end: Date().addingTimeInterval(14 * 86400))) }
                catch { /* account snapshot carries a safe failure while retaining cache */ }
            }
            loading = false
            await reload()
        } while refreshAgain
    }
    func connect(_ provider: CalendarProvider, existing: CalendarAccountKey? = nil) {
        guard let adapter = providers[provider], connects[provider] == nil else { return }
        busyProviders.insert(provider)
        connects[provider] = Task {
            do { _ = try await store.connect(using: adapter, existing: existing); problem = nil }
            catch { problem = CalendarFailure.safe(error) == .cancelled ? "Connection canceled." : "Calendar connection failed. Check account consent and try again." }
            busyProviders.remove(provider); connects.removeValue(forKey: provider)
            await reload(); await refresh()
        }
    }
    func cancel(_ provider: CalendarProvider) async {
        connects[provider]?.cancel()
        await store.cancelConnect(provider)
    }
    func disconnect(_ account: CalendarAccountKey) async {
        await cancel(account.provider)
        do { try await store.disconnect(account); problem = nil }
        catch { problem = "Account cleanup is pending. Retry disconnect." }
        await reload()
    }
    func select(_ calendarID: String, enabled: Bool, account: CalendarAccountKey) async {
        do { try await store.setSelected(calendarID, enabled: enabled, for: account) }
        catch { problem = "Calendar selection could not be saved." }
        await reload(); await refresh()
    }
    func enableReminders(_ enabled: Bool) async {
        let intent = UUID(); permissionIntent = intent
        if enabled {
            do {
                let granted = try await notifications.requestPermission()
                guard permissionIntent == intent else { return }
                guard granted else {
                    remindersEnabled = false; preferences.set(false, forKey: "calendar.reminders")
                    problem = "Notifications are disabled. Allow them in system Settings to receive reminders."
                    await reconcileReminders(); return
                }
            } catch { problem = "Notification permission could not be requested."; return }
        }
        remindersEnabled = enabled; preferences.set(enabled, forKey: "calendar.reminders")
        await reconcileReminders()
    }
    func setLead(_ minutes: Int) async {
        guard [0, 5, 10, 15].contains(minutes) else { return }
        leadMinutes = minutes; preferences.set(minutes, forKey: "calendar.lead")
        await reconcileReminders()
    }
    func setLibrary(_ id: UUID) async { actionLibraryID = id; await reconcileReminders() }
    func reconcileReminders() async {
        let intent = UUID(); reminderIntent = intent
        let allowed = await notifications.permitted()
        guard reminderIntent == intent else { return }
        if remindersEnabled && !allowed { problem = "Notifications are disabled in system Settings." }
        // Failed/offline accounts retain visible cache but cannot leave unverified future reminders scheduled.
        let current = snapshots.filter { $0.state == .connected && $0.failure == nil }.flatMap(\.events)
        await scheduler.replace(CalendarReminderScheduler.plan(events: current, libraryID: actionLibraryID,
            now: Date(), enabled: remindersEnabled && allowed, leadMinutes: leadMinutes))
        if let error = scheduler.problem { problem = error }
    }
    func openFromHome(_ event: CalendarOccurrence, libraryID: UUID) {
        actionLibraryID = libraryID
        selectedEvent = event
    }
    func open(_ route: CalendarReminderRoute) {
        if loading { pendingRoute = route; return }
        guard let event = upcoming.first(where: { $0.key == route.event }) else {
            problem = "This meeting is no longer available. Your notes are preserved."; return
        }
        actionLibraryID = route.libraryID
        selectedEvent = event
    }
}
