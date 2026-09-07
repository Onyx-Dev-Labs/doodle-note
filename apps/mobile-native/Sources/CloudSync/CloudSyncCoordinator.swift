import Observation
import Network
import SwiftUI

@MainActor @Observable
final class CloudSyncCoordinator {
    let connections: CloudConnectionStore
    let transport: any CloudTransport
    let root: URL
    private(set) var connection: CloudConnection?
    private(set) var busy = false
    private(set) var status = "Cloud sync is optional. Local notes stay on this device."
    private(set) var report = CloudSyncReport()
    private(set) var legacy: CloudLegacyPage?
    private(set) var cloudVersionText: String?
    private var browser: CloudLinkBrowser?
    private var recording: RecordingSession?
    private weak var library: NoteLibrary?
    private var task: Task<Void, Never>?
    private var monitor: NWPathMonitor?
    private var retryCount = 0
    private var ticket = UUID()

    init(root: URL, transport: (any CloudTransport)? = nil, credentials: any CloudCredentialStore = CloudKeychain()) throws {
        self.root = root.appendingPathComponent("cloud")
        connections = try CloudConnectionStore(directory: self.root.appendingPathComponent("connection"), credentials: credentials)
        self.transport = try transport ?? CloudHTTP()
    }
    func start(library: NoteLibrary, recording: RecordingSession) async {
        self.recording = recording
        self.library = library
        if monitor == nil {
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { [weak self, weak library] path in
                guard path.status == .satisfied else { return }
                Task { @MainActor in
                    guard let self, let library else { return }
                    self.schedule(library: library)
                }
            }
            monitor.start(queue: DispatchQueue(label: "doodlenote.cloud.connectivity"))
            self.monitor = monitor
        }
        await library.waitUntilLoaded()
        do {
            connection = try await connections.load()
            guard let connection, connection.authenticated, let repository = library.cloudRepository else { return }
            // Persisted explicit authentication permits offline reopening. Explicit sign-out always wins.
            try await repository.recoverCloudImports(identity: connection.account.identity)
            try await library.authenticate(connection.account.identity, name: connection.account.workspaceName,
                libraryID: connection.selectedLibraryID.map { CloudIdentityMap(identity: connection.account.identity, remoteLibraryID: $0).localLibraryID })
            await synchronize(library: library)
        } catch { status = safe(error) }
    }
    func connect(library: NoteLibrary, recording: RecordingSession) async {
        guard !busy, !(recording.busy || recording.noteID != nil) else { return }
        busy = true
        ticket = UUID()
        let expected = ticket
        defer { if ticket == expected { busy = false } }
        do {
            let browser = CloudLinkBrowser {
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                    .flatMap(\.windows).first(where: \.isKeyWindow) ?? UIWindow()
            }
            self.browser = browser
            let secret = try await browser.open(CloudLinkAttempt())
            let account = try await transport.account(secret: secret)
            guard ticket == expected, !recording.busy, recording.noteID == nil else { throw CloudSyncFailure.cancelled }
            if let previous = connection, previous.account.identity != account.identity {
                guard await library.signOut(previous.account.identity, captureActive: recording.busy || recording.noteID != nil) else { throw CloudSyncFailure.changed }
            }
            let linked = try await connections.connect(account: account, secret: secret)
            guard let repository = library.cloudRepository else { throw CloudSyncFailure.unavailable }
            try await repository.recoverCloudImports(identity: account.identity)
            try await library.authenticate(account.identity, name: account.workspaceName,
                libraryID: linked.selectedLibraryID.map { CloudIdentityMap(identity: account.identity, remoteLibraryID: $0).localLibraryID })
            legacy = nil
            connection = linked
            status = account.entitled ? "Connected. Choose a cloud library to enable sync." : CloudSyncFailure.subscription.localizedDescription
        } catch { status = safe(error) }
        browser = nil
    }
    func select(_ remoteID: UUID, library: NoteLibrary, recording: RecordingSession) async {
        guard !busy, !(recording.busy || recording.noteID != nil), let current = connection else { return }
        do {
            guard !recording.busy, recording.noteID == nil else { throw CloudSyncFailure.changed }
            let selected = try await connections.select(libraryID: remoteID, expectedGeneration: current.generation)
            let localID = CloudIdentityMap(identity: selected.account.identity, remoteLibraryID: remoteID).localLibraryID
            try await library.authenticate(selected.account.identity, name: selected.account.workspaceName + " Cloud", libraryID: localID)
            library.selectLibrary(localID)
            connection = selected
            await synchronize(library: library)
        } catch { status = safe(error) }
    }
    func discoverLegacy(next: Bool = false) async {
        guard !busy, let connection, connection.authenticated else { return }
        busy = true
        defer { busy = false }
        do {
            let secret = try await connections.credential(expectedGeneration: connection.generation)
            let query = next ? legacy?.next.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [] : []
            let response = try await transport.json(path: "api/sync/legacy", query: query, secret: secret)
            guard try await connections.load()?.generation == connection.generation else { throw CloudSyncFailure.signedOut }
            legacy = try CloudLegacyPage(response)
        } catch { await handleFailure(error, expected: connection, library: library) }
    }
    func adopt(_ ids: [UUID], library: NoteLibrary) async {
        guard !busy, let connection, let repository = library.cloudRepository else { return }
        do {
            let engine = try makeEngine(connection: connection, library: library, repository: repository)
            try await engine.adopt(noteIDs: ids)
            await synchronize(library: library)
            await discoverLegacy()
        } catch { await handleFailure(error, expected: connection, library: library) }
    }
    func previewConflict(_ id: UUID, library: NoteLibrary) async {
        guard let connection, let repository = library.cloudRepository else { return }
        cloudVersionText = nil
        do {
            let engine = try makeEngine(connection: connection, library: library, repository: repository)
            let state = try await engine.journal.load()
            guard let remoteID = state.noteBindings.first(where: { $0.value == id })?.key,
                  let content = try await engine.replica.content(remoteID), let snapshot = content.snapshot else { throw CloudSyncFailure.changed }
            guard try await connections.load()?.generation == connection.generation else { throw CloudSyncFailure.signedOut }
            let typed = snapshot["text"]?.string ?? snapshot["legacyNotes"]?["raw_content"]?["markdown"]?.string ?? ""
            let summaries = (snapshot["summaries"]?.list ?? []).compactMap { $0["markdown"]?.string }.joined(separator: "\n\n")
            let transcript = (snapshot["passages"]?.list ?? []).compactMap { $0["text"]?.string }.joined(separator: "\n")
            cloudVersionText = [typed, summaries, transcript].filter { !$0.isEmpty }.joined(separator: "\n\n")
        } catch { await handleFailure(error, expected: connection, library: library) }
    }
    func resolve(_ localID: UUID, keepDevice: Bool, library: NoteLibrary) async {
        guard !busy, let connection, let repository = library.cloudRepository else { return }
        do {
            guard await library.flush() else { throw CloudSyncFailure.changed }
            let engine = try makeEngine(connection: connection, library: library, repository: repository)
            if keepDevice { try await engine.keepDeviceVersion(localNoteID: localID) }
            else { try await engine.useCloudVersion(localNoteID: localID) }
            await synchronize(library: library)
        } catch { await handleFailure(error, expected: connection, library: library) }
    }
    func pause() async {
        ticket = UUID()
        task?.cancel()
        do {
            connection = try await connections.pause()
            status = "Cloud sync paused. This account's notes remain available on this device."
        } catch { status = safe(error) }
    }
    func signOut(library: NoteLibrary, recording: RecordingSession) async {
        guard !(recording.busy || recording.noteID != nil), let current = connection else { return }
        // Do not lock the account until pending device writes are safely flushed.
        guard await library.flush() else { return }
        ticket = UUID()
        task?.cancel()
        do { try await connections.signOut() } catch { status = safe(error) }
        _ = await library.signOut(current.account.identity, captureActive: recording.busy || recording.noteID != nil)
        legacy = nil
        connection = try? await connections.load()
        status = "Signed out. This account's saved notes are locked until the same account reconnects."
    }
    func schedule(library: NoteLibrary) {
        task?.cancel()
        task = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await synchronize(library: library)
        }
    }
    func synchronize(library: NoteLibrary) async {
        guard !busy, let connection, connection.authenticated, !connection.paused,
              connection.selectedLibraryID != nil, let repository = library.cloudRepository else { return }
        busy = true
        let expected = ticket
        defer { busy = false }
        do {
            guard await library.flush() else { throw CloudSyncFailure.changed }
            let engine = try makeEngine(connection: connection, library: library, repository: repository)
            let result = try await engine.synchronize()
            guard ticket == expected else { return }
            try await library.refreshAfterCloud()
            report = result
            retryCount = 0
            if result.hasMore || result.needsFollowup { schedule(library: library) }
            status = !result.conflicts.isEmpty ? "Some notes have versions to review." :
                !result.deferred.isEmpty ? "Some notes are waiting for sync. Their device copies are preserved." :
                result.hasMore ? "More cloud history is available. Sync again to continue." : "Cloud sync is up to date."
        } catch {
            if ticket == expected {
                try? await library.refreshAfterCloud()
                if case CloudSyncFailure.permission = error { await permissionDenied(library: library, account: connection.account.identity) }
                else {
                    status = safe(error)
                    if case CloudSyncFailure.unavailable = error, retryCount < 3 {
                        retryCount += 1
                        let delay = [5, 15, 60][retryCount - 1]
                        task = Task {
                            try? await Task.sleep(for: .seconds(delay))
                            guard !Task.isCancelled else { return }
                            await self.synchronize(library: library)
                        }
                    }
                }
            }
        }
    }
    private func makeEngine(connection: CloudConnection, library: NoteLibrary, repository: LibraryRepository) throws -> CloudSyncEngine {
        guard let remoteLibrary = connection.selectedLibraryID else { throw CloudSyncFailure.changed }
        let map = CloudIdentityMap(identity: connection.account.identity, remoteLibraryID: remoteLibrary)
        return try CloudSyncEngine(connection: connection, connections: connections, repository: repository,
            transport: transport, root: root.appendingPathComponent("libraries")) { decoded, remote, localID, expected in
                try await library.commitCloudImport(decoded: decoded, remote: remote, localNoteID: localID,
                    libraryID: map.localLibraryID, identity: map.identity, expectedLocalRevisionID: expected)
            }
    }
    private func handleFailure(_ error: Error, expected: CloudConnection, library: NoteLibrary?) async {
        guard let current = try? await connections.load(), current.generation == expected.generation else { return }
        if case CloudSyncFailure.permission = error, let library {
            await permissionDenied(library: library, account: expected.account.identity)
        } else { status = safe(error) }
    }
    private func permissionDenied(library: NoteLibrary, account: LibraryIdentity) async {
        let captureID = recording?.noteID ?? recording?.preparingNoteID
        let captureLibrary = captureID.flatMap { id in library.notes.first(where: { $0.id == id })?.metadata?.libraryID }
        let ownsCapture = captureLibrary.flatMap { id in library.libraries.first(where: { $0.id == id })?.identity } == account
        library.revokeAccountAccess(account)
        ticket = UUID()
        legacy = nil
        cloudVersionText = nil
        do { try await connections.signOut() } catch { status = safe(error) }
        connection = try? await connections.load()
        if ownsCapture, let recording, let captureID, let captureLibrary {
            status = "Workspace access was revoked. Recording recovery is being saved on this device."
            await recording.stop(library: library, interrupted: true)
            while recording.busy && (recording.noteID ?? recording.preparingNoteID) == captureID {
                try? await Task.sleep(for: .milliseconds(50))
            }
            if recording.noteID == captureID { await recording.stop(library: library, interrupted: true) }
            _ = await library.flush()
            do { try await library.cloudRepository?.finishRevokedCapture(noteID: captureID, libraryID: captureLibrary, identity: account) }
            catch { status = "Workspace access is blocked. Recording recovery files are preserved for the next launch."; return }
        }
        status = "Workspace access was revoked. Reconnect an authorized account to reopen its saved notes."
    }
    private func safe(_ error: Error) -> String {
        (error as? CloudSyncFailure)?.localizedDescription ?? "Sync could not finish. Saved notes and pending changes are preserved."
    }
}
