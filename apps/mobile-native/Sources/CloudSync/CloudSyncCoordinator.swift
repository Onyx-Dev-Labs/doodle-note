import Observation
import SwiftUI

@MainActor @Observable
final class CloudSyncCoordinator {
    let connections: CloudConnectionStore
    let transport: CloudHTTP
    let root: URL
    private(set) var connection: CloudConnection?
    private(set) var busy = false
    private(set) var status = "Cloud sync is optional. Local notes stay on this device."
    private(set) var report = CloudSyncReport()
    private var browser: CloudLinkBrowser?
    private var task: Task<Void, Never>?
    private var ticket = UUID()

    init(root: URL) throws {
        self.root = root.appendingPathComponent("cloud")
        connections = try CloudConnectionStore(directory: self.root.appendingPathComponent("connection"))
        transport = try CloudHTTP()
    }
    func start(library: NoteLibrary) async {
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
            let engine = try CloudSyncEngine(connection: connection, connections: connections,
                repository: repository, transport: transport, root: root.appendingPathComponent("libraries"))
            let result = try await engine.synchronize()
            guard ticket == expected else { return }
            try await library.refreshAfterCloud()
            report = result
            status = !result.conflicts.isEmpty ? "Some notes have versions to review." :
                !result.deferred.isEmpty ? "Some notes are waiting for sync. Their device copies are preserved." :
                result.hasMore ? "More cloud history is available. Sync again to continue." : "Cloud sync is up to date."
        } catch { if ticket == expected { status = safe(error) } }
    }
    private func safe(_ error: Error) -> String {
        (error as? CloudSyncFailure)?.localizedDescription ?? "Sync could not finish. Saved notes and pending changes are preserved."
    }
}
