import Foundation
import Security

/// Synchronous operations run only on CalendarAccountStore's actor, with no suspension between credential/cache commits.
protocol CalendarCredentialStore: Sendable {
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret?
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws
    func remove(_ account: CalendarAccountKey) throws
}

struct CalendarKeychainFailure: Error { let status: OSStatus }

struct KeychainCalendarCredentials: CalendarCredentialStore {
    let service: String
    init(service: String = "ai.doodlenote.native.calendar") { self.service = service }

    private func query(_ account: CalendarAccountKey) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account.storageKey, kSecAttrSynchronizable as String: false]
    }
    func read(_ account: CalendarAccountKey) throws -> CalendarSecret? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw CalendarKeychainFailure(status: status) }
        return CalendarSecret(data: data)
    }
    func write(_ credential: CalendarSecret, for account: CalendarAccountKey) throws {
        let attributes: [String: Any] = [kSecValueData as String: credential.data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(account)
            attributes.forEach { item[$0.key] = $0.value }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw CalendarKeychainFailure(status: added) }
        } else if status != errSecSuccess { throw CalendarKeychainFailure(status: status) }
    }
    func remove(_ account: CalendarAccountKey) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CalendarKeychainFailure(status: status) }
    }
}
