import XCTest
@testable import DoodleNoteNative

@MainActor final class LocalizationTests: XCTestCase {
    private func withLanguage(_ language: String, _ work: () throws -> Void) rethrows {
        let old = UserDefaults.standard.object(forKey: "appLanguage")
        defer { if let old { UserDefaults.standard.set(old, forKey: "appLanguage") } else { UserDefaults.standard.removeObject(forKey: "appLanguage") } }
        UserDefaults.standard.set(language, forKey: "appLanguage")
        try work()
    }
    func testFiveLanguagesResolveExplicitlyAndEnglishFallbackIsDeterministic() {
        let expected = ["en-US": "New note", "da-DK": "Ny note", "es-ES": "Nueva nota", "fr-FR": "Nouvelle note", "de-DE": "Neue Notiz"]
        for (language, label) in expected {
            withLanguage(language) {
                XCTAssertEqual(L10n.text("New note"), label)
                XCTAssertEqual(L10n.key("New note"), label)
                XCTAssertFalse(L10n.bundle(for: L10n.language).bundlePath == Bundle.main.bundlePath)
            }
        }
        withLanguage("invalid") { XCTAssertEqual(L10n.language, "en"); XCTAssertEqual(L10n.text("New note"), "New note") }
    }
    func testPluralFormsAndNumbersAreLocalized() {
        let expected = ["en-US": ["1 note", "2 notes"], "da-DK": ["1 note", "2 noter"], "es-ES": ["1 nota", "2 notas"], "fr-FR": ["1 note", "2 notes"], "de-DE": ["1 Notiz", "2 Notizen"]]
        for (language, values) in expected {
            withLanguage(language) {
                XCTAssertEqual(L10n.count(1), values[0]); XCTAssertEqual(L10n.count(2), values[1])
                XCTAssertFalse(L10n.count(0).contains("%")); XCTAssertFalse(L10n.bytes(1_234_567).isEmpty)
            }
        }
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        var english = "", german = ""
        withLanguage("en-US") { english = L10n.date(date) }
        withLanguage("de-DE") { german = L10n.date(date) }
        XCTAssertNotEqual(english, german)
    }
    func testExistingStatusRendersAgainWithoutTranslatingUserContent() {
        let message = "Recording could not start. Microphone access is needed to record. Enable it in Settings."
        withLanguage("de-DE") { XCTAssertTrue(L10n.message(message).hasPrefix("Aufnahme konnte")); XCTAssertFalse(L10n.message(message).contains("Microphone access")) }
        withLanguage("da-DK") { XCTAssertTrue(L10n.message(message).hasPrefix("Optagelsen kunne")) }
        let note = NoteRecord(title: "Record", text: "This is user text.", language: .spanish)
        withLanguage("de-DE") { XCTAssertEqual(note.title, "Record"); XCTAssertEqual(note.text, "This is user text."); XCTAssertEqual(note.language, .spanish) }
    }
    func testCaptureFailuresAndNumericRecoveryMessagesUseCurrentLanguage() {
        let numeric = "An interrupted capture has 12 unconfirmed accepted frames and 3 rejected frames. Saved audio is preserved."
        let recovery = "Audio recovery could not use 1 trailing bytes. Original audio is preserved."
        let failures = "Recording stopped with incomplete audio. Capture finalization reported a failure. Saved audio is preserved and needs verification. Local audio playback failed. Original files are preserved."
        for language in ["da-DK", "es-ES", "fr-FR", "de-DE"] {
            withLanguage(language) {
                let localized = L10n.message(numeric)
                XCTAssertTrue(localized.contains("12")); XCTAssertTrue(localized.contains("3"))
                XCTAssertFalse(localized.contains("unconfirmed accepted"))
                XCTAssertFalse(L10n.message(recovery).contains("Original audio is preserved"))
                let combinedRecovery = L10n.message(numeric + " " + recovery + " Local audio playback failed. Original files are preserved.")
                XCTAssertFalse(combinedRecovery.contains("Audio recovery"))
                XCTAssertFalse(combinedRecovery.contains("Local audio playback"))
                let combined = L10n.message(failures)
                XCTAssertFalse(combined.contains("Recording stopped"))
                XCTAssertFalse(combined.contains("Capture finalization"))
                XCTAssertFalse(combined.contains("Local audio playback"))
                XCTAssertEqual(L10n.message("Unknown OS diagnostic 123"), "Unknown OS diagnostic 123")
            }
        }
        withLanguage("de-invalid") { XCTAssertEqual(L10n.language, "en") }
    }

    func testSpeakerDisplayDoesNotTranslateConfirmedNamesOrMutateAnnotations() {
        let session = UUID()
        var annotations = SpeakerAnnotations()
        annotations.replace(sessionID: session, with: [SpeakerTurn(sessionID: session, slot: 0, start: 0, end: 10, isFinal: true)])
        let key = annotations.speakerKeys[0]
        withLanguage("da-DK") { XCTAssertEqual(annotations.name(for: key, localized: true), "Taler 1"); XCTAssertEqual(annotations.name(for: key), "Speaker 1") }
        annotations.names[key] = "Speaker 1"
        withLanguage("da-DK") { XCTAssertEqual(annotations.name(for: key, localized: true), "Speaker 1") }
    }
}
