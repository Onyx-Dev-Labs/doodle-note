import ImageIO
import PencilKit
import XCTest
@testable import DoodleNoteNative

final class CloudInkTests: XCTestCase {
    func testPrivateInkLostReplyReusesBytesAndDownloadRequiresRevisionBinding() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = UUID(), note = UUID(), head = UUID(), generation = UUID()
        let transfer = try CloudInkTransfer(root: root, libraryID: library)
        let plan = try await transfer.prepare(noteID: note, ink: PKDrawing().dataRepresentation(), head: head, generation: generation)
        let transport = InkFixtureTransport(plan: plan, library: library)
        let secret = try CloudSecret("dnsy_" + String(repeating: "a", count: 64))
        do { _ = try await transfer.upload(plan, transport: transport, authorize: { secret }); XCTFail("lost ink acknowledgement") }
        catch CloudSyncFailure.unavailable {}
        let reopened = try CloudInkTransfer(root: root, libraryID: library)
        let retry = try await reopened.prepare(noteID: note, ink: plan.ink, head: head, generation: generation)
        let reference = try await reopened.upload(retry, transport: transport, authorize: { secret })
        XCTAssertEqual(reference, plan.reference)
        let manifests = await transport.manifests
        XCTAssertEqual(manifests.count, 2)
        XCTAssertEqual(manifests.first, manifests.last)
        let inkWrites = await transport.inkWrites
        XCTAssertEqual(inkWrites, [plan.ink, plan.ink])
        let bytes = try await reopened.download(noteID: note, revisionID: head, references: [reference], transport: transport, secret: secret)
        XCTAssertEqual(bytes, plan.ink)
        let rebased = try await reopened.prepare(noteID: note, ink: bytes, head: UUID(), generation: UUID())
        XCTAssertNotEqual(rebased.versionID, plan.versionID, "download cache is not a pending upload reservation")
        do {
            _ = try await reopened.download(noteID: note, revisionID: UUID(), references: [reference], transport: transport, secret: secret)
            XCTFail("wrong revision must not read private ink")
        } catch CloudSyncFailure.permission {}
    }

    func testInkUploadReauthorizesBeforeEachPrivatePart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = UUID(), transfer = try CloudInkTransfer(root: root, libraryID: library)
        let plan = try await transfer.prepare(noteID: UUID(), ink: PKDrawing().dataRepresentation(), head: UUID(), generation: UUID())
        let transport = InkFixtureTransport(plan: plan, library: library, loseFirstInkReply: false)
        let authorization = InkFixtureAuthorization()
        do { _ = try await transfer.upload(plan, transport: transport, authorize: { try await authorization.next() }); XCTFail("revoked before preview") }
        catch CloudSyncFailure.permission {}
        let previews = await transport.previewWrites
        XCTAssertEqual(previews, 0)
        let inkWrites = await transport.inkWrites
        XCTAssertEqual(inkWrites.count, 1)
    }

    func testEmptyDrawingPreviewIsBoundedStaticRGBAAndUploadPlanSurvivesRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = UUID(), note = UUID(), head = UUID(), generation = UUID()
        let transfer = try CloudInkTransfer(root: root, libraryID: library)
        let ink = PKDrawing().dataRepresentation()
        let plan = try await transfer.prepare(noteID: note, ink: ink, head: head, generation: generation)
        let png = plan.preview
        XCTAssertEqual(Array(png.prefix(8)), [137,80,78,71,13,10,26,10])
        XCTAssertEqual(png[24], 8, "8-bit preview")
        XCTAssertTrue([2,6].contains(png[25]), "RGB or RGBA only")
        XCTAssertEqual(png[28], 0, "not interlaced")
        let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertGreaterThan(image.width, 0)
        XCTAssertLessThanOrEqual(image.width * image.height, 4_194_304)
        let reopened = try CloudInkTransfer(root: root, libraryID: library)
        let retry = try await reopened.prepare(noteID: note, ink: ink, head: head, generation: generation)
        XCTAssertEqual(retry.versionID, plan.versionID)
        XCTAssertEqual(retry.head, head)
        XCTAssertEqual(retry.preview, plan.preview)
        let matched = try await reopened.matches(noteID: note, ink: ink, references: [plan.reference])
        XCTAssertTrue(matched)
        let changedHead = UUID(), changedGeneration = UUID()
        let rebased = try await reopened.prepare(noteID: note, ink: ink, head: changedHead, generation: changedGeneration)
        XCTAssertNotEqual(rebased.versionID, plan.versionID)
        XCTAssertEqual(rebased.head, changedHead)
        XCTAssertEqual(rebased.generation, changedGeneration)
        try await reopened.purge(noteID: note)
        let after = try await reopened.matches(noteID: note, ink: ink, references: [plan.reference])
        XCTAssertFalse(after)
    }
}

private actor InkFixtureAuthorization {
    var calls = 0
    func next() throws -> CloudSecret {
        calls += 1
        guard calls < 3 else { throw CloudSyncFailure.permission }
        return try CloudSecret("dnsy_" + String(repeating: "a", count: 64))
    }
}

private actor InkFixtureTransport: CloudTransport {
    let plan: CloudInkPlan
    let library: UUID
    let loseFirstInkReply: Bool
    var manifests: [Data] = []
    var inkWrites: [Data] = []
    var previewWrites = 0
    init(plan: CloudInkPlan, library: UUID, loseFirstInkReply: Bool = true) {
        self.plan = plan; self.library = library; self.loseFirstInkReply = loseFirstInkReply
    }
    func request(path: String, method: String, query: [URLQueryItem], body: Data?, contentType: String,
                 secret: CloudSecret, maxBytes: Int) async throws -> Data {
        XCTAssertEqual(path, "api/sync/ink")
        let params = Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") })
        if method == "POST" {
            let bytes = try XCTUnwrap(body)
            manifests.append(bytes)
            let manifest = try JSONDecoder().decode(CloudJSON.self, from: bytes)
            XCTAssertEqual(manifest["noteId"], .uuid(plan.noteID))
            XCTAssertEqual(manifest["libraryId"], .uuid(library))
            XCTAssertEqual(manifest["expectedRevision"], .uuid(plan.head))
            XCTAssertEqual(manifest["generation"], .uuid(plan.generation))
            XCTAssertEqual(manifest["ink"]?["size"], .number(Double(plan.ink.count)))
        } else if method == "PUT" {
            XCTAssertEqual(params["versionId"], plan.versionID.uuidString.lowercased())
            if params["part"] == "ink" {
                inkWrites.append(try XCTUnwrap(body))
                if loseFirstInkReply && inkWrites.count == 1 { throw CloudSyncFailure.unavailable }
            } else {
                XCTAssertEqual(params["part"], "preview")
                XCTAssertEqual(body, plan.preview)
                previewWrites += 1
            }
        } else {
            guard params["libraryId"] == library.uuidString.lowercased(),
                  params["noteId"] == plan.noteID.uuidString.lowercased(),
                  params["revisionId"] == plan.head.uuidString.lowercased(),
                  params["versionId"] == plan.versionID.uuidString.lowercased(), params["part"] == "ink"
            else { throw CloudSyncFailure.permission }
            return plan.ink
        }
        return try CloudJSON.object(["status": .string("pending")]).data()
    }
}
