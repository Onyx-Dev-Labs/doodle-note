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
        let preparedByID = await prepareMeetings(meetings)
        let dirty = meetings.compactMap { meeting -> DirtyMeeting? in
            guard let prepared = preparedByID[meeting.id],
                  prepared.hash != meeting.lastPushedHash else { return nil }
            return DirtyMeeting(meeting: meeting, prepared: prepared)
        }
        guard !dirty.isEmpty else { return }

        for batch in dirty.chunked(into: 20) {
            let payload = batch.map(\.prepared.wire)
            let results = try await api.push(meetings: payload)
            for result in results where result.ok {
                if let item = batch.first(where: {
                    $0.meeting.id.uuidString.lowercased() == result.id.lowercased()
                }) {
                    item.meeting.lastPushedHash = item.prepared.hash
                }
            }
        }
        try? context.save()
    }

    private func pullChanges(api: SyncAPI, context: ModelContext) async throws {
        var cursor = pullCursor
        var latestAllIds: Set<String>?
        var remoteFolders: [SyncAPI.RemoteFolder] = []
        let initialMeetings = try context.fetch(FetchDescriptor<Meeting>())
        var localByID = Dictionary(uniqueKeysWithValues: initialMeetings.map { ($0.id, $0) })
        var localHashes = await prepareMeetings(initialMeetings).mapValues(\.hash)

        var didChange = false
        for _ in 0..<40 {
            let page = try await api.pull(since: cursor)
            latestAllIds = Set(page.allIds.map { $0.lowercased() })
            remoteFolders = page.folders

            if !page.changed.isEmpty { didChange = true }
            let remoteHashes = await prepareRemoteHashes(page.changed)
            for remote in page.changed {
                guard let id = UUID(uuidString: remote.id), let remoteHash = remoteHashes[id] else {
                    continue
                }
                apply(
                    remote: remote,
                    id: id,
                    remoteHash: remoteHash,
                    localByID: &localByID,
                    localHashes: &localHashes,
                    context: context
                )
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
            let prepared = await prepareMeetings(meetings)
            for meeting in meetings {
                let id = meeting.id.uuidString.lowercased()
                let wasSynced = meeting.lastPushedHash != nil
                let isDirty = prepared[meeting.id]?.hash != meeting.lastPushedHash
                if wasSynced, !isDirty, !cloudIds.contains(id) {
                    context.delete(meeting)
                    didChange = true
                }
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
        let meetings = (try? context.fetch(FetchDescriptor<Meeting>())) ?? []
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
                for meeting in meetings where meeting.folderId == local.id {
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

    private func apply(
        remote: SyncAPI.RemoteMeeting,
        id: UUID,
        remoteHash: String,
        localByID: inout [UUID: Meeting],
        localHashes: inout [UUID: String],
        context: ModelContext
    ) {
        let existing = localByID[id]
        if let existing {
            // Local edits win until pushed.
            let isDirty = localHashes[id] != existing.lastPushedHash
            if isDirty { return }
            update(meeting: existing, from: remote, hash: remoteHash, context: context)
        } else {
            let meeting = Meeting(id: id, origin: "cloud")
            context.insert(meeting)
            localByID[id] = meeting
            update(meeting: meeting, from: remote, hash: remoteHash, context: context)
        }
        localHashes[id] = remoteHash
    }

    private func update(
        meeting: Meeting,
        from remote: SyncAPI.RemoteMeeting,
        hash: String,
        context: ModelContext
    ) {
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
                speaker: speakerLabel(for: wire),
                text: wire.text,
                startMs: wire.startMs,
                endMs: wire.endMs,
                confidence: wire.confidence
            )
            segment.meeting = meeting
            context.insert(segment)
        }
        meeting.lastPushedHash = hash
    }

    // MARK: Helpers

    /// Capture SwiftData values quickly on the main actor, then do transcript
    /// sorting, string joining, SHA-256, and payload construction off-main.
    private func prepareMeetings(_ meetings: [Meeting]) async -> [UUID: PreparedMeeting] {
        let snapshots = meetings.map { meeting in
            MeetingSnapshot(
                id: meeting.id,
                title: meeting.displayTitle,
                kind: meeting.kind,
                createdAt: isoString(meeting.createdAt),
                startedAt: meeting.startedAt.map(isoString),
                endedAt: meeting.endedAt.map(isoString),
                calendarEventId: meeting.calendarEventId,
                folderId: meeting.folderId?.uuidString.lowercased(),
                roughNotes: meeting.roughNotes,
                generatedNotes: meeting.generatedNotes,
                segments: meeting.segments.map(SegmentSnapshot.init)
            )
        }
        return await Task.detached(priority: .utility) {
            Dictionary(uniqueKeysWithValues: snapshots.map { ($0.id, $0.prepared()) })
        }.value
    }

    private func prepareRemoteHashes(_ meetings: [SyncAPI.RemoteMeeting]) async -> [UUID: String] {
        return await Task.detached(priority: .utility) {
            let pairs: [(UUID, String)] = meetings.compactMap { remote -> (UUID, String)? in
                guard let id = UUID(uuidString: remote.id) else { return nil }
                let snapshot = MeetingSnapshot(
                    id: id,
                    title: remote.title,
                    kind: remote.kind == "note" ? "note" : nil,
                    createdAt: remote.createdAt,
                    startedAt: remote.startedAt,
                    endedAt: remote.endedAt,
                    calendarEventId: remote.calendarEventId,
                    folderId: remote.folderId?.lowercased(),
                    roughNotes: remote.rawNotesMarkdown,
                    generatedNotes: remote.enhancedMarkdown,
                    segments: remote.segments.map {
                        SegmentSnapshot(
                            channel: $0.channel,
                            speaker: speakerLabel(for: $0),
                            text: $0.text,
                            startMs: $0.startMs,
                            endMs: $0.endMs,
                            confidence: $0.confidence
                        )
                    }
                )
                return (id, snapshot.prepared().hash)
            }
            return Dictionary(uniqueKeysWithValues: pairs)
        }.value
    }

    private func isoString(_ date: Date) -> String {
        date.ISO8601Format(.iso8601(timeZone: .gmt, includingFractionalSeconds: true))
    }

    private func parseISO(_ string: String) -> Date? {
        (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string))
            ?? (try? Date.ISO8601FormatStyle().parse(string))
    }
}

private struct DirtyMeeting {
    let meeting: Meeting
    let prepared: PreparedMeeting
}

/// A speaker may have been named on another device (calendar, context, or a
/// manual rename), so the remote label wins. Falls back to the desktop
/// convention: mic = the note-taker, system = the other side.
private func speakerLabel(for wire: SyncAPI.PushSegment) -> String {
    let named = wire.speaker.trimmingCharacters(in: .whitespacesAndNewlines)
    if !named.isEmpty { return named }
    return wire.channel == "mic" ? "You" : "Them"
}

private struct SegmentSnapshot: Sendable {
    let channel: String
    let speaker: String
    let text: String
    let startMs: Int
    let endMs: Int
    let confidence: Double?

    init(_ segment: Segment) {
        channel = segment.channel
        speaker = segment.speaker
        text = segment.text
        startMs = segment.startMs
        endMs = segment.endMs
        confidence = segment.confidence
    }

    init(
        channel: String,
        speaker: String,
        text: String,
        startMs: Int,
        endMs: Int,
        confidence: Double?
    ) {
        self.channel = channel
        self.speaker = speaker
        self.text = text
        self.startMs = startMs
        self.endMs = endMs
        self.confidence = confidence
    }
}

private struct MeetingSnapshot: Sendable {
    let id: UUID
    let title: String
    let kind: String?
    let createdAt: String
    let startedAt: String?
    let endedAt: String?
    let calendarEventId: String?
    let folderId: String?
    let roughNotes: String
    let generatedNotes: String?
    let segments: [SegmentSnapshot]

    func prepared() -> PreparedMeeting {
        let sorted = segments.sorted { $0.startMs < $1.startMs }
        var parts = [
            title,
            kind ?? "",
            startedAt ?? "",
            endedAt ?? "",
            calendarEventId ?? "",
            folderId ?? "",
            roughNotes,
            generatedNotes ?? "",
        ]
        parts.append(contentsOf: sorted.map {
            "\($0.channel)|\($0.speaker)|\($0.text)|\($0.startMs)|\($0.endMs)"
        })
        let digest = SHA256.hash(data: Data(parts.joined(separator: "\u{1F}").utf8))
        let hash = digest.map { String(format: "%02x", $0) }.joined()
        let wire = SyncAPI.PushMeeting(
            id: id.uuidString.lowercased(),
            title: title,
            kind: kind == "note" ? "note" : nil,
            createdAt: createdAt,
            startedAt: startedAt,
            endedAt: endedAt,
            calendarEventId: calendarEventId,
            folderId: folderId,
            rawNotesMarkdown: roughNotes.isEmpty ? nil : roughNotes,
            enhancedMarkdown: generatedNotes,
            segments: sorted.prefix(5000).map {
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
        return PreparedMeeting(hash: hash, wire: wire)
    }
}

private struct PreparedMeeting: Sendable {
    let hash: String
    let wire: SyncAPI.PushMeeting
}


private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
