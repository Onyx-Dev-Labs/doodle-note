import XCTest

@testable import dictation_helper

/// Exercise the real request route with a deterministic stand-in for AX and
/// insertion. Low-level focus/security checks still run in Delivery.deliver in
/// production; this verifies which destination reaches them and is watched.
final class DeliveryRequestTests: XCTestCase {
    private struct Field: Equatable {
        let app: Int
        let name: String
        var secure = false
        var editable = true
        var accessible = true
    }

    private final class Harness {
        var stored: Field?
        var current: Field?
        var captures = 0
        var consumes = 0
        var attempts: [Field] = []
        var writes: [Field] = []
        var watched: [Field] = []
        var forcedOutcome: DeliveryOutcome?

        init(original: Field?, current: Field?) {
            stored = original
            self.current = current
        }

        func run(
            useCurrentFocus: Bool = true, guards: DeliveryGuards = DeliveryGuards(),
            text: String = "Synthetic transcript", watch: Bool = true
        ) -> DeliveryResult {
            let request = DeliveryRequest(
                text: text, guards: guards, useCurrentFocus: useCurrentFocus, watch: watch)
            return request.run(
                original: stored,
                captureCurrent: { self.captures += 1; return self.current },
                consume: { self.consumes += 1; self.stored = nil },
                insert: { target, _, _ in
                    self.attempts.append(target)
                    guard target.accessible else {
                        return DeliveryResult(outcome: .refused, reason: "accessibility-denied")
                    }
                    guard target == self.current else {
                        return DeliveryResult(outcome: .refused, reason: "focus-changed")
                    }
                    guard !target.secure else {
                        return DeliveryResult(outcome: .refused, reason: "secure-field")
                    }
                    guard target.editable else {
                        return DeliveryResult(outcome: .refused, reason: "not-editable")
                    }
                    self.writes.append(target)
                    return DeliveryResult(outcome: self.forcedOutcome ?? .delivered)
                },
                didDeliver: { self.watched.append($0) })
        }
    }

    func testOrdinaryDictationUsesCurrentFieldAndWatchesItAfterAppOrFieldSwitch() {
        let original = Field(app: 10, name: "old chat")
        for current in [Field(app: 10, name: "new chat"), Field(app: 20, name: "other app")] {
            let h = Harness(original: original, current: current)
            XCTAssertEqual(h.run().outcome, .delivered)
            XCTAssertEqual(h.captures, 1)
            XCTAssertEqual(h.writes, [current])
            XCTAssertEqual(h.watched, [current])
            XCTAssertEqual(h.consumes, 1)
            XCTAssertNil(h.stored)
        }
    }

    func testOldSecureFieldDoesNotBlockAnOrdinaryCurrentDestination() {
        let current = Field(app: 20, name: "chat")
        let h = Harness(original: Field(app: 10, name: "password", secure: true), current: current)
        XCTAssertEqual(h.run().outcome, .delivered)
        XCTAssertEqual(h.writes, [current])
    }

    func testCurrentSecureOrNoneditableFieldAndMissingPermissionRemainRefused() {
        let original = Field(app: 10, name: "old chat")
        let cases: [(Field, String)] = [
            (Field(app: 20, name: "password", secure: true), "secure-field"),
            (Field(app: 20, name: "button", editable: false), "not-editable"),
            (Field(app: 20, name: "chat", accessible: false), "accessibility-denied")
        ]
        for (current, reason) in cases {
            let h = Harness(original: original, current: current)
            XCTAssertEqual(h.run().reason, reason)
            XCTAssertEqual(h.attempts, [current], "only the fresh target reaches validation")
            XCTAssertTrue(h.writes.isEmpty)
            XCTAssertTrue(h.watched.isEmpty)
            XCTAssertEqual(h.consumes, 1)
        }
    }

    func testSelectionRewritesAndUndoCannotRetargetEvenWithTheFlag() {
        let original = Field(app: 10, name: "old chat")
        let current = Field(app: 20, name: "new chat")
        for guards in [DeliveryGuards(expectSelection: "old"), DeliveryGuards(replace: "old"),
            DeliveryGuards(expectSelection: ""), DeliveryGuards(replace: "")]
        {
            let h = Harness(original: original, current: current)
            XCTAssertEqual(h.run(guards: guards).reason, "focus-changed")
            XCTAssertEqual(h.captures, 0)
            XCTAssertEqual(h.attempts, [original])
            XCTAssertTrue(h.writes.isEmpty)
        }
    }

    func testRequestsWithoutTheFlagRetainOriginalTargetSemantics() {
        let original = Field(app: 10, name: "old chat")
        let h = Harness(original: original, current: Field(app: 20, name: "new chat"))
        XCTAssertEqual(h.run(useCurrentFocus: false).reason, "focus-changed")
        XCTAssertEqual(h.captures, 0)
        XCTAssertEqual(h.attempts, [original])
    }

    func testMissingCurrentTargetDoesNotFallBackToTheRecordingDestination() {
        let h = Harness(original: Field(app: 10, name: "old chat"), current: nil)
        XCTAssertEqual(h.run().reason, "no-target")
        XCTAssertTrue(h.attempts.isEmpty)
        XCTAssertEqual(h.consumes, 1)
    }

    func testAConsumedSnapshotCannotBeUsedToInsertAgain() {
        let field = Field(app: 10, name: "chat")
        let h = Harness(original: field, current: field)
        XCTAssertEqual(h.run().outcome, .delivered)
        XCTAssertEqual(h.run().reason, "no-target")
        XCTAssertEqual(h.captures, 1)
        XCTAssertEqual(h.writes, [field])
        XCTAssertEqual(h.consumes, 1)
    }

    func testUncertainInsertionIsNotRetriedOrWatched() {
        let field = Field(app: 10, name: "chat")
        let h = Harness(original: field, current: field)
        h.forcedOutcome = .uncertain
        XCTAssertEqual(h.run().outcome, .uncertain)
        XCTAssertEqual(h.attempts, [field])
        XCTAssertEqual(h.captures, 1)
        XCTAssertTrue(h.watched.isEmpty)
        XCTAssertEqual(h.consumes, 1)
    }

    func testEmptyRequestDoesNotConsumeTheSnapshotOrCaptureFocus() {
        let field = Field(app: 10, name: "chat")
        let h = Harness(original: field, current: field)
        XCTAssertEqual(h.run(text: "").reason, "empty-text")
        XCTAssertEqual(h.stored, field)
        XCTAssertEqual(h.captures, 0)
        XCTAssertEqual(h.consumes, 0)
        XCTAssertTrue(h.attempts.isEmpty)
    }

    func testWatchOptOutAndGuardForwarding() {
        let field = Field(app: 10, name: "chat")
        let h = Harness(original: field, current: field)
        XCTAssertEqual(h.run(watch: false).outcome, .delivered)
        XCTAssertTrue(h.watched.isEmpty)
        let guards = DeliveryGuards(expectSelection: "before")
        let request = DeliveryRequest(text: "after", guards: guards, useCurrentFocus: true, watch: false)
        let result = request.run(original: field, captureCurrent: { nil }, consume: {},
            insert: { target, text, received in
                XCTAssertEqual(target, field)
                XCTAssertEqual(text, "after")
                XCTAssertEqual(received.expectSelection, "before")
                return DeliveryResult(outcome: .delivered)
            }, didDeliver: { _ in XCTFail("watch was not requested") })
        XCTAssertEqual(result.outcome, .delivered)
    }
}
