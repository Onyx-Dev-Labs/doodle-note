import Foundation
import CryptoKit
import CommonCrypto

/// Streaming container: fixed header, authenticated manifest, bounded authenticated blocks,
/// and authenticated end marker. No ZIP extraction and no plaintext export files.
enum EncryptedArchive {
    static let magic = Data("DNOTE001".utf8)
    static let blockSize = 1_048_576
    static let manifestLimit = 32 * 1_048_576
    static let totalLimit: Int64 = 8 * 1_024 * 1_024 * 1_024
    static let iterations: UInt32 = 600_000

    enum Failure: Error { case password, invalid, limits, unsupported, busy }
    struct Entry: Codable, Sendable {
        let noteID: UUID
        let path: String
        let size: Int64
    }
    struct Document: Codable, Sendable {
        let note: NoteRecord
        let revisions: [NoteRevision]
        let lifecycle: NoteLifecycle
    }
    struct Manifest: Codable, Sendable {
        var version = 1
        let documents: [Document]
        let entries: [Entry]
    }

    static func derive(password: String, salt: Data) throws -> SymmetricKey {
        guard password.count >= 12, password.utf8.count <= 1024, salt.count == 16 else { throw Failure.password }
        var output = [UInt8](repeating: 0, count: 32)
        let bytes = Array(password.utf8)
        let result = bytes.withUnsafeBytes { pass in salt.withUnsafeBytes { salt in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass.baseAddress!.assumingMemoryBound(to: Int8.self), bytes.count,
                salt.baseAddress!.assumingMemoryBound(to: UInt8.self), 16, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
                &output, output.count)
        } }
        guard result == kCCSuccess else { throw Failure.invalid }
        defer { output.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
        return SymmetricKey(data: output)
    }

    static func validPath(_ value: String) -> Bool {
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        return parts.count == 2 && parts[0] == "audio" && parts[1].utf8.count <= 180 && !parts[1].isEmpty
            && parts[1] != "." && parts[1] != ".." && parts[1].allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) }
            && (parts[1].hasSuffix(".caf") || parts[1].hasSuffix(".json"))
    }

    static func validate(_ manifest: Manifest) throws {
        guard manifest.version == 1 else { throw Failure.unsupported }
        guard manifest.documents.count <= 1000, manifest.entries.count <= 50_000 else { throw Failure.limits }
        let ids = Set(manifest.documents.map { $0.note.id })
        guard ids.count == manifest.documents.count else { throw Failure.invalid }
        var paths = Set<String>(), total: Int64 = 0
        for entry in manifest.entries {
            guard ids.contains(entry.noteID), validPath(entry.path), entry.size >= 0,
                  entry.size <= totalLimit, paths.insert(entry.noteID.uuidString + "/" + entry.path.lowercased()).inserted else { throw Failure.invalid }
            guard total <= totalLimit - entry.size else { throw Failure.limits }; total += entry.size
        }
        for document in manifest.documents {
            let note = document.note
            guard note.schemaVersion == 2, let metadata = note.metadata, metadata.cloudReadOnly != true,
                  note.captureState != .recording, document.lifecycle.noteID == note.id,
                  document.lifecycle.libraryID == metadata.libraryID, document.lifecycle.schemaVersion == 1,
                  document.lifecycle.state != .purged, !document.lifecycle.cleanupPending,
                  !document.lifecycle.restorePending, !document.lifecycle.audioRemovalPending,
                  document.revisions.count <= 100_000,
                  Set(document.revisions.map(\.id)).count == document.revisions.count,
                  document.revisions.allSatisfy({ $0.noteID == note.id && $0.libraryID == metadata.libraryID }),
                  document.revisions.contains(where: { $0 == NoteRevision(note) }) else { throw Failure.invalid }
        }
    }

    static func read(_ handle: FileHandle, count: Int) throws -> Data {
        var data = Data()
        while data.count < count {
            let next = try handle.read(upToCount: count - data.count) ?? Data()
            guard !next.isEmpty else { throw Failure.invalid }; data.append(next)
        }
        return data
    }
    static func integer(_ value: UInt64) -> Data {
        var big = value.bigEndian
        return withUnsafeBytes(of: &big) { Data($0) }
    }
    static func number(_ data: Data) -> UInt64 { data.reduce(0) { ($0 << 8) | UInt64($1) } }

    static func seal(_ data: Data, handle: FileHandle, key: SymmetricKey, header: Data, index: UInt64) throws {
        try Task.checkCancellation()
        let box = try AES.GCM.seal(data, using: key, authenticating: header + integer(index))
        guard let combined = box.combined else { throw Failure.invalid }
        try handle.write(contentsOf: integer(UInt64(combined.count)))
        try handle.write(contentsOf: combined)
    }
    static func open(handle: FileHandle, key: SymmetricKey, header: Data, index: UInt64, limit: Int) throws -> Data {
        try Task.checkCancellation()
        let size = number(try read(handle, count: 8))
        guard size >= 28, size <= limit + 28 else { throw Failure.limits }
        return try AES.GCM.open(AES.GCM.SealedBox(combined: read(handle, count: Int(size))), using: key,
                                authenticating: header + integer(index))
    }

    static func write(manifest: Manifest, disk: NoteDiskStore, password: String, to output: URL) throws {
        try validate(manifest)
        let manifestBytes = try JSONEncoder().encode(manifest)
        guard manifestBytes.count <= manifestLimit else { throw Failure.limits }
        // An exclusive encrypted file is the only temporary export artifact.
        guard !FileManager.default.fileExists(atPath: output.path),
              FileManager.default.createFile(atPath: output.path, contents: nil,
                attributes: [.protectionKey: FileProtectionType.complete]) else { throw Failure.invalid }
        var complete = false
        defer { if !complete { try? FileManager.default.removeItem(at: output) } }
        let handle = try FileHandle(forWritingTo: output); defer { try? handle.close() }
        var salt = Data(count: 16)
        let status = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard status == errSecSuccess else { throw Failure.invalid }
        let header = magic + salt
        let key = try derive(password: password, salt: salt)
        try handle.write(contentsOf: header)
        try seal(manifestBytes, handle: handle, key: key, header: header, index: 0)
        var index: UInt64 = 1
        for entry in manifest.entries {
            let url = disk.directory(for: entry.noteID).appendingPathComponent(entry.path)
            let source = try FileHandle(forReadingFrom: url); defer { try? source.close() }
            var remaining = entry.size
            while remaining > 0 {
                let data = try read(source, count: Int(min(remaining, Int64(blockSize))))
                try seal(data, handle: handle, key: key, header: header, index: index)
                index += 1; remaining -= Int64(data.count)
            }
            guard (try source.read(upToCount: 1) ?? Data()).isEmpty else { throw Failure.busy }
        }
        try seal(Data("END".utf8), handle: handle, key: key, header: header, index: index)
        try handle.synchronize(); complete = true
    }

    /// Every record including EOF is authenticated before publish. Sink stays inside app-private staging.
    static func read(from url: URL, password: String,
                     prepare: (Manifest) throws -> Void,
                     consume: (Entry, Data) throws -> Void) throws -> Manifest {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 24, Int64(size) <= totalLimit + Int64(manifestLimit) + 10_000_000 else { throw Failure.limits }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        let header = try read(handle, count: 24)
        guard header.prefix(8) == magic else { throw Failure.unsupported }
        let key = try derive(password: password, salt: Data(header.suffix(16)))
        let manifest = try JSONDecoder().decode(Manifest.self, from: open(handle: handle, key: key, header: header, index: 0, limit: manifestLimit))
        try validate(manifest); try prepare(manifest)
        var index: UInt64 = 1
        for entry in manifest.entries {
            var remaining = entry.size
            if remaining == 0 { try consume(entry, Data()) }
            while remaining > 0 {
                let expected = Int(min(remaining, Int64(blockSize)))
                let data = try open(handle: handle, key: key, header: header, index: index, limit: expected)
                guard data.count == expected else { throw Failure.invalid }
                try consume(entry, data); remaining -= Int64(data.count); index += 1
            }
        }
        guard try open(handle: handle, key: key, header: header, index: index, limit: 3) == Data("END".utf8),
              (try handle.read(upToCount: 1) ?? Data()).isEmpty else { throw Failure.invalid }
        return manifest
    }
}
