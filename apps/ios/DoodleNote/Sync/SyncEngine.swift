import Foundation
import SwiftData
import SwiftUI
import CryptoKit
import AuthenticationServices

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

    var isLinked: Bool { Keychain.read(key: .syncToken) != nil }

    private var api: SyncAPI? {
        guard let token = Keychain.read(key: .syncToken) else { return nil }
        let base = ProcessInfo.processInfo.environment["DOODLE_SYNC_URL"]
            .flatMap(URL.init(string:)) ?? SyncAPI.productionBase
        return SyncAPI(baseURL: base, token: token)
    }

    // MARK: Device linking

    /// Opens the web approval flow. The link-device page redirects back to
    /// doodlenote://link?token=dnsy_...&email=...&workspace=... on approval.
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

        do {
            let callback = try await startWebAuth(url: components.url!)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func item(_ name: String) -> String? { items.first { $0.name == name }?.value }

            guard let token = item("token"), token.hasPrefix("dnsy_") else {
                lastError = "Linking failed: no token returned."
                return
            }
            Keychain.save(key: .syncToken, value: token)
            linkedEmail = item("email")
            workspaceName = item("workspace")
            pullCursor = nil
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // User dismissed the sheet — not an error.
        } catch {
            lastError = "Linking failed: \(error.localizedDescription)"
        }
    }

    func unlink() {
        Keychain.delete(key: .syncToken)
        linkedEmail = nil
        workspaceName = nil
        pullCursor = nil
        pendingDeletes = []
        lastError = nil
        lastSyncedAt = nil
    }

    private func startWebAuth(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme("doodlenote")
            ) { callbackURL, error in
                if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: error ?? URLError(.cancelled))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }
    }

    // MARK: Deletion queue

    func noteDeleted(meeting: Meeting) {
        guard meeting.lastPushedHash != nil else { return }
        pendingDeletes = Array(Set(pendingDeletes + [meeting.id.uuidString.lowercased()]))
    }

    // MARK: Sync cycle

    func syncNow(context: ModelContext) async {
        guard let api, !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        do {
            try await pushDeletes(api: api)
            try await pushDirty(api: api, context: context)
            try await pullChanges(api: api, context: context)
            lastSyncedAt = .now
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func pushDeletes(api: SyncAPI) async throws {
        let ids = pendingDeletes
        guard !ids.isEmpty else { return }
        try await api.delete(ids: ids)
        pendingDeletes = []
    }

    private func pushDirty(api: SyncAPI, context: ModelContext) async throws {
        let meetings = try context.fetch(FetchDescriptor<Meeting>())
        let dirty = meetings.filter { contentHash(of: $0) != $0.lastPushedHash }
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

        for _ in 0..<40 {
            let page = try await api.pull(since: cursor)
            latestAllIds = Set(page.allIds.map { $0.lowercased() })

            for remote in page.changed {
                apply(remote: remote, context: context)
                cursor = max(cursor ?? "", remote.updatedAt)
            }
            if !page.hasMore { break }
        }
        pullCursor = cursor

        // Deletion reconciliation: a synced, non-dirty local meeting missing
        // from the cloud's complete id list was deleted remotely.
        if let cloudIds = latestAllIds {
            let meetings = try context.fetch(FetchDescriptor<Meeting>())
            for meeting in meetings {
                let id = meeting.id.uuidString.lowercased()
                let wasSynced = meeting.lastPushedHash != nil
                let isDirty = contentHash(of: meeting) != meeting.lastPushedHash
                if wasSynced, !isDirty, !cloudIds.contains(id) {
                    context.delete(meeting)
                }
            }
        }
        try? context.save()
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
        meeting.createdAt = parseISO(remote.createdAt) ?? meeting.createdAt
        meeting.startedAt = remote.startedAt.flatMap(parseISO)
        meeting.endedAt = remote.endedAt.flatMap(parseISO)
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
            createdAt: isoString(meeting.createdAt),
            startedAt: meeting.startedAt.map(isoString),
            endedAt: meeting.endedAt.map(isoString),
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
            meeting.startedAt.map(isoString) ?? "",
            meeting.endedAt.map(isoString) ?? "",
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

extension SyncEngine: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
