import XCTest

/// Smoke test for the core loop: launch → new meeting → recording starts (or
/// fails gracefully) → stop → notes editor is present. Runs on the simulator
/// where speech assets may be unavailable, so it accepts either the recording
/// banner or the failure banner — the assertion is that the flow never hangs
/// or crashes.
final class SmokeTests: XCTestCase {
    @MainActor
    func testNewMeetingFlow() throws {
        let app = XCUIApplication()
        // Skip onboarding and notification-permission prompts for the test.
        app.launchArguments += ["-hasOnboarded", "YES", "-meetingNotifications", "NO"]
        app.launch()

        XCTAssertTrue(app.buttons["New meeting"].waitForExistence(timeout: 10))
        app.buttons["New meeting"].tap()

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
}
