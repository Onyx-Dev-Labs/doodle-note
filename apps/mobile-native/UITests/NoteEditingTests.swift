import XCTest

@MainActor final class NoteEditingTests: XCTestCase {
    func testTrashRestoreAndAudioConfirmationPreservePersonalNotes() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--storage-fixture", "--fixture-id=\(UUID().uuidString)"]
        app.launch()
        let fixture = app.staticTexts["Storage fixture"].firstMatch
        XCTAssertTrue(fixture.waitForExistence(timeout: 10))
        fixture.tap()
        XCTAssertTrue(app.buttons["Play recording"].waitForExistence(timeout: 5))
        app.buttons["Note storage"].tap()
        app.buttons["Remove local audio"].tap()
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Play recording"].exists)
        app.buttons["Note storage"].tap()
        app.buttons["Remove local audio"].tap()
        app.buttons["Remove audio"].tap()
        XCTAssertTrue(app.textViews["personalNotes"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textViews["personalNotes"].value as? String, "Synthetic personal notes retained after audio removal.")
        XCTAssertFalse(app.buttons["Play recording"].exists)
        app.buttons["Note storage"].tap()
        app.buttons["Move to Trash"].tap()
        if !app.buttons["libraryOptions"].exists { app.navigationBars.buttons.firstMatch.tap() }
        app.buttons["libraryOptions"].tap()
        XCTAssertTrue(app.buttons["Storage & Trash"].waitForExistence(timeout: 5))
        app.buttons["Storage & Trash"].tap()
        let restore = app.buttons["restore-Storage fixture"].firstMatch
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Local storage and recoverable Trash"
        attachment.lifetime = .keepAlways
        add(attachment)
        app.buttons["Delete permanently"].firstMatch.tap()
        app.buttons["Cancel"].tap()
        XCTAssertTrue(restore.exists)
        restore.tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Storage fixture"].firstMatch.waitForExistence(timeout: 5))
    }

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
    func testFolderAndSummaryEmptyStatePreservePersonalNote() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        app.buttons["libraryOptions"].tap()
        XCTAssertTrue(app.buttons["New folder"].waitForExistence(timeout: 10))
        app.buttons["New folder"].tap()
        let name = "Folder \(UUID().uuidString.prefix(6))"
        app.alerts.textFields.firstMatch.typeText(name)
        app.alerts.buttons["Create"].tap()
        app.buttons["newNote"].tap()
        app.buttons["Note details"].tap()
        XCTAssertTrue(app.buttons["noteFolder"].waitForExistence(timeout: 5))
        app.buttons["noteFolder"].tap()
        app.buttons[name].firstMatch.tap()
        XCTAssertTrue(app.buttons["noteFolder"].label.contains(name))
        app.buttons["Summary"].tap()
        XCTAssertTrue(app.staticTexts["Summary versions"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Generated summaries will appear here. Your personal notes remain separate."].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Folder and independent summary pane"
        attachment.lifetime = .keepAlways
        add(attachment)
        app.buttons["Notes"].tap()
        XCTAssertTrue(app.textViews["personalNotes"].exists)
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
