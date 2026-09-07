import CryptoKit
import XCTest
@testable import DoodleNoteNative

private actor ModelFetchFixture {
    var requests: [String] = []
    var failSecond = true
    func fetch(_ url: URL) throws -> URL {
        requests.append(url.lastPathComponent)
        if url.lastPathComponent == "second", failSecond { throw URLError(.networkConnectionLost) }
        let result = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data(url.lastPathComponent.utf8).write(to: result)
        return result
    }
    func allowRetry() { failSecond = false }
}

final class ModelReadinessTests: XCTestCase {
    private func manifest(revision: String = "revision1") -> SpeakerModelManifest {
        .init(repository: "owner/model", revision: revision, package: "Model.mlpackage", files: ["first", "second"].map {
            let bytes = Data($0.utf8)
            return .init(path: $0, size: bytes.count, sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
        })
    }

    func testInterruptedDownloadRetriesOnlyMissingFilesAndVerifiesInstalledBytes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ModelFetchFixture()
        let store = SpeakerModelStore(root: root, manifest: manifest(), capacity: { _ in 1_000_000_000 }, fetch: { url, _, update in
            let file = try await fixture.fetch(url); update(6); return file
        })
        do { try await store.download(); XCTFail("Expected interrupted transport") } catch {}
        let before = await store.installed()
        XCTAssertFalse(before)
        await fixture.allowRetry()
        try await store.download()
        let calls = await fixture.requests
        XCTAssertEqual(calls, ["first", "second", "second"])
        let installed = await store.installed()
        XCTAssertTrue(installed)
        let package = try await store.modelURL()
        try Data("wrong".utf8).write(to: package.appendingPathComponent("first"))
        let corrupted = await store.installed()
        XCTAssertFalse(corrupted, "A marker must not disguise corrupt bytes")
    }

    func testLowStorageDoesNotStartTransferOrDamagePreviouslyInstalledVersion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let oldFile = root.appendingPathComponent("previous/keep")
        try FileManager.default.createDirectory(at: oldFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("old model".utf8).write(to: oldFile)
        let fixture = ModelFetchFixture()
        let store = SpeakerModelStore(root: root, manifest: manifest(), capacity: { _ in 1 }, fetch: { url, _, _ in try await fixture.fetch(url) })
        do { try await store.download(); XCTFail("Expected storage failure") }
        catch { XCTAssertTrue(error is SpeakerModelError) }
        let calls = await fixture.requests
        XCTAssertTrue(calls.isEmpty)
        XCTAssertEqual(try String(contentsOf: oldFile, encoding: .utf8), "old model")
    }

    func testExplicitModelRemovalPreservesSiblingNotesAndPartialDownloadsAreRemoved() async throws {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: parent) }
        let root = parent.appendingPathComponent("models")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("preparing-revision1"), withIntermediateDirectories: true)
        let note = parent.appendingPathComponent("note.json")
        try Data("private note".utf8).write(to: note)
        let store = SpeakerModelStore(root: root, manifest: manifest())
        try await store.remove()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        XCTAssertEqual(try String(contentsOf: note, encoding: .utf8), "private note")
    }

    func testReplacementValidatesBeforeReplacingAndInstalledModelNeedsNoTransport() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = ModelFetchFixture()
        await fixture.allowRetry()
        let store = SpeakerModelStore(root: root, manifest: manifest(), capacity: { _ in 1_000_000_000 }, fetch: { url, _, _ in try await fixture.fetch(url) })
        try await store.download()
        try await store.download()
        let offline = SpeakerModelStore(root: root, manifest: manifest(), fetch: { _, _, _ in throw URLError(.notConnectedToInternet) })
        let model = try await offline.modelURL()
        XCTAssertEqual(try String(contentsOf: model.appendingPathComponent("first"), encoding: .utf8), "first")
        let failingReplacement = SpeakerModelStore(root: root, manifest: manifest(), capacity: { _ in 1_000_000_000 }, fetch: { _, _, _ in
            let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try Data("bad".utf8).write(to: path)
            return path
        })
        do { try await failingReplacement.download(); XCTFail("Expected integrity failure") } catch {}
        let remainsInstalled = await offline.installed()
        XCTAssertTrue(remainsInstalled)
    }

    func testCancellationKeepsVerifiedPartialAndSerializesRemoval() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let enteredSecond = expectation(description: "Second transfer started")
        let store = SpeakerModelStore(root: root, manifest: manifest(), capacity: { _ in 1_000_000_000 }, fetch: { url, _, _ in
            if url.lastPathComponent == "second" {
                enteredSecond.fulfill()
                try await Task.sleep(for: .seconds(30))
            }
            let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try Data(url.lastPathComponent.utf8).write(to: path)
            return path
        })
        let operation = Task { try await store.download() }
        await fulfillment(of: [enteredSecond], timeout: 2)
        do { try await store.remove(); XCTFail("Removal must not race a transfer") } catch {}
        operation.cancel()
        do { try await operation.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("Unexpected error") }
        let saved = root.appendingPathComponent("preparing-revision1/Model.mlpackage/first")
        XCTAssertEqual(try String(contentsOf: saved, encoding: .utf8), "first")
        let installed = await store.installed()
        XCTAssertFalse(installed)
    }

    func testInvalidManifestCannotEscapeModelDirectory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let unsafe = SpeakerModelManifest(repository: "owner/model", revision: "../outside", package: "Model.mlpackage", files: manifest().files)
        let store = SpeakerModelStore(root: root, manifest: unsafe)
        do { try await store.download(); XCTFail("Expected rejected manifest") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }
}
