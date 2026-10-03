import XCTest

@MainActor final class CaptureUITests: XCTestCase {
    private func create(_ app: XCUIApplication) -> String {
        app.launch()
        let newNote = app.buttons["newNote"]
        let ready = NSPredicate { _, _ in newNote.exists && newNote.isEnabled && newNote.isHittable }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 10), .completed)
        newNote.tap()
        let name = "Capture \(UUID().uuidString.prefix(6))"
        let title = app.descendants(matching: .any).matching(identifier: "noteTitle").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        // Hosted XCTest can report hasKeyboardFocus=false while the keyboard is visible
        // and typing succeeds. Use the app's FocusState-driven control, then verify input.
        let done = app.buttons["doneTyping"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        title.typeText(name)
        let renamed = NSPredicate(format: "value == %@", name)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: renamed, object: title)], timeout: 5), .completed)
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
        XCTAssertTrue(app.buttons["allowFixtureCapture"].waitForExistence(timeout: 5))
        app.buttons["allowFixtureCapture"].tap()
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
        XCTAssertTrue(app.buttons["allowFixtureCapture"].waitForExistence(timeout: 5))
        app.buttons["allowFixtureCapture"].tap()
        let resumed = NSPredicate { _, _ in app.buttons["recordButton"].label == "Resume" && app.buttons["recordButton"].isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: resumed, object: nil)], timeout: 12), .completed)
        XCTAssertTrue(app.buttons["Play recording"].exists)
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "Interrupted synthetic capture with explicit Resume"
        image.lifetime = .keepAlways
        add(image)
    }
}
