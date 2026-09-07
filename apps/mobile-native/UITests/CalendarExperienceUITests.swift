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
        if !app.buttons["calendarSettings"].isHittable { app.navigationBars.buttons.firstMatch.tap() }
        app.buttons["calendarSettings"].tap()
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
