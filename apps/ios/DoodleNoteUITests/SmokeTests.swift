import XCTest

/// Smoke tests for the core loops. Run on the simulator where speech assets
/// may be unavailable, so the recording test accepts either the recording
/// banner or the failure banner — the assertion is that the flow never hangs
/// or crashes.
final class SmokeTests: XCTestCase {
    @MainActor
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // Skip onboarding and notification-permission prompts for the test.
        app.launchArguments += ["-hasOnboarded", "YES", "-meetingNotifications", "NO"]
        app.launch()
        return app
    }

    /// Launch → + → Record meeting → recording starts (or fails gracefully)
    /// → stop → notes editor is present.
    @MainActor
    func testNewMeetingFlow() throws {
        let app = launch()

        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        app.buttons["New"].tap()
        XCTAssertTrue(app.buttons["Record meeting"].waitForExistence(timeout: 5))
        app.buttons["Record meeting"].tap()

        // Meeting view: the Notes/Transcript switcher must appear.
        XCTAssertTrue(app.buttons["Notes"].waitForExistence(timeout: 10))

        // Recording either reaches the Stop button or surfaces an error;
        // give asset download a generous window.
        let stop = app.buttons["Stop"]
        if stop.waitForExistence(timeout: 60) {
            stop.tap()
            XCTAssertTrue(stop.waitForNonExistence(timeout: 30))
        }

        // Notes tab content is reachable either way.
        app.buttons["Notes"].tap()
        XCTAssertTrue(app.staticTexts["Your rough notes"].waitForExistence(timeout: 5))
    }

    /// Launch → + → New note → the plain editor appears with no recording
    /// chrome, and typed text persists into the field.
    @MainActor
    func testQuickNoteFlow() throws {
        let app = launch()

        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        app.buttons["New"].tap()
        XCTAssertTrue(app.buttons["New note"].waitForExistence(timeout: 5))
        app.buttons["New note"].tap()

        // Note view: editor label present, no recording UI, no tab switcher.
        XCTAssertTrue(app.staticTexts["Your note"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Stop"].exists)
        XCTAssertFalse(app.buttons["Transcript"].exists)

        let editor = app.textFields["Write anything…"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("Buy sage green paint")
        XCTAssertTrue(app.textFields.containing(
            NSPredicate(format: "value CONTAINS %@", "Buy sage green paint")
        ).firstMatch.exists)
    }
}
