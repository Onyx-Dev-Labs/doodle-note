import CryptoKit
import Foundation
import ImageIO
import PencilKit
import UIKit
import UniformTypeIdentifiers

struct CloudInkPlan: Codable, Sendable {
    let noteID: UUID
    let attachmentID: UUID
    let versionID: UUID
    let head: UUID
    let generation: UUID
    let ink: Data
    let preview: Data
    var downloadedCache: Bool? = nil
    var reference: CloudJSON { .object(["id": .uuid(attachmentID), "versionId": .uuid(versionID)]) }
}

/// Protected, restartable immutable upload bytes. Neither a provider URL nor an audio file is stored here.
actor CloudInkTransfer {
    let root: URL
    let libraryID: UUID
    let cacheScope: CloudCacheScope?
    init(root: URL, libraryID: UUID, cacheScope: CloudCacheScope? = nil) throws {
        self.cacheScope = cacheScope
        self.root = root
        self.libraryID = libraryID
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    }
    private func path(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString + ".json") }
    private func plan(_ id: UUID) throws -> CloudInkPlan? {
        guard try cacheScope?.locallyPurged(id) != true, FileManager.default.fileExists(atPath: path(id).path) else { return nil }
        let plan = try JSONDecoder().decode(CloudInkPlan.self, from: Data(contentsOf: path(id)))
        guard plan.noteID == id else { throw LibraryDataError.invalidOwnership }
        return plan
    }
    func matches(noteID: UUID, ink: Data, references: [CloudJSON]) throws -> Bool {
        if ink.isEmpty { return references.isEmpty }
        guard let plan = try plan(noteID), plan.ink == ink else { return false }
        return references.count == 1 && references.first == plan.reference
    }
    func purge(noteID: UUID) throws {
        if FileManager.default.fileExists(atPath: path(noteID).path) { try FileManager.default.removeItem(at: path(noteID)) }
    }
    func prepare(noteID: UUID, ink: Data, head: UUID, generation: UUID) throws -> CloudInkPlan {
        try CloudCacheScope.synchronized {
            guard try cacheScope?.locallyPurged(noteID) != true else { throw LifecycleError.unavailable }
            return try prepareProtected(noteID: noteID, ink: ink, head: head, generation: generation)
        }
    }
    private func prepareProtected(noteID: UUID, ink: Data, head: UUID, generation: UUID) throws -> CloudInkPlan {
        guard !ink.isEmpty, ink.count <= 3 * 1024 * 1024 else { throw CloudSyncFailure.unsupported }
        if let previous = try plan(noteID), previous.ink == ink, previous.downloadedCache != true,
           previous.head == head, previous.generation == generation { return previous }
        let drawing: PKDrawing
        do { drawing = try PKDrawing(data: ink) } catch { throw CloudSyncFailure.invalidResponse }
        let preview = try Self.preview(drawing)
        let value = CloudInkPlan(noteID: noteID, attachmentID: try plan(noteID)?.attachmentID ?? UUID(),
            versionID: UUID(), head: head, generation: generation, ink: ink, preview: preview)
        try JSONEncoder().encode(value).write(to: path(noteID), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return value
    }
    func upload(_ plan: CloudInkPlan, transport: any CloudTransport,
                authorize: @Sendable () async throws -> CloudSecret) async throws -> CloudJSON {
        let manifest: CloudJSON = .object(["libraryId": .uuid(libraryID), "noteId": .uuid(plan.noteID),
            "attachmentId": .uuid(plan.attachmentID), "versionId": .uuid(plan.versionID),
            "generation": .uuid(plan.generation), "expectedRevision": .uuid(plan.head),
            "ink": descriptor(plan.ink, type: "application/x-apple-pencilkit"), "preview": descriptor(plan.preview, type: "image/png")])
        let reserved = try await transport.json(path: "api/sync/ink", method: "POST", body: manifest, secret: authorize())
        guard ["pending", "ready"].contains(reserved["status"]?.string ?? "") else { throw CloudSyncFailure.changed }
        for (part, bytes, type) in [("ink", plan.ink, "application/x-apple-pencilkit"), ("preview", plan.preview, "image/png")] {
            try Task.checkCancellation()
            let result = try await transport.request(path: "api/sync/ink", method: "PUT",
                query: [.init(name: "versionId", value: plan.versionID.uuidString.lowercased()), .init(name: "part", value: part)],
                body: bytes, contentType: type, secret: authorize(), maxBytes: 4096)
            let status = try JSONDecoder().decode(CloudJSON.self, from: result)
            guard ["pending", "ready"].contains(status["status"]?.string ?? "") else { throw CloudSyncFailure.changed }
        }
        return plan.reference
    }
    func download(noteID: UUID, revisionID: UUID, references: [CloudJSON], transport: any CloudTransport,
                  secret: CloudSecret) async throws -> Data {
        guard references.count <= 1 else { throw CloudSyncFailure.unsupported }
        guard let reference = references.first else { return Data() }
        let version = try reference.requiredUUID("versionId")
        let bytes = try await transport.request(path: "api/sync/ink", method: "GET", query: [
            .init(name: "libraryId", value: libraryID.uuidString.lowercased()),
            .init(name: "noteId", value: noteID.uuidString.lowercased()),
            .init(name: "revisionId", value: revisionID.uuidString.lowercased()),
            .init(name: "versionId", value: version.uuidString.lowercased()), .init(name: "part", value: "ink")],
            body: nil, contentType: "application/json", secret: secret, maxBytes: 3 * 1024 * 1024)
        let drawing: PKDrawing
        do { drawing = try PKDrawing(data: bytes) } catch { throw CloudSyncFailure.invalidResponse }
        let remembered = CloudInkPlan(noteID: noteID, attachmentID: try reference.requiredUUID("id"), versionID: version,
            head: revisionID, generation: UUID(), ink: bytes, preview: try Self.preview(drawing), downloadedCache: true)
        try CloudCacheScope.synchronized {
            guard try cacheScope?.locallyPurged(noteID) != true else { throw LifecycleError.unavailable }
            try JSONEncoder().encode(remembered).write(to: path(noteID), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        return bytes
    }
    private func descriptor(_ data: Data, type: String) -> CloudJSON {
        .object(["size": .number(Double(data.count)), "sha256": .string(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()),
                 "contentType": .string(type)])
    }
    /// Normalizes grayscale/wide-gamut sources to bounded, static 8-bit RGB(A) PNG.
    static func preview(_ drawing: PKDrawing) throws -> Data {
        let bounds = drawing.bounds.isEmpty ? CGRect(x: 0, y: 0, width: 1, height: 1) : drawing.bounds.insetBy(dx: -8, dy: -8)
        guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { throw CloudSyncFailure.invalidResponse }
        let scale = min(1, 1024 / max(bounds.width, bounds.height))
        let width = max(1, Int(ceil(bounds.width * scale))), height = max(1, Int(ceil(bounds.height * scale)))
        guard let color = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                  space: color, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              let image = drawing.image(from: bounds, scale: scale).cgImage else { throw CloudSyncFailure.unavailable }
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let normalized = context.makeImage() else { throw CloudSyncFailure.unavailable }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { throw CloudSyncFailure.unavailable }
        CGImageDestinationAddImage(destination, normalized, [kCGImagePropertyPNGDictionary: [kCGImagePropertyPNGInterlaceType: 0]] as CFDictionary)
        guard CGImageDestinationFinalize(destination), data.length <= 3 * 1024 * 1024 else { throw CloudSyncFailure.unsupported }
        return data as Data
    }
}
