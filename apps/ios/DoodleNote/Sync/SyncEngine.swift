import Foundation
import SwiftData
import SwiftUI
import CryptoKit
import UIKit

/// Orchestrates cloud sync: device linking, push of locally-changed meetings,
/// pull of remote changes, and deletion reconciliation. Mirrors the desktop
/// sync-service rules in simplified form: push first ("our edits win"), then
/// pull; a locally-dirty meeting is never overwritten by a pull; remote
/// deletion removes a local meeting only if it was synced and is not dirty.
@MainActor
@Observable
final class SyncEngine: NSObject {
    static let shared = SyncEngine()

    private(set) var isSyncing = false
    private(set) var lastError: String?
    private(set) var lastSyncedAt: Date?

    var linkedEmail: String? {
        get { UserDefaults.standard.string(forKey: "sync.email") }
        set { UserDefaults.standard.set(newValue, forKey: "sync.email") }
    }
    var workspaceName: String? {
        get { UserDefaults.standard.string(forKey: "sync.workspace") }
        set { UserDefaults.standard.set(newValue, forKey: "sync.workspace") }
    }
    private var pullCursor: String? {
        get { UserDefaults.standard.string(forKey: "sync.pullCursor") }
        set { UserDefaults.standard.set(newValue, forKey: "sync.pullCursor") }
    }
    private var pendingDeletes: [String] {
        get { UserDefaults.standard.stringArray(forKey: "sync.pendingDeletes") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "sync.pendingDeletes") }
    }
    private var pendingFolderDeletes: [String] {
        get { UserDefaults.standard.stringArray(forKey: "sync.pendingFolderDeletes") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "sync.pendingFolderDeletes") }
    }

    var isLinked: Bool { Keychain.read(key: .syncToken) != nil }

    private var api: SyncAPI? {
        guard let token = Keychain.read(key: .syncToken) else { return nil }
        let base = ProcessInfo.processInfo.environment["DOODLE_SYNC_URL"]
            .flatMap(URL.init(string:)) ?? SyncAPI.productionBase
        return SyncAPI(baseURL: base, token: token)
    }

    // MARK: Device linking

    /// True while we've handed off to Safari and are waiting for the
    /// doodlenote://link callback.
    private(set) var isLinking = false
    private var linkTimeoutTask: Task<Void, Never>?

    /// Opens the account/approval flow in the real Safari app — same pattern
    /// as desktop (system browser + callback). The /link-device page redirects
    /// to doodlenote://link?token=dnsy_...&email=...&workspace=... on
    /// approval, which lands in handleCallback via onOpenURL. Using Safari
    /// instead of an in-app sheet keeps the user's existing web sessions and
    /// avoids embedded-browser quirks.
    func link() async {
        lastError = nil
        var components = URLComponents(
            url: (api?.baseURL ?? SyncAPI.productionBase).appending(path: "/link-device"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "scheme", value: "doodlenote"),
            URLQueryItem(name: "name", value: UIDevice.current.name),
        ]
        guard let url = components.url else { return }

        isLinking = true
        await UIApplication.shared.open(url)

        // Give the user 5 minutes to finish in Safari (matches desktop).
        linkTimeoutTask?.cancel()
        linkTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(300))
            guard let self, !Task.isCancelled, self.isLinking else { return }
            self.isLinking = false
        }
    }

    /// Callback from Safari (doodlenote://link?token=...). Wired in
    /// DoodleNoteApp via onOpenURL; safe to receive even on cold launch.
    func handleCallback(_ url: URL) {
        guard url.scheme == "doodlenote", url.host == "link" else { return }
        linkTimeoutTask?.cancel()
        isLinking = false

        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func item(_ name: String) -> String? { items.first { $0.name == name }?.value }

        guard let token = item("token"), token.hasPrefix("dnsy_") else {
            lastError = "Linking failed: no token returned."
            return
        }
        Keychain.save(key: .syncToken, value: token)
        linkedEmail = item("email")
        workspaceName = item("workspace")
        pullCursor = nil
        lastError = nil
    }

    func unlink() {
        Keychain.delete(key: .syncToken)
        linkedEmail = nil
        workspaceName = nil
        pullCursor = nil
        pendingDeletes = []
        pendingFolderDeletes = []
        lastError = nil
        lastSyncedAt = nil
    }

    // MARK: Deletion queue

    func noteDeleted(meeting: Meeting) {
        guard meeting.lastPushedHash != nil else { return }
        pendingDeletes = Array(Set(pendingDeletes + [meeting.id.uuidString.lowercased()]))
    }

    func noteFolderDeleted(id: UUID) {
        pendingFolderDeletes = Array(Set(pendingFolderDeletes + [id.uuidString.lowercased()]))
    }

    // MARK: Voice token (phone calls)

    struct VoiceToken: Codable {
        var token: String
        var identity: String
    }

    /// Fetches a telephony access token for outbound calls. Requires a linked
    /// account (calls are an add-on tied to the workspace).
    func voiceToken() async throws -> VoiceToken {
        guard let api else {
            throw SyncAPI.SyncError.invalidToken
        }
        return try await api.voiceToken()
    }

    /// Verified Caller ID management — requires a linked account.
    func callerIdAPI() throws -> SyncAPI {
        guard let api else {
            throw SyncAPI.SyncError.invalidToken
        }
        return api
    }

    // MARK: Sync cycle

    func syncNow(context: ModelContext) async {
        guard let api, !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        do {
            try await pushDeletes(api: api)
            try await pushFolders(api: api, context: context)
            try await pushDirty(api: api, context: context)
            try await pullChanges(api: api, context: context)
            lastSyncedAt = .now
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func pushDeletes(api: SyncAPI) async throws {
        let ids = pendingDeletes
        let folderIds = pendingFolderDeletes
        guard !ids.isEmpty || !folderIds.isEmpty else { return }
        try await api.delete(ids: ids, folderIds: folderIds)
        pendingDeletes = []
        pendingFolderDeletes = []
    }

    /// Folders are cheap (≤100): push the full local set every cycle; the
    /// server upserts. Push-before-pull keeps local renames authoritative.
    private func pushFolders(api: SyncAPI, context: ModelContext) async throws {
        let folders = try context.fetch(FetchDescriptor<Folder>())
        guard !folders.isEmpty else { return }
        try await api.push(folders: folders.map {
            SyncAPI.PushFolder(
                id: $0.id.uuidString.lowercased(),
                name: $0.name,
                createdAt: isoString($0.createdAt)
            )
        })
        for folder in folders {
            folder.synced = true
        }
    }

    private func pushDirty(api: SyncAPI, context: ModelContext) async throws {
        let meetings = try context.fetch(FetchDescriptor<Meeting>())
        // Hashing every transcript is CPU-heavy and this runs on @MainActor;
        // yield every few meetings so an in-progress scroll isn't frozen.
        var dirty: [Meeting] = []
        for (i, meeting) in meetings.enumerated() {
            if contentHash(of: meeting) != meeting.lastPushedHash { dirty.append(meeting) }
            if i % 8 == 7 { await Task.yield() }
        }
        guard !dirty.isEmpty else { return }

        for batch in dirty.chunked(into: 20) {
            let payload = batch.map { wireMeeting(from: $0) }
            let results = try await api.push(meetings: payload)
            for result in results where result.ok {
                if let meeting = batch.first(where: {
                    $0.id.uuidString.lowercased() == result.id.lowercased()
                }) {
                    meeting.lastPushedHash = contentHash(of: meeting)
                }
            }
        }
        try? context.save()
    }

    private func pullChanges(api: SyncAPI, context: ModelContext) async throws {
        var cursor = pullCursor
        var latestAllIds: Set<String>?
        var remoteFolders: [SyncAPI.RemoteFolder] = []

        var didChange = false
        for _ in 0..<40 {
            let page = try await api.pull(since: cursor)
            latestAllIds = Set(page.allIds.map { $0.lowercased() })
            remoteFolders = page.folders

            if !page.changed.isEmpty { didChange = true }
            for remote in page.changed {
                apply(remote: remote, context: context)
                cursor = max(cursor ?? "", remote.updatedAt)
            }
            if !page.hasMore { break }
        }
        pullCursor = cursor

        if !remoteFolders.isEmpty { didChange = true }
        applyFolders(remoteFolders, context: context)

        // Deletion reconciliation: a synced, non-dirty local meeting missing
        // from the cloud's complete id list was deleted remotely. Yields so
        // this per-meeting hash scan doesn't freeze the UI.
        if let cloudIds = latestAllIds {
            let meetings = try context.fetch(FetchDescriptor<Meeting>())
            for (i, meeting) in meetings.enumerated() {
                let id = meeting.id.uuidString.lowercased()
                let wasSynced = meeting.lastPushedHash != nil
                let isDirty = contentHash(of: meeting) != meeting.lastPushedHash
                if wasSynced, !isDirty, !cloudIds.contains(id) {
                    context.delete(meeting)
                    didChange = true
                }
                if i % 8 == 7 { await Task.yield() }
            }
        }
        // Only save (and republish @Query → relist) when something changed —
        // a no-op sync must not re-render the list mid-scroll.
        if didChange { try? context.save() }
    }

    /// Create/rename folders from the server's full list; remove local
    /// synced folders the server no longer has. Runs after push, so local
    /// renames have already won.
    private func applyFolders(_ remote: [SyncAPI.RemoteFolder], context: ModelContext) {
        let locals = (try? context.fetch(FetchDescriptor<Folder>())) ?? []
        let remoteById = Dictionary(
            uniqueKeysWithValues: remote.compactMap { folder in
                UUID(uuidString: folder.id).map { ($0, folder) }
            }
        )

        for local in locals {
            if let match = remoteById[local.id] {
                if local.name != match.name { local.name = match.name }
                local.synced = true
            } else if local.synced {
                for meeting in (try? context.fetch(FetchDescriptor<Meeting>())) ?? []
                where meeting.folderId == local.id {
                    meeting.folderId = nil
                }
                context.delete(local)
            }
        }
        let localIds = Set(locals.map(\.id))
        for (id, folder) in remoteById where !localIds.contains(id) {
            context.insert(Folder(
                id: id,
                name: folder.name,
                createdAt: parseISO(folder.createdAt) ?? .now,
                synced: true
            ))
        }
    }

    private func apply(remote: SyncAPI.RemoteMeeting, context: ModelContext) {
        guard let uuid = UUID(uuidString: remote.id) else { return }
        let meetings = (try? context.fetch(FetchDescriptor<Meeting>())) ?? []
        let existing = meetings.first { $0.id == uuid }

        if let existing {
            // Local edits win until pushed.
            let isDirty = contentHash(of: existing) != existing.lastPushedHash
            if isDirty { return }
            update(meeting: existing, from: remote, context: context)
        } else {
            let meeting = Meeting(id: uuid, origin: "cloud")
            context.insert(meeting)
            update(meeting: meeting, from: remote, context: context)
        }
    }

    private func update(meeting: Meeting, from remote: SyncAPI.RemoteMeeting, context: ModelContext) {
        meeting.title = remote.title
        meeting.kind = remote.kind == "note" ? "note" : nil
        meeting.createdAt = parseISO(remote.createdAt) ?? meeting.createdAt
        meeting.startedAt = remote.startedAt.flatMap(parseISO)
        meeting.endedAt = remote.endedAt.flatMap(parseISO)
        meeting.calendarEventId = remote.calendarEventId
        meeting.folderId = remote.folderId.flatMap(UUID.init(uuidString:))
        meeting.roughNotes = remote.rawNotesMarkdown
        meeting.generatedNotes = remote.enhancedMarkdown

        for segment in meeting.segments {
            context.delete(segment)
        }
        for wire in remote.segments {
            let segment = Segment(
                channel: wire.channel,
                // Desktop convention: mic = the note-taker, system = the other side.
                speaker: wire.channel == "mic" ? "You" : "Them",
                text: wire.text,
                startMs: wire.startMs,
                endMs: wire.endMs,
                confidence: wire.confidence
            )
            segment.meeting = meeting
            context.insert(segment)
        }
        meeting.lastPushedHash = contentHash(of: meeting)
    }

    // MARK: Helpers

    private func wireMeeting(from meeting: Meeting) -> SyncAPI.PushMeeting {
        SyncAPI.PushMeeting(
            id: meeting.id.uuidString.lowercased(),
            title: meeting.displayTitle,
            kind: meeting.isNote ? "note" : nil,
            createdAt: isoString(meeting.createdAt),
            startedAt: meeting.startedAt.map(isoString),
            endedAt: meeting.endedAt.map(isoString),
            calendarEventId: meeting.calendarEventId,
            folderId: meeting.folderId?.uuidString.lowercased(),
            rawNotesMarkdown: meeting.roughNotes.isEmpty ? nil : meeting.roughNotes,
            enhancedMarkdown: meeting.generatedNotes,
            segments: meeting.sortedSegments.prefix(5000).map {
                SyncAPI.PushSegment(
                    channel: $0.channel == "system" ? "system" : "mic",
                    speaker: $0.speaker,
                    text: String($0.text.prefix(10_000)),
                    startMs: $0.startMs,
                    endMs: $0.endMs,
                    confidence: $0.confidence
                )
            }
        )
    }

    /// Local change-detection hash over the same fields the desktop hashes.
    private func contentHash(of meeting: Meeting) -> String {
        var parts: [String] = [
            meeting.displayTitle,
            meeting.kind ?? "",
            meeting.startedAt.map(isoString) ?? "",
            meeting.endedAt.map(isoString) ?? "",
            meeting.calendarEventId ?? "",
            meeting.folderId?.uuidString.lowercased() ?? "",
            meeting.roughNotes,
            meeting.generatedNotes ?? "",
        ]
        for segment in meeting.sortedSegments {
            parts.append("\(segment.channel)|\(segment.speaker)|\(segment.text)|\(segment.startMs)|\(segment.endMs)")
        }
        let digest = SHA256.hash(data: Data(parts.joined(separator: "\u{1F}").utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func isoString(_ date: Date) -> String {
        date.ISO8601Format(.iso8601(timeZone: .gmt, includingFractionalSeconds: true))
    }

    private func parseISO(_ string: String) -> Date? {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string))
            ?? (try? Date.ISO8601FormatStyle().parse(string))
    }
}


private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
