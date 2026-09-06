import Foundation

actor CalendarAccountStore {
    private struct Cache: Codable { var version = 1; var connections: [CalendarConnection] = [] }
    private let file: URL
    private let credentials: any CalendarCredentialStore
    private var cache: Cache
    private var attempts: [CalendarProvider: UUID] = [:]
    private var generations: [CalendarAccountKey: UUID] = [:]
    private var refreshing: [CalendarAccountKey: UUID] = [:]
    private var retries: [CalendarAccountKey: Int] = [:]
    private let persist: @Sendable (Data, URL) throws -> Void

    init(directory: URL, credentials: any CalendarCredentialStore = KeychainCalendarCredentials(),
         persist: @escaping @Sendable (Data, URL) throws -> Void = { data, url in
             try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
         }) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var directory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        file = directory.appendingPathComponent("calendar-cache.json")
        self.credentials = credentials
        self.persist = persist
        if FileManager.default.fileExists(atPath: file.path) {
            cache = try JSONDecoder().decode(Cache.self, from: Data(contentsOf: file))
            guard cache.version == 1, Set(cache.connections.map(\.account)).count == cache.connections.count else {
                throw CalendarFailure.storage
            }
            for connection in cache.connections {
                guard !connection.account.subject.isEmpty,
                      connection.events.allSatisfy({ $0.key.provider == connection.account.provider.rawValue && $0.key.accountID == connection.account.subject }),
                      Set(connection.calendars.map(\.id)).count == connection.calendars.count else { throw CalendarFailure.storage }
                if let window = connection.window { _ = try CalendarWindow(start: window.start, end: window.end) }
            }
        } else { cache = Cache() }
    }

    func snapshots() -> [CalendarConnection] { cache.connections }
    func connecting() -> Set<CalendarProvider> { Set(attempts.keys) }
    func isRefreshing(_ account: CalendarAccountKey) -> Bool { refreshing[account] != nil }

    private func commit(_ candidate: Cache) throws {
        do { try persist(JSONEncoder().encode(candidate), file); cache = candidate }
        catch { throw CalendarFailure.storage }
    }

    func cancelConnect(_ provider: CalendarProvider) { attempts.removeValue(forKey: provider) }

    @discardableResult
    func connect(using adapter: any CalendarProviderAdapter, existing: CalendarAccountKey? = nil) async throws -> CalendarAccountKey {
        guard existing == nil || (existing?.provider == adapter.provider && cache.connections.contains(where: {
            $0.account == existing && $0.state != .disconnecting
        })) else { throw CalendarFailure.invalidResponse }
        let ticket = UUID()
        attempts[adapter.provider] = ticket
        defer { if attempts[adapter.provider] == ticket { attempts.removeValue(forKey: adapter.provider) } }
        do {
            let result = try await adapter.authorize(existing: existing)
            guard attempts[adapter.provider] == ticket, !Task.isCancelled else { throw CalendarFailure.cancelled }
            guard result.account.provider == adapter.provider, !result.account.subject.isEmpty, result.account.subject.utf8.count <= 2048, result.displayName.utf8.count <= 1024,
                  existing == nil || existing == result.account,
                  !cache.connections.contains(where: { $0.account == result.account && $0.state == .disconnecting }) else {
                throw CalendarFailure.invalidResponse
            }
            let isNew = !cache.connections.contains { $0.account == result.account }
            if isNew {
                // Persist cleanup intent before any Keychain write, so failed rollback remains retryable after restart.
                var intent = cache
                var pending = CalendarConnection(account: result.account, displayName: result.displayName)
                pending.state = .disconnecting
                intent.connections.append(pending)
                try commit(intent)
            }
            generations[result.account] = UUID()
            do {
                try credentials.write(result.credential, for: result.account)
                var candidate = cache
                guard let i = candidate.connections.firstIndex(where: { $0.account == result.account }) else { throw CalendarFailure.storage }
                candidate.connections[i].displayName = result.displayName
                candidate.connections[i].state = .connected
                candidate.connections[i].failure = nil
                try commit(candidate)
            } catch {
                if isNew { try? disconnect(result.account) }
                // Reauth retains the fresh credential under the existing account if cache persistence fails.
                throw CalendarFailure.storage
            }
            generations[result.account] = UUID()
            return result.account
        } catch { throw CalendarFailure.safe(error) }
    }

    /// Durable disconnect intent precedes removal. Failure leaves a retryable, unusable account.
    /// Caller can retry these on launch; this store has no note-directory access.
    func disconnect(_ account: CalendarAccountKey) throws {
        attempts.removeValue(forKey: account.provider)
        generations[account] = UUID()
        refreshing.removeValue(forKey: account)
        guard let i = cache.connections.firstIndex(where: { $0.account == account }) else {
            try credentials.remove(account)
            return
        }
        var candidate = cache
        candidate.connections[i].state = .disconnecting
        candidate.connections[i].events = []
        candidate.connections[i].calendars = []
        candidate.connections[i].selectedCalendarIDs = nil
        candidate.connections[i].window = nil
        try commit(candidate)
        try credentials.remove(account)
        candidate.connections.removeAll { $0.account == account }
        try commit(candidate)
        retries.removeValue(forKey: account)
    }

    func finishPendingDisconnects() throws {
        for account in cache.connections.filter({ $0.state == .disconnecting }).map(\.account) { try disconnect(account) }
    }

    func select(_ ids: Set<String>?, for account: CalendarAccountKey) throws {
        guard let i = cache.connections.firstIndex(where: { $0.account == account && $0.state != .disconnecting }),
              ids.map({ $0.isSubset(of: Set(cache.connections[i].calendars.map(\.id))) }) ?? true else {
            throw CalendarFailure.invalidResponse
        }
        generations[account] = UUID()
        var candidate = cache
        candidate.connections[i].selectedCalendarIDs = ids
        // An old selection's response cannot overwrite this preference or show hidden calendars.
        let selected = ids ?? Set(candidate.connections[i].calendars.filter(\.isDefault).map(\.id))
        candidate.connections[i].events.removeAll { !selected.contains($0.key.calendarID) }
        try commit(candidate)
    }

    /// Coalesces simultaneous refreshes per account. Cross-account reads remain independent.
    func refresh(_ account: CalendarAccountKey, using adapter: any CalendarProviderAdapter,
                 window: CalendarWindow, now: Date = Date()) async throws {
        _ = try CalendarWindow(start: window.start, end: window.end)
        guard adapter.provider == account.provider,
              let initial = cache.connections.first(where: { $0.account == account && $0.state == .connected }) else {
            throw CalendarFailure.reauthenticationRequired
        }
        if case .rateLimited(let retryAt) = initial.failure, now < retryAt { throw CalendarFailure.rateLimited(retryAt: retryAt) }
        guard refreshing[account] == nil else { return }
        let generation = generations[account] ?? UUID()
        generations[account] = generation
        let refreshTicket = UUID()
        refreshing[account] = refreshTicket
        defer { if refreshing[account] == refreshTicket { refreshing.removeValue(forKey: account) } }
        do {
            guard let oldSecret = try credentials.read(account) else { throw CalendarFailure.reauthenticationRequired }
            let secret = try await adapter.renewCredential(account: account, credential: oldSecret)
            try ensureCurrent(account, generation)
            try credentials.write(secret, for: account)
            let calendars = try await adapter.calendars(account: account, credential: secret)
            guard calendars.count <= 1000, Set(calendars.map(\.id)).count == calendars.count, calendars.allSatisfy({ !$0.id.isEmpty && $0.id.utf8.count <= 2048 && $0.name.utf8.count <= 4096 }) else {
                throw CalendarFailure.invalidResponse
            }
            let selected = initial.selectedCalendarIDs ?? Set(calendars.filter(\.isDefault).map(\.id))
            var events: [CalendarOccurrence] = []
            var cursors: Set<String> = []
            var cursor: String? = nil
            if !selected.isEmpty {
                repeat {
                    try ensureCurrent(account, generation)
                    let page = try await adapter.events(account: account, credential: secret, calendarIDs: selected,
                                                        window: window, cursor: cursor)
                    guard page.events.count <= 20_000 else { throw CalendarFailure.invalidResponse }
                    events.append(contentsOf: page.events)
                    cursor = page.next
                    if let cursor {
                        guard cursors.insert(cursor).inserted, cursors.count < 100 else { throw CalendarFailure.invalidResponse }
                    }
                    guard events.count <= 20_000 else { throw CalendarFailure.invalidResponse }
                } while cursor != nil
            }
            try ensureCurrent(account, generation)
            guard events.allSatisfy({ event in
                event.key.provider == account.provider.rawValue && event.key.accountID == account.subject &&
                selected.contains(event.key.calendarID) && !event.key.eventID.isEmpty && !event.key.occurrenceID.isEmpty &&
                event.key.eventID.utf8.count <= 4096 && event.key.occurrenceID.utf8.count <= 4096 && event.title.utf8.count <= 16_384 &&
                event.start.timeIntervalSince1970.isFinite && event.end.timeIntervalSince1970.isFinite &&
                event.end > event.start && event.end > window.start && event.start < window.end && TimeZone(identifier: event.timeZoneID) != nil
            }) else { throw CalendarFailure.invalidResponse }
            var candidate = cache
            guard let i = candidate.connections.firstIndex(where: { $0.account == account }) else { throw CalendarFailure.cancelled }
            candidate.connections[i].calendars = calendars
            // Page-boundary duplicates are acceptable; conflicting copies are rejected.
            var unique: [EventOccurrenceKey: CalendarOccurrence] = [:]
            for event in events {
                guard unique[event.key] == nil || unique[event.key] == event else { throw CalendarFailure.invalidResponse }
                unique[event.key] = event
            }
            candidate.connections[i].events = unique.values.sorted { $0.start < $1.start }
            candidate.connections[i].window = window
            candidate.connections[i].refreshedAt = now
            candidate.connections[i].failure = nil
            try commit(candidate)
            retries[account] = 0
        } catch {
            let safe = CalendarFailure.safe(error)
            guard generations[account] == generation else { throw CalendarFailure.cancelled }
            var candidate = cache
            if let i = candidate.connections.firstIndex(where: { $0.account == account && $0.state == .connected }) {
                if safe == .reauthenticationRequired { candidate.connections[i].state = .reauthenticationRequired }
                if safe == .transient {
                    let attempt = min((retries[account] ?? 0) + 1, 8)
                    retries[account] = attempt
                    candidate.connections[i].failure = .rateLimited(retryAt: now.addingTimeInterval(min(pow(2, Double(attempt)), 300)))
                } else { candidate.connections[i].failure = safe }
                try commit(candidate)
            }
            throw safe
        }
    }

    private func ensureCurrent(_ account: CalendarAccountKey, _ generation: UUID) throws {
        guard !Task.isCancelled, generations[account] == generation,
              cache.connections.contains(where: { $0.account == account && $0.state == .connected }) else {
            throw CalendarFailure.cancelled
        }
    }
}
