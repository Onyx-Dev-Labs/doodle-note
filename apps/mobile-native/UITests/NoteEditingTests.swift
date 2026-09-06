import XCTest

@MainActor final class NoteEditingTests: XCTestCase {
    func testSpeakerControlsAreAvailableWithoutDownloadingModels() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        XCTAssertTrue(app.buttons["speakerSettings"].waitForExistence(timeout: 5))
        app.buttons["speakerSettings"].tap()
        XCTAssertTrue(app.switches["Live speaker labels"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Download speaker model"].exists)
        XCTAssertTrue(app.buttons["recordButton"].isEnabled)
    }
    func testCreateEditAndRecoverAfterRelaunch() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        let create = app.buttons["newNote"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        let title = app.textFields["noteTitle"].firstMatch
        // A multiline TextField may be exposed as a text view on some OS versions.
        let field = title.exists ? title : app.textViews["noteTitle"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let uniqueTitle = "Saved note \(UUID().uuidString.prefix(6))"
        field.typeText(uniqueTitle)
        let notes = app.textViews["personalNotes"].firstMatch
        notes.tap()
        notes.typeText("Keep this personal note after relaunch.")
        app.terminate()
        app.launch()
        let saved = app.staticTexts[uniqueTitle].firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        saved.tap()
        XCTAssertTrue(app.textViews["personalNotes"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textViews["personalNotes"].value as? String,
                       "Keep this personal note after relaunch.")
        app.buttons["Ink"].tap()
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Native note and Pencil canvas"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
