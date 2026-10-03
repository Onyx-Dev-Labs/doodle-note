import XCTest

@MainActor final class CloudSettingsUITests: XCTestCase {
    func testOptionalCloudSettingsPreserveIndependentLocalNotes() {
        for (language, menu, title, connect, done) in [
            ("en-US", "Cloud sync", "Optional cloud sync", "Connect account", "Done"),
            ("de-DE", "Cloud-Synchronisierung", "Optionale Cloud-Synchronisierung", "Konto verbinden", "Fertig")
        ] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--localization-fixture", "--app-language=\(language)", "--fixture-id=\(UUID().uuidString)"]
            app.launch()
            XCTAssertTrue(app.buttons["libraryOptions"].waitForExistence(timeout: 10))
            app.buttons["libraryOptions"].tap()
            app.buttons[menu].tap()
            XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5))
            XCTAssertEqual(app.buttons["connectCloudAccount"].label, connect)
            XCTAssertTrue(app.staticTexts["cloudSyncStatus"].exists)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Optional cloud settings \(language)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            app.buttons[done].tap()
            app.buttons["newNote"].tap()
            XCTAssertTrue(app.textViews["personalNotes"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["recordButton"].exists)
            app.terminate()
        }
    }
}
