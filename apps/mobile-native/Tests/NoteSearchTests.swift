import XCTest
@testable import DoodleNoteNative

final class NoteSearchTests: XCTestCase {
    private func note(_ text: String, libraryID: UUID = LibraryRecord.localID) -> NoteRecord {
        var note = NoteRecord()
        note.text = text; note.metadata?.libraryID = libraryID
        return note
    }

    func testOldRecordsCompleteCountsAndCrossParagraphRecallBeyondResultLimit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var notes = (0..<500).map { note("Record \($0)") }
        notes[0].text = "Budget for the archive\nThe needle is café."
        notes[0].createdAt = .distantPast
        let index = NoteSearchIndex(root: root)
        let input = NoteSearchInput(libraryID: LibraryRecord.localID, authorized: true, generation: 1, notes: notes)
        let old = try await index.search("budget café", input: input)
        XCTAssertEqual(old.matchedNoteIDs, [notes[0].id])
        XCTAssertEqual(old.hits.count, 2, "Terms across original paragraphs still find the whole note")
        let all = try await index.search("", input: input, limit: 10)
        XCTAssertEqual(all.matchedNoteCount, 500)
        XCTAssertEqual(all.matchedNoteIDs.count, 500)
        XCTAssertEqual(all.hits.count, 10)
        XCTAssertFalse(all.isExhaustive)
        XCTAssertTrue(all.countsAreComplete)
        let exhaustive = try await index.search("", input: input, limit: nil)
        XCTAssertTrue(exhaustive.isExhaustive)
        XCTAssertEqual(exhaustive.hits.count, 501)
    }

    func testTrashSignoutCrossLibraryAndLateSnapshotCannotResurrectRows() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let cloud = UUID(), other = UUID()
        let index = NoteSearchIndex(root: root)
        let original = NoteSearchInput(libraryID: cloud, authorized: true, generation: 1, notes: [note("private alpha", libraryID: cloud)])
        let actual1 = try await index.search("alpha", input: original).matchedNoteCount
        XCTAssertEqual(actual1, 1)
        let trash = NoteSearchInput(libraryID: cloud, authorized: true, generation: 2, notes: [])
        let actual2 = try await index.search("alpha", input: trash).matchedNoteCount
        XCTAssertEqual(actual2, 0)
        do { _ = try await index.search("alpha", input: original); XCTFail("Stale work must be rejected") } catch {}
        do {
            _ = try await index.search("alpha", input: .init(libraryID: cloud, authorized: false, generation: 3, notes: original.notes))
            XCTFail("Signed-out cache cannot be searched")
        } catch {}
        let otherResult = try await index.search("alpha", input: .init(libraryID: other, authorized: true, generation: 4, notes: [note("other content", libraryID: other)]))
        XCTAssertEqual(otherResult.matchedNoteCount, 0)
        do {
            _ = try await index.search("alpha", input: .init(libraryID: other, authorized: true, generation: 5, notes: original.notes))
            XCTFail("Source ownership mismatch must fail closed")
        } catch {}
    }

    func testRestartAndChecksumCorruptionRebuildFromOriginalSources() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let input = NoteSearchInput(libraryID: LibraryRecord.localID, authorized: true, generation: 1, notes: [note("original needle")])
        _ = try await NoteSearchIndex(root: root).search("needle", input: input)
        let file = root.appendingPathComponent(LibraryRecord.localID.uuidString + ".json")
        var value = try String(contentsOf: file, encoding: .utf8)
        value = value.replacingOccurrences(of: "original needle", with: "forged content")
        try value.write(to: file, atomically: true, encoding: .utf8)
        let rebuilt = try await NoteSearchIndex(root: root).search("needle", input: input)
        XCTAssertEqual(rebuilt.hits.first?.text, "original needle")
        let actual3 = try await NoteSearchIndex(root: root).search("forged", input: input).matchedNoteCount
        XCTAssertEqual(actual3, 0)
    }

    func testOnlySelectedSummaryIsIndexedAndMissingSourcesMakeCountsIncomplete() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var record = note("typed")
        let first = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated, format: "general", language: .english, text: "obsolete summary", sources: [])
        let selected = SummaryVersion(id: UUID(), parentID: first.id, createdAt: Date(), origin: .edited, format: "general", language: .english, text: "chosen summary", sources: [])
        record.metadata?.summaries = [first, selected]; record.metadata?.selectedSummaryID = selected.id
        let input = NoteSearchInput(libraryID: LibraryRecord.localID, authorized: true, generation: 1, notes: [record])
        let index = NoteSearchIndex(root: root)
        let actual4 = try await index.search("obsolete", input: input).matchedNoteCount
        XCTAssertEqual(actual4, 0)
        let result = try await index.search("chosen", input: input)
        XCTAssertEqual(result.hits.first?.source.content, .summary(selected.id))
        record.metadata?.selectedSummaryID = UUID(); record.metadata?.revisionID = UUID()
        let missing = try await index.search("typed", input: .init(libraryID: LibraryRecord.localID, authorized: true, generation: 2, notes: [record]))
        XCTAssertFalse(missing.countsAreComplete)
        XCTAssertNotNil(missing.incompleteReason)
    }
}

@MainActor final class NoteSearchLibraryTests: XCTestCase {
    func testSavedSourcesStayStableAcrossEditsAndDisappearFromSignedOutScope() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = NoteLibrary(root: root)
        await library.waitUntilLoaded()
        let identity = LibraryIdentity(accountID: "test-account", workspaceID: "test-workspace")
        try await library.authenticate(identity, name: "Account notes")
        let scope = try XCTUnwrap(library.libraries.first { $0.identity == identity })
        library.selectLibrary(scope.id)
        let id = try XCTUnwrap(library.create())
        library.update(id) { $0.title = "Original title"; $0.text = "Original source paragraph" }
        let saved = await library.flush(); XCTAssertTrue(saved)
        let sourceNote = try XCTUnwrap(library.note(id))
        let paragraph = SourceAnchor(libraryID: scope.id, noteID: id, revisionID: sourceNote.metadata!.revisionID, content: .personalParagraph(0))
        let summary = SummaryVersion(id: UUID(), parentID: nil, createdAt: Date(), origin: .generated, format: "general", language: .english, text: "Original generated summary", sources: [paragraph])
        library.update(id) { $0.metadata?.summaries = [summary]; $0.metadata?.selectedSummaryID = summary.id }
        let savedSummary = await library.flush(); XCTAssertTrue(savedSummary)
        let summaryAnchor = SourceAnchor(libraryID: scope.id, noteID: id, revisionID: summary.id, content: .summary(summary.id))
        library.update(id) { $0.text = "New personal wording"; $0.metadata?.selectedSummaryID = nil }
        let savedEdit = await library.flush(); XCTAssertTrue(savedEdit)
        let oldParagraph = try await library.resolveSearchSource(paragraph)
        let oldSummary = try await library.resolveSearchSource(summaryAnchor)
        XCTAssertEqual(oldParagraph, "Original source paragraph")
        XCTAssertEqual(oldSummary, "Original generated summary")
        XCTAssertEqual(library.searchInput(generation: 1).notes.count, 1)
        await library.performStorage(.trash, id: id, captureActive: false)
        XCTAssertEqual(library.searchInput(generation: 2).notes.count, 0)
        do { _ = try await library.resolveSearchSource(paragraph); XCTFail("Trash cannot resolve a source") } catch {}
        await library.performStorage(.restore, id: id, captureActive: false)
        XCTAssertEqual(library.searchInput(generation: 3).notes.count, 1)
        let afterRestore = try await library.resolveSearchSource(paragraph)
        XCTAssertEqual(afterRestore, "Original source paragraph")
        let signedOut = await library.signOut(identity, captureActive: false); XCTAssertTrue(signedOut)
        XCTAssertEqual(library.searchInput(generation: 2).notes.count, 0)
        do { _ = try await library.resolveSearchSource(summaryAnchor); XCTFail("Signed-out citation cannot open") } catch {}
        try await library.authenticate(identity, name: "Account notes")
        library.selectLibrary(scope.id)
        let restored = try await library.resolveSearchSource(summaryAnchor)
        XCTAssertEqual(restored, "Original generated summary")
    }
}
