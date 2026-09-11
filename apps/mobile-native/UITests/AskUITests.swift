import XCTest
@MainActor final class AskUITests: XCTestCase {
    func testMeetingQuestionOpensOriginalEvidenceAndUnavailableIsHonest() {
        for unavailable in [false, true] {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--ask-fixture"] + (unavailable ? ["--ask-unavailable"] : [])
            app.launch()
            XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10)); app.buttons["newNote"].tap()
            let body = app.textViews["personalNotes"]; XCTAssertTrue(body.waitForExistence(timeout: 5))
            body.tap(); body.typeText("The launch review is on Friday."); app.buttons["doneTyping"].tap()
            app.buttons["Editor navigation"].tap(); app.buttons["askMeeting"].tap()
            let question = app.textFields["askQuestion"].exists ? app.textFields["askQuestion"] : app.textViews["askQuestion"]
            XCTAssertTrue(question.waitForExistence(timeout: 5)); question.tap(); question.typeText("When is the review?")
            app.buttons["askDoneTyping"].tap()
            app.buttons["askSubmit"].tap()
            if unavailable {
                XCTAssertTrue(app.staticTexts["askProblem"].waitForExistence(timeout: 10))
                XCTAssertFalse(app.buttons["askCitation"].exists)
            } else {
                let citation = app.buttons["askCitation"].firstMatch
                for _ in 0..<5 where !citation.isHittable { app.swipeUp() }
                XCTAssertTrue(citation.waitForExistence(timeout: 10)); citation.tap()
                XCTAssertTrue(app.staticTexts["The launch review is on Friday."].waitForExistence(timeout: 5))
                let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); image.name = "Ask original source fixture"; image.lifetime = .keepAlways; add(image)
            }
            app.terminate()
        }
    }
}
