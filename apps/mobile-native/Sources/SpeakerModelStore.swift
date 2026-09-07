import CryptoKit
import Foundation

struct SpeakerModelManifest: Codable, Sendable {
    struct Asset: Codable, Sendable { let path: String; let size: Int; let sha256: String }
    let repository: String
    let revision: String
    let package: String
    let files: [Asset]
}

enum SpeakerModelError: LocalizedError {
    case manifest, missing, integrity, response, storage, busy
    var errorDescription: String? {
        switch self {
        case .storage: "There is not enough free space to prepare the speaker model. Free some space and retry."
        case .busy: "The speaker model is already being changed. Please wait."
        case .manifest: "The speaker model manifest is unavailable."
        case .missing: "Download the speaker model to enable labels."
        case .integrity: "The speaker model failed its integrity check. Download it again."
        case .response: "The speaker model download failed. Please try again."
        }
    }
}

actor SpeakerModelStore {
    static let shared = SpeakerModelStore()
    typealias Fetch = @Sendable (URL, Int, @escaping @Sendable (Int64) -> Void) async throws -> URL
    private let root: URL
    private let manifestOverride: SpeakerModelManifest?
    private let fetch: Fetch
    private let capacity: @Sendable (URL) throws -> Int64
    private var changing = false

    init(root: URL = URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteSpeakerModels"),
         manifest: SpeakerModelManifest? = nil,
         capacity: @escaping @Sendable (URL) throws -> Int64 = { url in
             try url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
                 .volumeAvailableCapacityForImportantUsage ?? 0
         }, fetch: @escaping Fetch = SpeakerModelDownload.fetch) {
        self.root = root
        self.manifestOverride = manifest
        self.capacity = capacity
        self.fetch = fetch
    }

    static func manifest() throws -> SpeakerModelManifest {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json") else { throw SpeakerModelError.manifest }
        return try JSONDecoder().decode(SpeakerModelManifest.self, from: Data(contentsOf: url))
    }

    private func manifestValue() throws -> SpeakerModelManifest {
        let value = try manifestOverride ?? Self.manifest()
        func safe(_ path: String) -> Bool {
            !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") &&
            path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
                !$0.isEmpty && $0 != "." && $0 != ".." && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) }
            }
        }
        guard safe(value.repository), safe(value.revision), !value.revision.contains("/"),
              safe(value.package), !value.package.contains("/"), !value.files.isEmpty,
              Set(value.files.map(\.path)).count == value.files.count,
              value.files.allSatisfy({ safe($0.path) && $0.size > 0 && $0.size <= 1_000_000_000 &&
                  $0.sha256.count == 64 && $0.sha256.allSatisfy { "0123456789abcdef".contains($0) } })
        else { throw SpeakerModelError.manifest }
        return value
    }

    func installed() -> Bool { (try? modelURL()) != nil }

    func modelURL() throws -> URL {
        let manifest = try manifestValue()
        let directory = root.appendingPathComponent(manifest.revision).appendingPathComponent(manifest.package)
        for asset in manifest.files { try Self.verify(directory.appendingPathComponent(asset.path), asset: asset) }
        return directory
    }

    /// Verified completed files survive interruption. Unverified transport files never become installed assets.
    func download(progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws {
        guard !changing else { throw SpeakerModelError.busy }
        changing = true
        defer { changing = false }
        let manifest = try manifestValue()
        let staging = root.appendingPathComponent("preparing-" + manifest.revision, isDirectory: true)
        let package = staging.appendingPathComponent(manifest.package, isDirectory: true)
        try FileManager.default.createDirectory(at: package, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var modelRoot = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try modelRoot.setResourceValues(values)
        let total = manifest.files.reduce(Int64(0)) { $0 + Int64($1.size) }
        var completed: Int64 = 0
        for asset in manifest.files {
            try Task.checkCancellation()
            let destination = package.appendingPathComponent(asset.path)
            if (try? Self.verify(destination, asset: asset)) != nil {
                completed += Int64(asset.size)
                progress(Double(completed) / Double(total))
                continue
            }
            guard try capacity(root) >= Int64(asset.size) + 32 * 1_024 * 1_024 else { throw SpeakerModelError.storage }
            let remote = URL(string: "https://huggingface.co/\(manifest.repository)/resolve/\(manifest.revision)/\(manifest.package)/\(asset.path)")!
            let previous = completed
            let temporary = try await fetch(remote, asset.size) { bytes in
                progress(Double(previous + min(Int64(asset.size), max(0, bytes))) / Double(total))
            }
            defer { try? FileManager.default.removeItem(at: temporary) }
            try Task.checkCancellation()
            try Self.verify(temporary, asset: asset)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
            try FileManager.default.moveItem(at: temporary, to: destination)
            completed += Int64(asset.size)
            progress(Double(completed) / Double(total))
        }
        try Task.checkCancellation()
        try JSONEncoder().encode(manifest).write(to: staging.appendingPathComponent("verified.json"), options: .atomic)
        let destination = root.appendingPathComponent(manifest.revision)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: staging)
        } else { try FileManager.default.moveItem(at: staging, to: destination) }
        progress(1)
    }

    /// Only this dedicated model directory is removed. Notes, recordings and profiles live elsewhere.
    func remove() throws {
        guard !changing else { throw SpeakerModelError.busy }
        if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) }
    }

    static func verify(_ file: URL, asset: SpeakerModelManifest.Asset) throws {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let size = attributes[.size] as? NSNumber, size.intValue == asset.size else { throw SpeakerModelError.integrity }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var digest = SHA256()
        while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty {
            try Task.checkCancellation()
            digest.update(data: bytes)
        }
        let value = digest.finalize().map { String(format: "%02x", $0) }.joined()
        guard value == asset.sha256 else { throw SpeakerModelError.integrity }
    }
}
