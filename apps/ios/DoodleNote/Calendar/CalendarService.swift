import Foundation
import EventKit
import Observation

/// Snapshot of an upcoming calendar event for the "Coming up" section.
struct UpcomingEvent: Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var start: Date
    var end: Date
    var attendeeCount: Int

    var isImminent: Bool {
        start.timeIntervalSinceNow < 15 * 60 && end.timeIntervalSinceNow > 0
    }
}

/// Reads the phone's calendars via EventKit — this covers Google/Microsoft
/// accounts already added to iOS, so no OAuth of our own is needed on the
/// phone (unlike desktop, which talks to Microsoft/Google APIs directly).
@MainActor
@Observable
final class CalendarService {
    static let shared = CalendarService()

    enum Access: Equatable { case unknown, granted, denied }

    private(set) var access: Access = .unknown
    private(set) var upcoming: [UpcomingEvent] = []

    private let loader = CalendarEventLoader()

    /// Refreshes the current system authorization every time the app becomes
    /// active. The system prompt is only shown after an explicit user action.
    func refresh(promptIfNeeded: Bool) async {
        let status = await loader.authorizationStatus()
        switch status {
        case .fullAccess:
            access = .granted
        case .denied, .restricted, .writeOnly:
            access = .denied
            upcoming = []
        default:
            guard promptIfNeeded else {
                access = .unknown
                upcoming = []
                return
            }
            do {
                access = try await loader.requestAccess() ? .granted : .denied
            } catch {
                access = .denied
            }
        }

        guard access == .granted else { return }
        upcoming = await loader.loadUpcoming()
    }
}

/// EventKit performs a synchronous fetch. Keeping its store inside an actor
/// prevents calendar reads and sorting from blocking SwiftUI's main actor.
private actor CalendarEventLoader {
    private let store = EKEventStore()

    func authorizationStatus() -> EKAuthorizationStatus {
        EKEventStore.authorizationStatus(for: .event)
    }

    func requestAccess() async throws -> Bool {
        try await store.requestFullAccessToEvents()
    }

    func loadUpcoming() -> [UpcomingEvent] {
        let start = Date().addingTimeInterval(-30 * 60)
        guard let end = Calendar.current.date(byAdding: .day, value: 7, to: .now) else { return [] }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        return store.events(matching: predicate)
            .filter { !$0.isAllDay && $0.endDate > .now }
            .sorted { $0.startDate < $1.startDate }
            .prefix(12)
            .map { event in
                UpcomingEvent(
                    id: event.eventIdentifier ?? UUID().uuidString,
                    title: event.title ?? "Untitled event",
                    start: event.startDate,
                    end: event.endDate,
                    attendeeCount: event.attendees?.count ?? 0
                )
            }
    }
}
