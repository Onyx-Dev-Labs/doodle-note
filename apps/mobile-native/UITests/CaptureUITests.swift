import XCTest

@MainActor final class CaptureUITests: XCTestCase {
    private func create(_ app: XCUIApplication) -> String {
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let name = "Capture \(UUID().uuidString.prefix(6))"
        let title = app.textFields["noteTitle"].exists ? app.textFields["noteTitle"] : app.textViews["noteTitle"]
        title.tap(); title.typeText(name)
        XCTAssertTrue(app.buttons["doneTyping"].waitForExistence(timeout: 5))
        app.buttons["doneTyping"].tap()
        return name
    }

    func testCancelPreparationThenSaveSyntheticCaptureAndReopen() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--capture-fixture"]
        let name = create(app)
        if !app.buttons["cancelRecordingPreparation"].exists { app.buttons["recordButton"].tap() }
        XCTAssertTrue(app.buttons["cancelRecordingPreparation"].waitForExistence(timeout: 5))
        app.buttons["cancelRecordingPreparation"].tap()
        let ready = NSPredicate { _, _ in app.buttons["recordButton"].isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 10), .completed)
        XCTAssertEqual(app.buttons["recordButton"].label, "Record")
        app.buttons["recordButton"].tap()
        let started = NSPredicate { _, _ in app.buttons["recordButton"].label == "Stop recording" && app.buttons["recordButton"].isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: started, object: nil)], timeout: 10), .completed)
        app.buttons["recordButton"].tap()
        XCTAssertTrue(app.buttons["Play recording"].waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts[name].firstMatch.waitForExistence(timeout: 10))
        app.staticTexts[name].firstMatch.tap()
        XCTAssertTrue(app.buttons["Play recording"].waitForExistence(timeout: 5))
    }

    func testSyntheticInterruptionExposesDeliberateResume() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--capture-fixture", "--capture-interruption-fixture"]
        _ = create(app)
        if !app.buttons["cancelRecordingPreparation"].exists { app.buttons["recordButton"].tap() }
        let resumed = NSPredicate { _, _ in app.buttons["recordButton"].label == "Resume" && app.buttons["recordButton"].isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: resumed, object: nil)], timeout: 12), .completed)
        XCTAssertTrue(app.buttons["Play recording"].exists)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "Interrupted synthetic capture with explicit Resume"
        image.lifetime = .keepAlways
        add(image)
    }
}
