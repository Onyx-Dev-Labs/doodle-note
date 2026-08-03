import Foundation
import UserNotifications
import Observation

/// Lock-screen "meeting starting" notifications with a Start notes action,
/// and the routing that turns a tapped notification into a recording meeting.
@MainActor
@Observable
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()

    struct PendingStart: Equatable {
        var eventId: String
        var title: String
    }

    /// Set when the user taps "Start notes" on a notification; HomeView
    /// observes this and opens a recording meeting.
    var pendingStart: PendingStart?
    private(set) var authorization: Authorization = .unknown

    enum Authorization: Equatable {
        case unknown
        case granted
        case denied
    }

    private static let categoryId = "MEETING_START"
    private static let actionId = "START_NOTES"

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let start = UNNotificationAction(
            identifier: Self.actionId,
            title: "Start notes",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: Self.categoryId,
            actions: [start],
            intentIdentifiers: []
        )
        center.setNotificationCategories([category])
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorization = Self.authorization(from: settings.authorizationStatus)
    }

    /// Requests notification access after the user explicitly enables meeting
    /// reminders, then schedules the current calendar snapshot.
    func requestAuthorizationAndSchedule(for events: [UpcomingEvent]) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        await refreshAuthorization()
        guard granted || authorization == .granted else { return false }
        await schedule(for: events)
        return true
    }

    func disableNotifications() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    /// Reschedules one notification per upcoming event (next 24h), replacing
    /// the previous schedule. Never prompts; prompting belongs to an explicit
    /// user action in Settings.
    func schedule(for events: [UpcomingEvent]) async {
        let center = UNUserNotificationCenter.current()
        guard UserDefaults.standard.bool(forKey: "meetingNotifications") else {
            center.removeAllPendingNotificationRequests()
            return
        }
        let settings = await center.notificationSettings()
        authorization = Self.authorization(from: settings.authorizationStatus)
        guard authorization == .granted else {
            center.removeAllPendingNotificationRequests()
            return
        }

        center.removeAllPendingNotificationRequests()
        for event in events {
            let delay = event.start.timeIntervalSinceNow
            guard delay > 5, delay < 24 * 60 * 60 else { continue }

            let content = UNMutableNotificationContent()
            content.title = event.title
            content.body = "Starting now — tap to take notes with DoodleNote."
            content.sound = .default
            content.categoryIdentifier = Self.categoryId
            content.userInfo = ["eventId": event.id, "title": event.title]

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
            let request = UNNotificationRequest(
                identifier: "meeting-\(event.id)",
                content: content,
                trigger: trigger
            )
            try? await center.add(request)
        }
    }

    private static func authorization(from status: UNAuthorizationStatus) -> Authorization {
        switch status {
        case .authorized, .provisional, .ephemeral: .granted
        case .denied: .denied
        case .notDetermined: .unknown
        @unknown default: .unknown
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let eventId = info["eventId"] as? String else { return }
        let title = info["title"] as? String ?? "Meeting"
        await MainActor.run {
            self.pendingStart = PendingStart(eventId: eventId, title: title)
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
