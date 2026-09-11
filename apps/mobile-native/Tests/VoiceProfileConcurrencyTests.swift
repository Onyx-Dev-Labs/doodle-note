import XCTest
@testable import DoodleNoteNative

@MainActor final class VoiceProfileConcurrencyTests: XCTestCase {
    private func root() -> URL {
        let url = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    private func vector(_ index: Int) -> [Float] {
        var result = [Float](repeating: 0, count: VoiceMatcher.embeddingDimension)
        result[index] = 1
        return result
    }

    func testConcurrentRemoveAndSelectionCannotResurrectDeletedProfile() async throws {
        let directory = root()
        let voices = VoiceProfiles(root: directory)
        let removed = try await voices.remember(name: "Removed", embedding: vector(0))
        let retained = try await voices.remember(name: "Retained", embedding: vector(1))
        // These MainActor calls suspend into the same disk actor from the same initial UI state.
        // Either serialization order must retain deletion and the independent selection change.
        async let deletion: Void = voices.remove(removed.id)
        async let selection: Void = voices.setSelected(retained.id, enabled: false)
        async let staleSelection: Void = voices.setSelected(removed.id, enabled: true)
        async let refresh: Void = voices.refresh()
        _ = try await (deletion, selection, staleSelection, refresh)
        XCTAssertEqual(voices.profiles.map(\.id), [retained.id])
        XCTAssertTrue(voices.catalog.selectedIDs.isEmpty)
        let persisted = try await VoiceProfileStore(root: directory).load()
        XCTAssertEqual(voices.catalog, persisted)
    }

    func testConcurrentRememberPreservesBothIndependentVoices() async throws {
        let directory = root()
        let voices = VoiceProfiles(root: directory)
        let firstVector = vector(0), secondVector = vector(1)
        async let first = voices.remember(name: "First", embedding: firstVector)
        async let second = voices.remember(name: "Second", embedding: secondVector)
        let saved = try await [first, second]
        XCTAssertEqual(Set(voices.profiles.map(\.id)), Set(saved.map(\.id)))
        XCTAssertEqual(Set(voices.catalog.selectedIDs), Set(saved.map(\.id)))
        let persisted = try await VoiceProfileStore(root: directory).load()
        XCTAssertEqual(voices.catalog, persisted)
    }

    func testDelayedRefreshAndMutationRepliesCannotRegressMainActorCatalog() async throws {
        let directory = root(), store = VoiceProfileStore(root: directory)
        let saved = try await store.remember(name: "Synthetic", embedding: vector(0))
        let oldRefresh = try await store.current()
        let removed = try await store.remove(saved.profile.id)
        let voices = VoiceProfiles(store: store)
        XCTAssertTrue(voices.apply(removed))
        let status = voices.detail
        XCTAssertFalse(voices.apply(oldRefresh))
        XCTAssertFalse(voices.apply(saved.snapshot, detail: "This voice is remembered on this device only."))
        XCTAssertTrue(voices.profiles.isEmpty)
        XCTAssertEqual(voices.detail, status)
        await voices.refresh()
        XCTAssertTrue(voices.profiles.isEmpty)
    }

    func testRemovedReplacementFailsInsteadOfCreatingAnotherVoice() async throws {
        let store = VoiceProfileStore(root: root())
        let saved = try await store.remember(name: "Synthetic", embedding: vector(0))
        _ = try await store.remove(saved.profile.id)
        do {
            _ = try await store.remember(name: "Late replacement", embedding: vector(1), replacing: saved.profile.id)
            XCTFail("A removed reference cannot be re-enrolled by a queued replacement")
        } catch VoiceProfileError.invalid {} catch { XCTFail("Unexpected error: \(error)") }
        let catalog = try await store.load()
        XCTAssertTrue(catalog.profiles.isEmpty)
    }
}
