import Foundation

private struct MicrosoftCollection<T: Decodable>: Decodable {
    let value: [T]
    let next: String?
    enum CodingKeys: String, CodingKey { case value; case next = "@odata.nextLink" }
}
private struct MicrosoftCalendar: Decodable {
    let id: String
    let name: String
    let isDefaultCalendar: Bool?
}
private struct MicrosoftEvent: Decodable {
    struct Time: Decodable { let dateTime: String; let timeZone: String }
    let id: String
    let subject: String?
    let type: String
    let seriesMasterId: String?
    let originalStart: String?
    let originalStartTimeZone: String?
    let start: Time
    let end: Time
    let isAllDay: Bool
    let isCancelled: Bool

    func occurrence(account: CalendarAccountKey, calendarID: String) throws -> CalendarOccurrence? {
        if isCancelled { return nil }
        // UTC requested explicitly; never infer an offset from the device's zone.
        func instant(_ time: Time) throws -> Date {
            if time.dateTime.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil {
                return try CalendarDateNormalizer.instant(time.dateTime)
            }
            guard time.timeZone == "UTC" || time.timeZone == "Etc/UTC" else { throw CalendarFailure.invalidResponse }
            return try CalendarDateNormalizer.instant(time.dateTime + "Z")
        }
        let startDate = try instant(start), endDate = try instant(end)
        guard endDate > startDate, !id.isEmpty else { throw CalendarFailure.invalidResponse }
        guard !isAllDay || originalStartTimeZone != nil else { throw CalendarFailure.invalidResponse }
        let originalZone = originalStartTimeZone ?? "UTC"
        guard let zone = MicrosoftTimeZones.iana(originalZone) else { throw CalendarFailure.invalidResponse }
        let eventID: String, occurrenceID: String
        switch type {
        case "singleInstance": eventID = id; occurrenceID = id
        case "occurrence", "exception":
            guard let series = seriesMasterId, !series.isEmpty, let originalStart else { throw CalendarFailure.invalidResponse }
            eventID = series
            occurrenceID = ISO8601DateFormatter().string(from: try CalendarDateNormalizer.instant(originalStart))
        default: throw CalendarFailure.invalidResponse
        }
        return CalendarOccurrence(key: EventOccurrenceKey(provider: "microsoft", accountID: account.subject,
            calendarID: calendarID, eventID: eventID, occurrenceID: occurrenceID), title: subject ?? "Untitled meeting",
            start: startDate, end: endDate, timeZoneID: zone, isAllDay: isAllDay)
    }
}
private struct MicrosoftCursor: Codable {
    let account: CalendarAccountKey
    let calendars: [String]
    let window: CalendarWindow
    var index: Int
    var nextURL: String?
}

extension MicrosoftCalendarAdapter {
    func calendars(account: CalendarAccountKey, credential: CalendarSecret) async throws -> [CalendarDescriptor] {
        let path = "/v1.0/me/calendars"
        var url: URL? = URL(string: "https://graph.microsoft.com\(path)?$select=id,name,isDefaultCalendar&$top=100")!
        var seen = Set<String>(), result: [CalendarDescriptor] = []
        while let current = url {
            guard seen.insert(current.absoluteString).inserted, seen.count <= 100 else { throw CalendarFailure.invalidResponse }
            let data = try await graph(current, path: path, account: account, credential: credential)
            guard let page = try? JSONDecoder().decode(MicrosoftCollection<MicrosoftCalendar>.self, from: data) else {
                throw CalendarFailure.invalidResponse
            }
            result += page.value.map { CalendarDescriptor(id: $0.id, name: $0.name, isDefault: $0.isDefaultCalendar ?? false) }
            guard result.count <= 1000, Set(result.map(\.id)).count == result.count else { throw CalendarFailure.invalidResponse }
            url = try page.next.map { try graphURL($0, path: path) }
        }
        return result
    }

    func events(account: CalendarAccountKey, credential: CalendarSecret, calendarIDs: Set<String>,
                window: CalendarWindow, cursor: String?) async throws -> CalendarPage {
        _ = try CalendarWindow(start: window.start, end: window.end)
        let ids = calendarIDs.sorted()
        guard ids.count <= 1000 else { throw CalendarFailure.invalidResponse }
        guard !ids.isEmpty else { return CalendarPage(events: [], next: nil) }
        var position = MicrosoftCursor(account: account, calendars: ids, window: window, index: 0, nextURL: nil)
        if let cursor {
            guard cursor.utf8.count <= 65536, let data = Data(base64Encoded: cursor),
                  let decoded = try? JSONDecoder().decode(MicrosoftCursor.self, from: data),
                  decoded.account == account, decoded.calendars == ids, decoded.window == window,
                  ids.indices.contains(decoded.index) else { throw CalendarFailure.invalidResponse }
            position = decoded
        }
        let calendarID = ids[position.index]
        guard !calendarID.isEmpty, calendarID.utf8.count <= 2048,
              let encoded = calendarID.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw CalendarFailure.invalidResponse }
        let path = "/v1.0/me/calendars/\(encoded)/calendarView"
        var components = URLComponents(string: "https://graph.microsoft.com\(path)")!
        let format = ISO8601DateFormatter()
        components.queryItems = [URLQueryItem(name: "startDateTime", value: format.string(from: window.start)),
            URLQueryItem(name: "endDateTime", value: format.string(from: window.end)), URLQueryItem(name: "$top", value: "1000"),
            URLQueryItem(name: "$select", value: "id,subject,type,seriesMasterId,originalStart,originalStartTimeZone,start,end,isAllDay,isCancelled")]
        let url = try position.nextURL.map { try graphURL($0, path: path) } ?? components.url!
        let data = try await graph(url, path: path, account: account, credential: credential)
        guard let page = try? JSONDecoder().decode(MicrosoftCollection<MicrosoftEvent>.self, from: data), page.value.count <= 1000 else {
            throw CalendarFailure.invalidResponse
        }
        let events = try page.value.compactMap { try $0.occurrence(account: account, calendarID: calendarID) }
            .filter { $0.end > window.start && $0.start < window.end }
        if let next = page.next { position.nextURL = try graphURL(next, path: path).absoluteString }
        else { position.index += 1; position.nextURL = nil }
        let next = position.index < ids.count ? try JSONEncoder().encode(position).base64EncodedString() : nil
        return CalendarPage(events: events, next: next)
    }

    private func graphURL(_ value: String, path: String) throws -> URL {
        guard let url = URL(string: value), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "https", components.host == "graph.microsoft.com", components.port == nil,
              components.user == nil, components.password == nil, components.fragment == nil,
              components.percentEncodedPath == path else { throw CalendarFailure.invalidResponse }
        return url
    }
    private func graph(_ url: URL, path: String, account: CalendarAccountKey, credential: CalendarSecret) async throws -> Data {
        _ = try graphURL(url.absoluteString, path: path)
        let secret = try MicrosoftCredential.read(credential, account: account, clientID: configuration.clientID)
        guard secret.expiresAt > now() else { throw CalendarFailure.reauthenticationRequired }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(secret.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("outlook.timezone=\"UTC\", IdType=\"ImmutableId\"", forHTTPHeaderField: "Prefer")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        try Task.checkCancellation()
        let response = try await transport.send(request)
        try MicrosoftHTTP.check(response, now: now())
        return response.data
    }
}
