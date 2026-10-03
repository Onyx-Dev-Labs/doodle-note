import CryptoKit
import Foundation
import Security

protocol CloudCredentialStore: Sendable {
    func read(key: String) throws -> CloudSecret?
    func write(_ secret: CloudSecret, key: String) throws
    func remove(key: String) throws
}

struct CloudKeychain: CloudCredentialStore {
    let service: String
    init(service: String = "ai.doodlenote.native.cloud") { self.service = service }
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: key, kSecAttrSynchronizable as String: false]
    }
    func read(key: String) throws -> CloudSecret? {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data,
              let token = String(data: bytes, encoding: .utf8) else { throw CloudSyncFailure.unavailable }
        return try CloudSecret(token)
    }
    func write(_ secret: CloudSecret, key: String) throws {
        let values: [String: Any] = [kSecValueData as String: Data(secret.value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let result = SecItemUpdate(query(key) as CFDictionary, values as CFDictionary)
        if result == errSecItemNotFound {
            var item = query(key)
            values.forEach { item[$0.key] = $0.value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw CloudSyncFailure.unavailable }
        } else if result != errSecSuccess { throw CloudSyncFailure.unavailable }
    }
    func remove(key: String) throws {
        let result = SecItemDelete(query(key) as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw CloudSyncFailure.unavailable }
    }
}

struct CloudConnection: Codable, Equatable, Sendable {
    let account: CloudAccount
    let credentialKey: String
    var authenticated: Bool
    var paused: Bool
    var selectedLibraryID: UUID?
    var generation: UUID
}

/// Credential removal failure never reopens a signed-out cache: persisted authenticated=false wins.
actor CloudConnectionStore {
    let directory: URL
    let credentials: any CloudCredentialStore
    private var file: URL { directory.appendingPathComponent("connection.json") }
    init(directory: URL, credentials: any CloudCredentialStore = CloudKeychain()) throws {
        self.directory = directory
        self.credentials = credentials
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
    }
    func load() throws -> CloudConnection? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let connection = try JSONDecoder().decode(CloudConnection.self, from: Data(contentsOf: file))
        try connection.account.validate()
        guard UUID(uuidString: connection.credentialKey) != nil else { throw CloudSyncFailure.invalidResponse }
        return connection
    }
    private func save(_ connection: CloudConnection) throws {
        try JSONEncoder().encode(connection).write(to: file,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func connect(account: CloudAccount, secret: CloudSecret) throws -> CloudConnection {
        try account.validate()
        let previous = try load()
        let key = UUID().uuidString
        // A unique credential slot never overwrites the previous account on an interrupted commit.
        try credentials.write(secret, key: key)
        let connection = CloudConnection(account: account, credentialKey: key, authenticated: true,
            paused: true, selectedLibraryID: previous?.account.identity == account.identity ? previous?.selectedLibraryID : nil,
            generation: UUID())
        do { try save(connection) }
        catch { try? credentials.remove(key: key); throw error }
        if let previous { try? credentials.remove(key: previous.credentialKey) }
        return connection
    }
    func credential(expectedGeneration: UUID) throws -> CloudSecret {
        guard let connection = try load(), connection.authenticated, connection.generation == expectedGeneration,
              let secret = try credentials.read(key: connection.credentialKey) else { throw CloudSyncFailure.signedOut }
        return secret
    }
    func select(libraryID: UUID, expectedGeneration: UUID) throws -> CloudConnection {
        guard libraryID != LibraryRecord.localID, var connection = try load(), connection.authenticated,
              connection.generation == expectedGeneration else { throw CloudSyncFailure.signedOut }
        // A newly created empty cloud library is permitted; server enforces immutable workspace ownership on first upsert.
        connection.selectedLibraryID = libraryID
        connection.generation = UUID()
        connection.paused = false
        try save(connection)
        return connection
    }
    func pause() throws -> CloudConnection? {
        guard var connection = try load() else { return nil }
        connection.paused = true
        connection.generation = UUID()
        try save(connection)
        return connection
    }
    func signOut() throws {
        guard var connection = try load() else { return }
        connection.authenticated = false
        connection.paused = true
        connection.generation = UUID()
        try save(connection)
        try credentials.remove(key: connection.credentialKey)
    }
}
