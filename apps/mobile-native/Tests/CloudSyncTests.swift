import XCTest
@testable import DoodleNoteNative

final class CloudSyncTests: XCTestCase {
    func testSignOutRemainsLockedAcrossRestartWhenKeychainRemovalFails() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let keys = CloudFixtureCredentials()
        let store = try CloudConnectionStore(directory: directory, credentials: keys)
        let account = CloudAccount(accountId: "one", workspaceId: "work", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [])
        let connected = try await store.connect(account: account, secret: CloudSecret("dnid_" + String(repeating: "a", count: 64)))
        let secret = try await store.credential(expectedGeneration: connected.generation)
        XCTAssertTrue(secret.identityOnly)
        keys.failRemoval()
        do { try await store.signOut(); XCTFail("injected removal failure") } catch {}
        let reopened = try CloudConnectionStore(directory: directory, credentials: keys)
        let record = try await reopened.load()
        XCTAssertEqual(record?.authenticated, false)
        do { _ = try await reopened.credential(expectedGeneration: connected.generation); XCTFail("must remain locked") }
        catch {}
        let bytes = try Data(contentsOf: directory.appendingPathComponent("connection.json"))
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("dnid_"))
        let other = CloudAccount(accountId: "two", workspaceId: "work", workspaceName: "Work", entitled: true,
            syncAvailable: true, libraries: [])
        let switched = try await reopened.connect(account: other, secret: CloudSecret("dnsy_" + String(repeating: "b", count: 64)))
        XCTAssertNotEqual(switched.generation, connected.generation)
        XCTAssertNil(switched.selectedLibraryID)
    }
    func testCallbackIsBoundToAttemptAndNeverTrustsDisplayIdentity() throws {
        let attempt = try CloudLinkAttempt()
        let secret = "dnid_" + String(repeating: "a", count: 64)
        func callback(_ state: String) -> URL {
            var components = URLComponents(string: "doodlenote://link")!
            components.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "token", value: secret),
                                    URLQueryItem(name: "email", value: "not-an-identity@example.test")]
            return components.url!
        }
        XCTAssertTrue(try attempt.secret(from: callback(attempt.state)).identityOnly)
        XCTAssertThrowsError(try attempt.secret(from: callback("another-attempt")))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: callback(attempt.state).absoluteString + "&state=duplicate")!))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: callback(attempt.state).absoluteString + "#fragment")!))
        XCTAssertThrowsError(try attempt.secret(from: URL(string: "https://example.test/link")!))
        XCTAssertThrowsError(try CloudSecret("dnsy_short"))
        XCTAssertThrowsError(try CloudHTTP(origin: URL(string: "http://example.test")!))
        XCTAssertThrowsError(try CloudHTTP(origin: URL(string: "https://user@example.test")!))
    }

    func testRemoteAccountCannotClaimLocalLibrary() throws {
        let account = CloudAccount(accountId: "a", workspaceId: "w", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [.init(id: LibraryRecord.localID)])
        XCTAssertThrowsError(try account.validate())
        let valid = CloudAccount(accountId: "a", workspaceId: "w", workspaceName: "Work", entitled: false,
            syncAvailable: false, libraries: [])
        XCTAssertNoThrow(try valid.validate())
        XCTAssertEqual(valid.identity, LibraryIdentity(accountID: "a", workspaceID: "w"))
    }
}

private final class CloudFixtureCredentials: CloudCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: CloudSecret] = [:]
    private var removalFails = false
    func failRemoval() { lock.withLock { removalFails = true } }
    func read(key: String) throws -> CloudSecret? { lock.withLock { values[key] } }
    func write(_ secret: CloudSecret, key: String) throws { lock.withLock { values[key] = secret } }
    func remove(key: String) throws {
        try lock.withLock {
            if removalFails { throw CloudSyncFailure.unavailable }
            values.removeValue(forKey: key)
        }
    }
}
