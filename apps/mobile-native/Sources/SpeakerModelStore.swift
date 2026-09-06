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
    case manifest, missing, integrity, response
    var errorDescription: String? {
        switch self {
        case .manifest: "The speaker model manifest is unavailable."
        case .missing: "Download the speaker model to enable labels."
        case .integrity: "The speaker model failed its integrity check. Download it again."
        case .response: "The speaker model download failed. Please try again."
        }
    }
}

actor SpeakerModelStore {
    private let root: URL
    init(root: URL = URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteSpeakerModels")) {
        self.root = root
    }

    static func manifest() throws -> SpeakerModelManifest {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json") else { throw SpeakerModelError.manifest }
        return try JSONDecoder().decode(SpeakerModelManifest.self, from: Data(contentsOf: url))
    }

    func installed() -> Bool {
        guard let manifest = try? Self.manifest() else { return false }
        return FileManager.default.fileExists(atPath: root.appendingPathComponent(manifest.revision)
            .appendingPathComponent("verified.json").path)
    }

    func modelURL() throws -> URL {
        let manifest = try Self.manifest()
        let directory = root.appendingPathComponent(manifest.revision).appendingPathComponent(manifest.package)
        for asset in manifest.files { try Self.verify(directory.appendingPathComponent(asset.path), asset: asset) }
        return directory
    }

    func download() async throws {
        let manifest = try Self.manifest()
        let staging = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let package = staging.appendingPathComponent(manifest.package, isDirectory: true)
        try FileManager.default.createDirectory(at: package, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var modelRoot = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try modelRoot.setResourceValues(values)
        defer { try? FileManager.default.removeItem(at: staging) }
        for asset in manifest.files {
            try Task.checkCancellation()
            guard !asset.path.hasPrefix("/"), !asset.path.split(separator: "/").contains(".."),
                  let remote = URL(string: "https://huggingface.co/\(manifest.repository)/resolve/\(manifest.revision)/\(manifest.package)/\(asset.path)")
            else { throw SpeakerModelError.manifest }
            let (temporary, response) = try await URLSession.shared.download(from: remote)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw SpeakerModelError.response }
            try Self.verify(temporary, asset: asset)
            let destination = package.appendingPathComponent(asset.path)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        try Task.checkCancellation()
        try JSONEncoder().encode(manifest).write(to: staging.appendingPathComponent("verified.json"), options: .atomic)
        let destination = root.appendingPathComponent(manifest.revision)
        if FileManager.default.fileExists(atPath: destination.path) {
            // Replacing model assets does not modify notes, audio, or voice profiles.
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: staging)
        } else { try FileManager.default.moveItem(at: staging, to: destination) }
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
