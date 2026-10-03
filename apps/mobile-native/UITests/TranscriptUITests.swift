import XCTest

@MainActor final class TranscriptUITests: XCTestCase {
    func testCloudCorrectionHistoryCanBeReviewedWithoutClaimingCompletion() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--transcript-fixture", "--transcript-cloud-review", "--transcript-title=Review " + UUID().uuidString]
        app.launch()
        let newNote = app.buttons["newNote"]
        let ready = NSPredicate { _, _ in newNote.exists && newNote.isEnabled && newNote.isHittable }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 10), .completed)
        newNote.tap()
        let tab = app.buttons["Transcript"].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 5)); tab.tap()
        let show = app.buttons["Show original corrections"]
        XCTAssertTrue(show.waitForExistence(timeout: 5)); show.tap()
        XCTAssertTrue(app.staticTexts["Synthetic transcript draft"].waitForExistence(timeout: 5))
        let acknowledge = app.buttons["Acknowledge transcript review"]
        let enabled = NSPredicate { _, _ in acknowledge.isEnabled && acknowledge.isHittable }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: enabled, object: nil)], timeout: 5), .completed)
        acknowledge.tap()
        XCTAssertTrue(app.staticTexts["Transcript may be incomplete"].exists)
        XCTAssertFalse(show.exists)
        XCTAssertFalse(app.staticTexts["User correction"].exists)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Cloud review acknowledgement retains incomplete status"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testCorrectionPersistsAfterReopen() {
        let app = XCUIApplication()
        let title = "Transcript " + UUID().uuidString
        app.launchArguments = ["--ui-testing", "--transcript-fixture", "--transcript-title=" + title]
        app.launch()
        let newNote = app.buttons["newNote"]
        let ready = NSPredicate { _, _ in newNote.exists && newNote.isEnabled && newNote.isHittable }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 10), .completed)
        newNote.tap()
        let tab = app.buttons["Transcript"].firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 5)); tab.tap()
        let edit = app.buttons["Correct transcript"].firstMatch
        XCTAssertTrue(edit.waitForExistence(timeout: 5)); edit.tap()
        let text = app.textViews["transcriptCorrection"]
        XCTAssertTrue(text.waitForExistence(timeout: 5)); text.tap(); text.typeText(" Reviewed correction.")
        app.buttons["Save correction"].tap()
        XCTAssertTrue(app.staticTexts["User correction"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts[title].firstMatch.waitForExistence(timeout: 10)); app.staticTexts[title].firstMatch.tap()
        XCTAssertTrue(tab.waitForExistence(timeout: 5)); tab.tap()
        XCTAssertTrue(app.staticTexts["User correction"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Reviewed correction.")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Transcript may be incomplete"].exists)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Synthetic corrected transcript retained after reopen"; screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
