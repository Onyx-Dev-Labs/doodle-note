import ApplicationServices
import XCTest

@testable import dictation_helper

final class FieldWatchTests: XCTestCase {
    private let element = AXUIElementCreateSystemWide()

    func testAWatchIsFoundByItsIdUntilItExpires() {
        let watches = FieldWatches()
        let now = Date()
        watches.start(id: "a", pid: 1, element: element, now: now)
        XCTAssertNotNil(watches.get("a", now: now.addingTimeInterval(10)))
        XCTAssertNil(watches.get("b", now: now), "another id")
        XCTAssertNil(
            watches.get("a", now: now.addingTimeInterval(FieldWatches.lifetime + 1)), "expired")
    }

    func testOnlyOneFieldIsWatchedAtATime() {
        let watches = FieldWatches()
        watches.start(id: "first", pid: 1, element: element)
        watches.start(id: "second", pid: 1, element: element)
        XCTAssertNil(watches.get("first"))
        XCTAssertNotNil(watches.get("second"))
    }

    func testStopOnlyDropsTheNamedWatch() {
        let watches = FieldWatches()
        watches.start(id: "keep", pid: 1, element: element)
        watches.stop("other")
        XCTAssertNotNil(watches.get("keep"))
        watches.stop("keep")
        XCTAssertNil(watches.get("keep"))
    }
}
