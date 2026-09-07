import XCTest

@MainActor final class NoteSearchUITests: XCTestCase {
    func testLargeSyntheticLibraryCountsAndOldestSource() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--search-fixture", "--fixture-id=" + UUID().uuidString]
        app.launch()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 20))
        search.tap(); search.typeText("archive")
        XCTAssertTrue(app.staticTexts["500 notes · 500 sources"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Showing the first 100 sources. The counts include every matching saved note."].exists)
        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + "oldestneedle")
        XCTAssertTrue(app.staticTexts["1 note · 1 source"].waitForExistence(timeout: 10))
        app.buttons["searchHit"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["archive oldestneedle original decision"].waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Synthetic oldest source from 500 saved notes"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSearchFindsSavedTypedSourceAndOpensOriginal() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let body = app.textViews.firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        body.tap()
        let query = "archive" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let text = "The original decision is " + query
        body.typeText(text)
        app.terminate()
        app.launch()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap(); search.typeText(query)
        let hit = app.buttons["searchHit"].firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 10))
        hit.tap()
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Open note"].exists)
        app.buttons["Open note"].tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(app.textViews.firstMatch.value as? String, text)
    }
}
