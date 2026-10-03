import XCTest

@MainActor final class ModelSetupUITests: XCTestCase {
    func testFirstRunCanCreateNotesWithoutAccountOrDownloads() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--first-run-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["finishSetup"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Your notes, on your device"].exists)
        app.buttons["finishSetup"].tap()
        let create = app.buttons["newNote"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 10))
        app.textViews.firstMatch.tap()
        app.textViews.firstMatch.typeText("A plain note needs no model or account.")
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertFalse(app.buttons["finishSetup"].exists)
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
    }
}
