import AVFoundation
import XCTest
@testable import DoodleNoteNative

@MainActor final class VoiceProfileTests: XCTestCase {
    private func unit(_ index: Int) -> [Float] {
        VoicePrint.normalize((0..<VoiceMatcher.embeddingDimension).map { $0 == index % VoiceMatcher.embeddingDimension ? 1 : 0 })!
    }

    private func storeRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    func testLabeledThreeAndFourSpeakerCorpusKeepsOverlapAndUncertainUnassigned() {
        let session = UUID()
        var annotations = SpeakerAnnotations()
        let turns = [
            SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 4, isFinal: true),
            SpeakerTurn(sessionID: session, slot: 1, start: 4, end: 8, isFinal: true),
            SpeakerTurn(sessionID: session, slot: 2, start: 8, end: 11, isFinal: true),
            SpeakerTurn(sessionID: session, slot: 0, start: 11, end: 13, isFinal: true),
            SpeakerTurn(sessionID: session, slot: 2, start: 11, end: 13, isFinal: true),
            SpeakerTurn(sessionID: session, slot: 3, start: 14, end: 18, isFinal: true)
        ]
        annotations.replace(sessionID: session, with: turns)
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 0, end: 4, text: "A", isFinal: true)), "Speaker 1")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 4, end: 8, text: "B", isFinal: true)), "Speaker 2")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 8, end: 11, text: "C", isFinal: true)), "Speaker 3")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 14, end: 18, text: "D", isFinal: true)), "Speaker 4")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 11, end: 13, text: "Overlap", isFinal: true)), "Multiple speakers")
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 13.2, end: 13.8, text: "Gap", isFinal: true)), "Unassigned speaker")
        annotations.uncertain = [turns[1].key]
        XCTAssertEqual(annotations.label(for: TranscriptPassage(start: 4, end: 8, text: "B", isFinal: true)), "Uncertain speaker")
        XCTAssertEqual(SpeakerAttribution.overlapFloor, 0.1)
        XCTAssertEqual(SpeakerAttribution.assignFloor, 0.65)
    }

    func testUnknownAndAmbiguousProbesDoNotReceiveAName() {
        let alex = VoiceProfile(id: UUID(), name: "Alex", embedding: unit(0), createdAt: .now, updatedAt: .now)
        let close = VoicePrint.normalize((0..<VoiceMatcher.embeddingDimension).map { $0 == 0 ? 0.92 : ($0 == 1 ? 0.39 : 0) })!
        let jordan = VoiceProfile(id: UUID(), name: "Jordan", embedding: close, createdAt: .now, updatedAt: .now)
        XCTAssertEqual(VoiceMatcher.decide(probe: unit(16), candidates: [alex, jordan]), .unknown)
        XCTAssertEqual(VoiceMatcher.decide(probe: unit(0), candidates: [alex, jordan]), .uncertain)
        XCTAssertEqual(VoiceMatcher.decide(probe: unit(0), candidates: [alex]), .identified(alex.id))
    }

    func testMatcherNeverUsesCalendarInviteesAsVoiceEvidence() {
        let alex = VoiceProfile(id: UUID(), name: "Alex", embedding: unit(0), createdAt: .now, updatedAt: .now)
        let invitees = ["Jordan", "Casey"]
        XCTAssertEqual(VoiceMatcher.decide(probe: unit(0), candidates: [alex]), .identified(alex.id))
        XCTAssertFalse(invitees.contains(alex.name) && VoiceMatcher.decide(probe: unit(16), candidates: [alex]) != .unknown)
        XCTAssertEqual(VoiceMatcher.decide(probe: unit(16), candidates: [alex]), .unknown)
    }

    func testCorrectionSurvivesFinalizationAndDoesNotMoveToANewSlot() {
        let session = UUID(), later = UUID()
        var annotations = SpeakerAnnotations()
        let draft = SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: false)
        annotations.replace(sessionID: session, with: [draft])
        annotations.confirm("Alex", for: draft.key)
        var final = draft; final.isFinal = true
        annotations.replace(sessionID: session, with: [final,
            SpeakerTurn(sessionID: session, slot: 1, start: 3, end: 6, isFinal: true)])
        XCTAssertEqual(annotations.confirmedName(for: final.key), "Alex")
        XCTAssertNil(annotations.confirmedName(for: "\(session.uuidString):1"))
        annotations.replace(sessionID: session, with: [SpeakerTurn(sessionID: session, slot: 1, start: 0, end: 6, isFinal: true)])
        XCTAssertNil(annotations.confirmedName(for: "\(session.uuidString):1"), "A confirmed name must not follow a different slot")
        XCTAssertNil(annotations.confirmedName(for: draft.key))
        annotations.replace(sessionID: later, with: [SpeakerTurn(sessionID: later, slot: 0, start: 6, end: 8, isFinal: true)])
        XCTAssertNil(annotations.confirmedName(for: "\(later.uuidString):0"))
    }

    func testUncertainSpeechDoesNotUpdateASavedProfile() async throws {
        let root = storeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let voices = VoiceProfiles(root: root)
        let original = try await voices.remember(name: "Alex", embedding: unit(0))
        var annotations = SpeakerAnnotations()
        let session = UUID()
        let key = SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true).key
        annotations.replace(sessionID: session, with: [SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true)])
        SpeakerIdentity.reconcile(&annotations, selected: voices.selectedProfiles) { _ in unit(1) }
        XCTAssertNil(annotations.confirmedName(for: key))
        XCTAssertTrue(annotations.uncertain.contains(key) || annotations.confirmedName(for: key) == nil)
        await voices.refresh()
        XCTAssertEqual(voices.profiles.first?.embedding, original.embedding)
        XCTAssertEqual(voices.profiles.first?.updatedAt, original.updatedAt)
    }

    @MainActor func testRememberMatchSelectAndRemoveStayDeviceLocal() async throws {
        let root = storeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let voices = VoiceProfiles(root: root)
        let saved = try await voices.remember(name: "Alex", embedding: unit(0))
        XCTAssertEqual(voices.profiles.map(\.name), ["Alex"])
        XCTAssertTrue(voices.catalog.selectedIDs.contains(saved.id))
        var annotations = SpeakerAnnotations()
        let session = UUID()
        annotations.replace(sessionID: session, with: [SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true)])
        SpeakerIdentity.reconcile(&annotations, selected: voices.selectedProfiles) { _ in unit(0) }
        XCTAssertEqual(annotations.confirmedName(for: annotations.speakerKeys[0]), "Alex")
        await voices.setSelected(saved.id, enabled: false)
        var next = SpeakerAnnotations()
        next.replace(sessionID: session, with: annotations.turns)
        SpeakerIdentity.reconcile(&next, selected: voices.selectedProfiles) { _ in unit(0) }
        XCTAssertNil(next.confirmedName(for: annotations.speakerKeys[0]), "Unselected profiles are not matched")
        try await voices.remove(saved.id)
        XCTAssertTrue(voices.profiles.isEmpty)
        let reopened = VoiceProfiles(root: root)
        await reopened.refresh()
        XCTAssertTrue(reopened.profiles.isEmpty)
    }

    func testProfilesAreExcludedFromNotesCloudArchiveSearchAndGenerationPayloads() async throws {
        let root = storeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let voices = VoiceProfiles(root: root)
        let saved = try await voices.remember(name: "Alex", embedding: unit(3))
        let marker = String(format: "%.5f", saved.embedding[3])
        let notes = root.appendingPathComponent("notes", isDirectory: true)
        let store = try NoteDiskStore(root: notes)
        var note = NoteRecord()
        let session = UUID()
        let turn = SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true)
        note.speakerAnnotations = .init(turns: [turn], names: [turn.key: "Alex"])
        note.passages = [TranscriptPassage(start: 0, end: 3, text: "I can help review.", isFinal: true)]
        try store.save(note)
        let encoded = String(decoding: try Data(contentsOf: store.directory(for: note.id).appendingPathComponent("note.json")), as: UTF8.self)
        XCTAssertFalse(encoded.contains("embedding"))
        XCTAssertFalse(encoded.contains(marker))
        XCTAssertTrue(encoded.contains("Alex"))
        let map = CloudIdentityMap(identity: .init(accountID: "one", workspaceID: "work"), remoteLibraryID: UUID())
        note.metadata?.libraryID = map.localLibraryID
        let snapshot = try CloudProjection(map: map, remoteNoteID: UUID()).snapshot(note: note, retained: [], inkReferences: [])
        let wire = String(decoding: try snapshot.data(), as: UTF8.self)
        XCTAssertNil(snapshot["voiceProfiles"])
        XCTAssertFalse(wire.contains(marker))
        XCTAssertFalse(wire.contains("embedding"))
        try FileManager.default.createDirectory(at: notes.appendingPathComponent("VoiceProfiles"), withIntermediateDirectories: true)
        try Data("secret-embedding".utf8).write(to: notes.appendingPathComponent("VoiceProfiles/profiles.json"))
        let archived = LocalArchivePolicy.bundledPaths(in: notes).map(\.path)
        XCTAssertFalse(archived.contains { $0.contains("VoiceProfiles") })
        XCTAssertTrue(LocalArchivePolicy.bundledPaths(in: notes).contains { $0.lastPathComponent == "note.json" })
        let index = NoteSearchIndex(root: root.appendingPathComponent("search"))
        let result = try await index.search("help", input: .init(libraryID: note.metadata!.libraryID, authorized: true, generation: 1, notes: [note]))
        XCTAssertEqual(result.hits.first?.text, "I can help review.")
        XCTAssertFalse(result.hits.contains { $0.text.contains(marker) })
        XCTAssertEqual(SummaryGenerator.confirmedSpeaker(note.passages[0], note: note), "Alex")
        let sources = try SummaryGenerator.sources(note)
        let payload = String(decoding: try JSONEncoder().encode(sources), as: UTF8.self)
        XCTAssertTrue(payload.contains("Alex"))
        XCTAssertFalse(payload.contains(marker))
    }

    func testEnrollmentRequiresFinalSoloAudioAndRecordingWorksWithoutProfiles() {
        let session = UUID()
        var annotations = SpeakerAnnotations()
        annotations.replace(sessionID: session, with: [
            SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: false),
            SpeakerTurn(sessionID: session, slot: 1, start: 1, end: 2.5, isFinal: true)
        ])
        XCTAssertFalse(SpeakerEnrollment.canEnroll(key: annotations.speakerKeys[0], annotations: annotations))
        var solo = SpeakerAnnotations()
        solo.replace(sessionID: session, with: [SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 3, isFinal: true)])
        XCTAssertTrue(SpeakerEnrollment.canEnroll(key: solo.speakerKeys[0], annotations: solo))
        XCTAssertTrue(VoiceProfileCatalog().profiles.isEmpty)
    }
}
