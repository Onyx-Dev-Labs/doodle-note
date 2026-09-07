import XCTest

@MainActor final class LocalizationUITests: XCTestCase {
    func testChangingLanguageInSettingsPersistsWithoutRewritingNote() {
        let app = XCUIApplication()
        let fixture = "--fixture-id=\(UUID().uuidString)"
        app.launchArguments = ["--ui-testing", "--localization-fixture", "--app-language=en-US", fixture]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let text = app.textViews["personalNotes"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        text.tap(); text.typeText("Record is my original wording.")
        app.buttons["doneTyping"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing", "--localization-fixture", fixture]
        app.launch()
        XCTAssertTrue(app.buttons["libraryOptions"].waitForExistence(timeout: 10))
        app.buttons["libraryOptions"].tap()
        app.buttons["Models"].tap()
        let language = app.buttons["settingsLanguage"]
        XCTAssertTrue(language.waitForExistence(timeout: 5))
        language.tap()
        app.buttons["Deutsch"].tap()
        XCTAssertTrue(app.navigationBars["Modelle"].waitForExistence(timeout: 5))
        app.buttons["Fertig"].tap()
        XCTAssertTrue(app.staticTexts["Record is my original wording."].firstMatch.exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["newNote"].label, "Neue Notiz")
        XCTAssertTrue(app.staticTexts["Record is my original wording."].firstMatch.exists)
        app.terminate()
    }

    func testAllFiveLanguagesSetupEditorAndPersistence() {
        let cases = [
            ("en-US", "Welcome to DoodleNote", "Start taking notes", "Record"),
            ("da-DK", "Velkommen til DoodleNote", "Begynd at tage noter", "Optag"),
            ("es-ES", "Bienvenido a DoodleNote", "Empezar a tomar notas", "Grabar"),
            ("fr-FR", "Bienvenue dans DoodleNote", "Commencer à prendre des notes", "Enregistrer"),
            ("de-DE", "Willkommen bei DoodleNote", "Mit Notizen beginnen", "Aufnehmen")
        ]
        for (language, welcome, begin, record) in cases {
            let app = XCUIApplication()
            let fixture = "--fixture-id=\(UUID().uuidString)"
            app.launchArguments = ["--ui-testing", "--localization-fixture", "--first-run-fixture", "--app-language=\(language)", fixture]
            if language == "de-DE" { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
            app.launch()
            XCTAssertTrue(app.navigationBars[welcome].waitForExistence(timeout: 10))
            let start = app.buttons["finishSetup"]
            for _ in 0..<8 {
                if start.exists && start.isHittable { break }
                app.swipeUp()
            }
            XCTAssertEqual(start.label, begin)
            start.tap()
            XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 5))
            app.buttons["newNote"].tap()
            let text = app.textViews["personalNotes"]
            XCTAssertTrue(text.waitForExistence(timeout: 5))
            text.tap(); text.typeText("Untranslated personal text")
            if app.buttons["doneTyping"].exists { app.buttons["doneTyping"].tap() }
            XCTAssertEqual(app.buttons["recordButton"].label, record)
            let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "\(language) editor and accessibility text"; shot.lifetime = .keepAlways; add(shot)
            app.terminate()
            app.launchArguments = ["--ui-testing", "--localization-fixture", fixture]
            app.launch()
            XCTAssertFalse(app.buttons["finishSetup"].exists)
            XCTAssertTrue(app.staticTexts["Untranslated personal text"].firstMatch.waitForExistence(timeout: 8))
            app.terminate()
        }
    }
}
