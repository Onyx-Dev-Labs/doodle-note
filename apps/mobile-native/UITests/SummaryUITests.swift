import XCTest

@MainActor final class SummaryUITests: XCTestCase {
    private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }
    func testSyntheticDraftSavedAsVersionWithOriginalSource() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--summary-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let body = app.textViews.firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        body.tap(); body.typeText("We discussed the release. No owner or date was agreed.")
        app.buttons["doneTyping"].tap()
        app.buttons["Summary"].firstMatch.tap()
        let generate = app.buttons["generateSummary"]
        XCTAssertTrue(generate.waitForExistence(timeout: 5))
        reveal(generate, app: app); generate.tap()
        XCTAssertTrue(app.staticTexts["Review generated draft"].waitForExistence(timeout: 10))
        let save = app.buttons["saveGeneratedSummary"]
        reveal(save, app: app); save.tap()
        let source = app.buttons["Source 1"].firstMatch
        reveal(source, app: app); source.tap()
        XCTAssertTrue(app.staticTexts["We discussed the release. No owner or date was agreed."].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Selected version"].exists)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Synthetic summary with retained source"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    func testCancelAndUnavailableModelPreservePersonalText() {
        for mode in ["--summary-slow", "--summary-unavailable"] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--summary-fixture", mode]
            app.launch()
            XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
            app.buttons["newNote"].tap()
            let body = app.textViews.firstMatch
            XCTAssertTrue(body.waitForExistence(timeout: 5))
            body.tap(); body.typeText("Preserved personal source.")
        app.buttons["doneTyping"].tap()
            app.buttons["Summary"].firstMatch.tap()
            let generate = app.buttons["generateSummary"]
            reveal(generate, app: app); generate.tap()
            if mode == "--summary-slow" {
                let cancel = app.buttons["Cancel generation"]
                XCTAssertTrue(cancel.waitForExistence(timeout: 5)); cancel.tap()
                XCTAssertTrue(app.staticTexts["Summary generation canceled. Your notes and previous versions are preserved."].waitForExistence(timeout: 5))
            } else {
                XCTAssertTrue(app.staticTexts["Synthetic model unavailable"].waitForExistence(timeout: 5))
            }
            XCTAssertFalse(app.staticTexts["Review generated draft"].exists)
            app.buttons["Notes"].firstMatch.tap()
            XCTAssertEqual(app.textViews["personalNotes"].value as? String, "Preserved personal source.")
            app.terminate()
        }
    }

    func testEditedVersionRequiresReviewBeforeRegeneratedSelection() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--summary-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let body = app.textViews.firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        body.tap(); body.typeText("The team reviewed the plan.")
        app.buttons["doneTyping"].tap()
        app.buttons["Summary"].firstMatch.tap()
        let generate = app.buttons["generateSummary"]
        reveal(generate, app: app); generate.tap()
        let save = app.buttons["saveGeneratedSummary"]
        XCTAssertTrue(save.waitForExistence(timeout: 10)); reveal(save, app: app); save.tap()
        let edit = app.buttons["Edit as new version"].firstMatch
        reveal(edit, app: app); edit.tap()
        let editor = app.textViews["summaryVersionText"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); editor.tap(); editor.typeText(" User edit.")
        app.buttons["Save version"].tap()
        XCTAssertTrue(app.staticTexts["Edited version"].waitForExistence(timeout: 5))
        for _ in 0..<6 where !generate.isHittable { app.swipeDown() }
        XCTAssertTrue(generate.isHittable); generate.tap()
        XCTAssertTrue(save.waitForExistence(timeout: 10)); reveal(save, app: app); save.tap()
        XCTAssertTrue(app.buttons["Select generated version"].waitForExistence(timeout: 5))
        app.buttons["Select generated version"].tap()
        XCTAssertTrue(save.waitForNonExistence(timeout: 5))
        let retained = app.staticTexts["Edited version"]
        reveal(retained, app: app)
        XCTAssertTrue(retained.exists)
    }

    func testSpanishSummaryControlsAndErrorKeepOriginalText() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--summary-fixture", "--summary-unavailable", "--localization-fixture", "--app-language=es-ES"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let body = app.textViews["personalNotes"]
        XCTAssertTrue(body.waitForExistence(timeout: 5)); body.tap(); body.typeText("Original source stays English.")
        app.buttons["doneTyping"].tap()
        app.buttons["Resumen"].firstMatch.tap()
        let generate = app.buttons["generateSummary"]
        reveal(generate, app: app); XCTAssertEqual(generate.label, "Generar borrador"); generate.tap()
        XCTAssertTrue(app.staticTexts["Modelo sintético no disponible"].waitForExistence(timeout: 5))
        app.buttons["Notas"].firstMatch.tap()
        XCTAssertEqual(body.value as? String, "Original source stays English.")
    }

}
