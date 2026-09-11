import XCTest

@MainActor final class SpeakerIdentityUITests: XCTestCase {
    func testConfirmRememberSelectAndRemoveSavedVoice() {
        let app = XCUIApplication()
        let fixture = UUID().uuidString
        app.launchArguments = ["--ui-testing", "--speaker-identity-fixture", "--fixture-id=\(fixture)"]
        app.launch()
        let newNote = app.buttons["newNote"]
        let ready = NSPredicate { _, _ in newNote.exists && newNote.isEnabled && newNote.isHittable }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 10), .completed)
        newNote.tap()
        let speakers = app.buttons["speakerSettings"]
        XCTAssertTrue(speakers.waitForExistence(timeout: 5)); speakers.tap()
        XCTAssertTrue(app.staticTexts["No saved voices yet."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Voice profiles stay on this device. They are not synced or backed up."].exists)
        let field = app.textFields.matching(NSPredicate(format: "identifier BEGINSWITH %@", "speakerName-")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Alex")
        app.buttons["rememberVoice"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["This voice is remembered on this device only."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["Alex"].waitForExistence(timeout: 5))
        let remove = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "removeVoice-")).firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5)); remove.tap()
        XCTAssertTrue(app.buttons["Remove voice from this device"].waitForExistence(timeout: 5))
        app.buttons["Remove voice from this device"].tap()
        XCTAssertTrue(app.staticTexts["No saved voices yet."].waitForExistence(timeout: 5))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Remembered voice can be removed without changing notes"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
