import CryptoKit
import Foundation

/// Shared cloud UUIDs are never local cache ownership. Two users in the same workspace
/// receive different local directory/library IDs and retain remote IDs only in their sync partition.
struct CloudIdentityMap: Sendable {
    let identity: LibraryIdentity
    let remoteLibraryID: UUID
    var localLibraryID: UUID { scoped(remoteLibraryID, kind: "library") }
    func localNoteID(_ remote: UUID) -> UUID { scoped(remote, kind: "note") }
    private func scoped(_ id: UUID, kind: String) -> UUID {
        // JSON array encoding is unambiguous even when account IDs contain separators.
        let data = try! JSONEncoder().encode(["doodlenote-cloud-v1", kind, identity.accountID,
                                             identity.workspaceID, id.uuidString.lowercased()])
        var bytes = Array(SHA256.hash(data: data).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
