import XCTest

@MainActor final class NoteExportUITests: XCTestCase {
    func testExportEmptyStateAndCanceledSharePreservePersonalNotes() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--fixture-id=" + UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        app.buttons["Note storage"].tap()
        app.buttons["shareNote"].tap()
        app.buttons["prepareExport"].tap()
        XCTAssertTrue(app.staticTexts["Choose at least one nonempty section to export."].waitForExistence(timeout: 5))
        app.buttons["Close"].tap()
        let notes = app.textViews["personalNotes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        notes.tap(); notes.typeText("A complete synthetic note to share and keep.")
        app.buttons["doneTyping"].tap()
        app.buttons["Note storage"].tap()
        app.buttons["shareNote"].tap()
        let selection = XCTAttachment(screenshot: app.screenshot()); selection.name = "Export format and content selection"; selection.lifetime = .keepAlways; add(selection)
        app.buttons["prepareExport"].tap()
        XCTAssertTrue(app.buttons["Copy"].waitForExistence(timeout: 15))
        let share = XCTAttachment(screenshot: app.screenshot()); share.name = "Native PDF share sheet"; share.lifetime = .keepAlways; add(share)
        // The system share sheet's Close button dismisses only the share operation.
        app.buttons["Close"].firstMatch.tap()
        XCTAssertTrue(app.buttons["prepareExport"].waitForExistence(timeout: 5))
        app.buttons["Close"].tap()
        XCTAssertTrue(notes.waitForExistence(timeout: 5))
        XCTAssertEqual(notes.value as? String, "A complete synthetic note to share and keep.")
    }
}
