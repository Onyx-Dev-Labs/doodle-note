import XCTest

@MainActor final class CalendarExperienceUITests: XCTestCase {
    func testCombinedUpcomingMeetingNoteAndDeniedReminders() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--calendar-fixture", "--fixture-id=\(UUID().uuidString)"]
        app.launch()
        let google = app.buttons.matching(identifier: "calendarEvent").containing(.staticText, identifier: "Google planning fixture").firstMatch
        XCTAssertTrue(google.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Microsoft planning fixture"].exists)
        google.tap()
        XCTAssertTrue(app.buttons["Join meeting"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Jordan (fixture)"].exists)
        XCTAssertTrue(app.staticTexts["Calendar invitees are suggestions, not identified voices. Confirm speaker names yourself."].exists)
        app.buttons["openMeetingNote"].tap()
        XCTAssertTrue(app.textViews["personalNotes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["recordButton"].exists)
        XCTAssertFalse(app.buttons["Stop recording"].exists)
        if !app.buttons["libraryOptions"].isHittable { app.navigationBars.buttons.firstMatch.tap() }
        func openCalendars() {
            if !app.buttons["calendarSettings"].exists { app.buttons["libraryOptions"].tap() }
            XCTAssertTrue(app.buttons["calendarSettings"].waitForExistence(timeout: 5))
            app.buttons["calendarSettings"].tap()
        }
        openCalendars()
        let settingsScreen = app.navigationBars["Calendars"]
        // Hosted CI received an Apple Intelligence banner over the menu tap, opening Settings.
        // Recover only that observed external interruption, never retry an unexplained app failure.
        if !settingsScreen.waitForExistence(timeout: 5),
           XCUIApplication(bundleIdentifier: "com.apple.Preferences").state == .runningForeground {
            app.activate()
            openCalendars()
        }
        guard settingsScreen.waitForExistence(timeout: 5) else {
            XCTFail("Calendar settings did not open")
            return
        }
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 5))
        let reminders = app.switches["calendarReminders"]
        for _ in 0..<4 where !reminders.exists || !reminders.isHittable { app.swipeUp() }
        XCTAssertTrue(reminders.waitForExistence(timeout: 5))
        reminders.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Notifications are disabled. Allow them in system Settings to receive reminders."].waitForExistence(timeout: 5))
        XCTAssertEqual(reminders.value as? String, "0")
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Calendar settings and denied permission"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
