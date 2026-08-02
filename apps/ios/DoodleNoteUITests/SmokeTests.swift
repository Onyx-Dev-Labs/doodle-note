import XCTest

/// Smoke tests for the core loops. Speech assets are not deterministic in the
/// simulator, so the recording test injects a known failure and verifies the
/// recovery UI instead of silently accepting a timeout.
final class SmokeTests: XCTestCase {
    @MainActor
    private func launch(recordingMode: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        // Use an in-memory store and skip onboarding for deterministic tests.
        app.launchArguments += ["-uiTesting", "YES", "-hasOnboarded", "YES", "-meetingNotifications", "NO"]
        if let recordingMode {
            app.launchEnvironment["UITEST_RECORDING_MODE"] = recordingMode
        }
        app.launch()
        return app
    }

    /// Launch → + → Record meeting → visible failure/retry path → back without
    /// leaving an empty draft behind.
    @MainActor
    func testNewMeetingFlow() throws {
        let app = launch(recordingMode: "failure")

        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        app.buttons["New"].tap()
        XCTAssertTrue(app.buttons["Record meeting"].waitForExistence(timeout: 5))
        app.buttons["Record meeting"].tap()

        // Meeting view: the Notes/Transcript switcher must appear.
        XCTAssertTrue(app.buttons["Notes"].waitForExistence(timeout: 10))

        // Simulator/device failures must be visible and recoverable. Never let
        // this test fall through when neither Stop nor a failure state exists.
        XCTAssertTrue(app.buttons["Retry recording"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Recording unavailable"].exists)
        XCTAssertTrue(app.buttons["Open Settings"].exists)

        // Leaving a failed, untouched recording must not litter Home.
        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["Untitled meeting"].waitForNonExistence(timeout: 5))
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

        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["Untitled note"].waitForExistence(timeout: 5))
    }

    /// Launch → + → New note → back without typing → no empty list item.
    @MainActor
    func testEmptyQuickNoteIsDiscarded() throws {
        let app = launch()

        XCTAssertTrue(app.buttons["New"].waitForExistence(timeout: 10))
        app.buttons["New"].tap()
        XCTAssertTrue(app.buttons["New note"].waitForExistence(timeout: 5))
        app.buttons["New note"].tap()
        XCTAssertTrue(app.staticTexts["Your note"].waitForExistence(timeout: 10))

        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["Untitled note"].waitForNonExistence(timeout: 5))
    }

    /// The unfinished phone-call recorder must not be discoverable in the MVP.
    @MainActor
    func testPhoneCallsAreHiddenForMVP() throws {
        let app = launch()

        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Phone calls"].exists)

        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Caller ID"].exists)
    }
}
