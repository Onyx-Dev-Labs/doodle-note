import XCTest

@MainActor final class PencilEditingUITests: XCTestCase {
    func testNonemptyInkToolsUndoReopenAndAdaptiveNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ink-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        let title = app.textFields["noteTitle"].exists ? app.textFields["noteTitle"] : app.textViews["noteTitle"]
        let unique = "Pencil \(UUID().uuidString.prefix(6))"
        title.tap(); title.typeText(unique)
        let notes = app.textViews["personalNotes"]
        notes.tap(); notes.typeText("Ideas and sketches stay alongside the meeting transcript.")
        app.buttons["Done typing"].tap()
        app.buttons["Ink"].tap()
        app.buttons["drawingTools"].tap()
        app.buttons["addSampleInk"].tap()
        XCTAssertTrue(app.buttons["undoInk"].isEnabled)
        app.buttons["undoInk"].tap()
        XCTAssertTrue(app.buttons["redoInk"].isEnabled)
        app.buttons["redoInk"].tap()
        app.buttons["inkZoom"].tap()
        app.buttons["Fit page"].tap()
        XCTAssertTrue(app.buttons["recordButton"].isHittable)
        let canvas = app.descendants(matching: .any).matching(identifier: "inkCanvas").firstMatch
        XCTAssertTrue(canvas.exists)
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.45))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertEqual(canvas.value as? String, "4 strokes")
        app.buttons["undoInk"].tap()
        XCTAssertEqual(canvas.value as? String, "3 strokes")
        app.buttons["redoInk"].tap()
        XCTAssertEqual(canvas.value as? String, "4 strokes")
        app.typeKey("1", modifierFlags: .command)
        XCTAssertTrue(app.textViews["personalNotes"].waitForExistence(timeout: 5))
        app.typeKey("2", modifierFlags: .command)
        XCTAssertTrue(app.buttons["drawingTools"].waitForExistence(timeout: 5))
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Nonempty editable ink and accessible recording controls"
        image.lifetime = .keepAlways; add(image)
        XCUIDevice.shared.orientation = .landscapeLeft
        let rotated = NSPredicate { _, _ in app.frame.width > app.frame.height }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: rotated, object: nil)], timeout: 8), .completed)
        app.buttons["inkZoom"].tap(); app.buttons["Fit page"].tap()
        XCTAssertTrue(app.buttons["drawingTools"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["recordButton"].isHittable)
        let landscape = XCTAttachment(screenshot: app.screenshot())
        landscape.name = "Adaptive landscape drawing layout"
        landscape.lifetime = .keepAlways; add(landscape)
        XCUIDevice.shared.orientation = .portrait
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts[unique].firstMatch.waitForExistence(timeout: 10))
        app.staticTexts[unique].firstMatch.tap()
        XCTAssertEqual(app.textViews["personalNotes"].value as? String, "Ideas and sketches stay alongside the meeting transcript.")
        app.buttons["Ink"].tap()
        XCTAssertTrue(app.buttons["drawingTools"].waitForExistence(timeout: 5))
        app.buttons["inkZoom"].tap(); app.buttons["Fit page"].tap()
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "inkCanvas").firstMatch.value as? String, "4 strokes")
        let reopened = XCTAttachment(screenshot: app.screenshot())
        reopened.name = "Persisted nonempty drawing after relaunch"
        reopened.lifetime = .keepAlways; add(reopened)
        app.buttons["Notes"].tap()
        XCTAssertTrue(app.textViews["personalNotes"].exists)
    }
    func testAccessibilityTextSizeKeepsToolsAndRecordingReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--ink-fixture", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["newNote"].waitForExistence(timeout: 10))
        app.buttons["newNote"].tap()
        XCTAssertTrue(app.buttons["recordButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["recordButton"].isHittable)
        app.buttons["Ink"].tap()
        XCTAssertTrue(app.buttons["drawingTools"].isHittable)
        XCTAssertFalse(app.buttons["drawingTools"].label.isEmpty)
        app.buttons["drawingTools"].tap()
        app.buttons["addSampleInk"].tap()
        XCTAssertTrue(app.buttons["recordButton"].isHittable)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "Accessibility text size with drawing controls"
        image.lifetime = .keepAlways; add(image)
    }

}
