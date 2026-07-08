import Foundation
import EventKit
import Observation

/// Snapshot of an upcoming calendar event for the "Coming up" section.
struct UpcomingEvent: Identifiable, Equatable {
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

    enum Access { case unknown, granted, denied }

    private(set) var access: Access = .unknown
    private(set) var upcoming: [UpcomingEvent] = []

    private let store = EKEventStore()

    func requestAndLoad() async {
        if access == .unknown {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess:
                access = .granted
            case .denied, .restricted, .writeOnly:
                access = .denied
            default:
                do {
                    access = try await store.requestFullAccessToEvents() ? .granted : .denied
                } catch {
                    access = .denied
                }
            }
        }
        guard access == .granted else { return }
        load()
    }

    func load() {
        let start = Date().addingTimeInterval(-30 * 60)
        guard let end = Calendar.current.date(byAdding: .day, value: 7, to: .now) else { return }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        upcoming = store.events(matching: predicate)
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
