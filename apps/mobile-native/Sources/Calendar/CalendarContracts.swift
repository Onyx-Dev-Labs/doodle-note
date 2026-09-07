import Foundation

enum CalendarProvider: String, Codable, CaseIterable, Sendable { case google, microsoft }

struct CalendarAccountKey: Codable, Hashable, Sendable {
    let provider: CalendarProvider
    /// Stable provider subject (Microsoft tenant + object ID), never display email.
    let subject: String
    var storageKey: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return (try! encoder.encode(self)).base64EncodedString()
    }
}

struct CalendarDescriptor: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let isDefault: Bool
}

struct CalendarOccurrence: Codable, Equatable, Sendable {
    let key: EventOccurrenceKey
    let title: String
    let start: Date
    let end: Date
    /// All-day dates retain the originating zone, never interpreted in the device zone.
    let timeZoneID: String
    let isAllDay: Bool
    var joinURL: String? = nil
    var invitees: [String]? = nil

    var safeJoinURL: URL? {
        guard let joinURL, joinURL.count <= 8192, let url = URL(string: joinURL), url.scheme == "https",
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

struct CalendarWindow: Codable, Equatable, Sendable {
    let start: Date
    let end: Date
    init(start: Date, end: Date) throws {
        guard start.timeIntervalSince1970.isFinite, end.timeIntervalSince1970.isFinite,
              end > start, end.timeIntervalSince(start) <= 32 * 86400 else { throw CalendarFailure.invalidResponse }
        self.start = start
        self.end = end
    }
}

struct CalendarPage: Sendable {
    let events: [CalendarOccurrence]
    /// Adapter-owned opaque pagination cursor. Never persist or log it.
    let next: String?
}

struct CalendarSecret: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let data: Data
    var description: String { "<calendar credential>" }
    var debugDescription: String { description }
}

struct CalendarAuthorization: Sendable {
    let account: CalendarAccountKey
    let displayName: String
    let credential: CalendarSecret
}

/// No event mutation/invitation methods. Adapters own OAuth/PKCE, token refresh and provider normalization.
protocol CalendarProviderAdapter: Sendable {
    var provider: CalendarProvider { get }
    func authorize(existing: CalendarAccountKey?) async throws -> CalendarAuthorization
    func renewCredential(account: CalendarAccountKey, credential: CalendarSecret) async throws -> CalendarSecret
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor]
    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>,
                window: CalendarWindow, cursor: String?) async throws -> CalendarPage
}

enum CalendarFailure: Error, Codable, Equatable, Sendable {
    case cancelled, offline, reauthenticationRequired, invalidResponse, storage, unavailable
    case rateLimited(retryAt: Date)
    case transient

    static func safe(_ error: Error) -> CalendarFailure {
        if error is CancellationError { return .cancelled }
        return error as? CalendarFailure ?? .unavailable
    }
}

struct CalendarConnection: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable { case connected, reauthenticationRequired, disconnecting }
    let account: CalendarAccountKey
    var displayName: String
    var state: State = .connected
    /// nil chooses provider defaults; empty deliberately hides all calendars.
    var selectedCalendarIDs: Set<String>? = nil
    var calendars: [CalendarDescriptor] = []
    var events: [CalendarOccurrence] = []
    var window: CalendarWindow? = nil
    var refreshedAt: Date? = nil
    var failure: CalendarFailure? = nil
}

/// Reject ambiguous timestamps instead of silently assigning the current device timezone.
enum CalendarDateNormalizer {
    static func instant(_ iso: String) throws -> Date {
        guard iso.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil else {
            throw CalendarFailure.invalidResponse
        }
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = format.date(from: iso) { return value }
        format.formatOptions = [.withInternetDateTime]
        guard let value = format.date(from: iso) else { throw CalendarFailure.invalidResponse }
        return value
    }

    static func day(_ date: String, timeZoneID: String) throws -> Date {
        guard let zone = TimeZone(identifier: timeZoneID) else { throw CalendarFailure.invalidResponse }
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.calendar = Calendar(identifier: .gregorian)
        format.timeZone = zone
        format.dateFormat = "yyyy-MM-dd"
        format.isLenient = false
        guard let value = format.date(from: date), format.string(from: value) == date else {
            throw CalendarFailure.invalidResponse
        }
        return value
    }
}
