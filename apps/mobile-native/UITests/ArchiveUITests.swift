import XCTest

@MainActor final class ArchiveUITests: XCTestCase {
    func testBackupRequiresMatchingPasswordAndShowsLocalRestoreBoundary() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--fixture-id=\(UUID().uuidString)"]
        app.launch()
        XCTAssertTrue(app.buttons["libraryOptions"].waitForExistence(timeout: 15))
        app.buttons["libraryOptions"].tap()
        app.buttons["Storage & Trash"].tap()
        XCTAssertTrue(app.buttons["archiveSettings"].waitForExistence(timeout: 10))
        app.buttons["archiveSettings"].tap()
        let export = app.buttons["archiveExport"]
        XCTAssertTrue(export.waitForExistence(timeout: 10))
        XCTAssertFalse(export.isEnabled)
        let password = app.secureTextFields["archivePassword"]
        password.tap(); password.typeText("Synthetic backup password")
        XCTAssertFalse(export.isEnabled)
        let confirmation = app.secureTextFields["archiveConfirmation"]
        confirmation.tap(); confirmation.typeText("Synthetic backup password")
        XCTAssertTrue(export.isEnabled)
        XCTAssertTrue(app.buttons["archiveImport"].isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Encrypted backup password validation"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
