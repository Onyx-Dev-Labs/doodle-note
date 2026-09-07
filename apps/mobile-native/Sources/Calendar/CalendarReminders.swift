import Foundation
import CryptoKit
import UserNotifications

struct CalendarReminderRoute: Codable, Equatable, Sendable {
    let event: EventOccurrenceKey
    let libraryID: UUID
    var identifier: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let bytes = (try? encoder.encode(self)) ?? Data()
        return "doodlenote.calendar." + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}
struct CalendarReminder: Equatable, Sendable {
    let route: CalendarReminderRoute
    let fireAt: Date
}
@MainActor protocol CalendarNotificationStore {
    func requestPermission() async throws -> Bool
    func permitted() async -> Bool
    func replace(_ reminders: [CalendarReminder]) async throws
}

@MainActor final class NativeCalendarNotifications: NSObject, CalendarNotificationStore, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    var onOpen: ((CalendarReminderRoute) -> Void)?
    override init() { super.init(); center.delegate = self }
    func requestPermission() async throws -> Bool { try await center.requestAuthorization(options: [.alert, .sound]) }
    func permitted() async -> Bool {
        let state = await center.notificationSettings().authorizationStatus
        return state == .authorized || state == .provisional
    }
    func replace(_ reminders: [CalendarReminder]) async throws {
        let old = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix("doodlenote.calendar.") }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: old)
        for reminder in reminders {
            let content = UNMutableNotificationContent()
            content.title = "Upcoming meeting"
            content.body = "Open DoodleNote to join or take notes."
            content.sound = .default
            content.userInfo = ["calendarRoute": try JSONEncoder().encode(reminder.route).base64EncodedString()]
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
            var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fireAt)
            components.timeZone = calendar.timeZone
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            try await center.add(UNNotificationRequest(identifier: reminder.route.identifier, content: content, trigger: trigger))
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let encoded = response.notification.request.content.userInfo["calendarRoute"] as? String,
              encoded.count <= 16_384, let data = Data(base64Encoded: encoded),
              let route = try? JSONDecoder().decode(CalendarReminderRoute.self, from: data) else { return }
        await MainActor.run { onOpen?(route) }
    }
}

/// Serial replacement prevents a stale scheduling pass from resurrecting canceled reminders.
@MainActor final class CalendarReminderScheduler {
    private let notifications: any CalendarNotificationStore
    private var pending: [CalendarReminder]?
    private var work: Task<Void, Never>?
    private(set) var problem: String?
    init(notifications: any CalendarNotificationStore) { self.notifications = notifications }
    static func plan(events: [CalendarOccurrence], libraryID: UUID, now: Date, enabled: Bool, leadMinutes: Int) -> [CalendarReminder] {
        guard enabled else { return [] }
        return events.filter { !$0.isAllDay && $0.start < now.addingTimeInterval(14 * 86400) }
            .sorted { $0.start < $1.start }.compactMap { event in
                let time = event.start.addingTimeInterval(-Double(leadMinutes) * 60)
                return time > now ? CalendarReminder(route: CalendarReminderRoute(event: event.key, libraryID: libraryID), fireAt: time) : nil
            }.prefix(50).map { $0 }
    }
    func replace(_ reminders: [CalendarReminder]) async {
        pending = reminders
        if work == nil {
            work = Task {
                while let next = pending {
                    pending = nil
                    do { try await notifications.replace(next); problem = nil }
                    catch { problem = "Reminders could not be updated. Try again." }
                }
                work = nil
            }
        }
        await work?.value
    }
}
