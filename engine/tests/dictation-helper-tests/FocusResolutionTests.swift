import XCTest

@testable import dictation_helper

final class FocusResolutionTests: XCTestCase {
    func testGenericSystemFocusFallsBackToTheAppsFocusedEditor() {
        let result = FocusResolution.preferred(
            system: ElementFacts(role: "AXGroup"),
            app: { ElementFacts(role: "AXTextArea", editable: true) }, facts: { $0 })
        XCTAssertEqual(result?.role, "AXTextArea")
    }

    func testDefiniteSystemControlDoesNotAdoptADifferentAppLevelEditor() {
        for facts in [
            ElementFacts(role: "AXTextField", secure: true, editable: true),
            ElementFacts(role: "AXButton"), ElementFacts(role: "AXTextArea", editable: true)
        ] {
            var appReads = 0
            let result = FocusResolution.preferred(system: facts,
                app: { appReads += 1; return ElementFacts(role: "AXTextArea", editable: true) },
                facts: { $0 })
            XCTAssertEqual(result?.role, facts.role)
            XCTAssertEqual(result?.secure, facts.secure)
            XCTAssertEqual(appReads, 0)
        }
    }

    func testColdTreeWaitsThroughMissingAndGenericContainersForTheEditor() {
        let readings: [ElementFacts?] = [
            nil, ElementFacts(role: "AXGroup"), ElementFacts(role: "AXWebArea"),
            ElementFacts(role: "AXTextArea", editable: true)
        ]
        var index = 0
        var requests = 0
        let result = FocusResolution.capture(
            sameApp: { true }, read: { readings[index] }, facts: { $0 },
            requestAccessibility: { requests += 1 }, wait: { index += 1 })
        XCTAssertEqual(result?.role, "AXTextArea")
        XCTAssertEqual(index, 3)
        XCTAssertEqual(requests, 1)
    }

    func testSecureAndDefiniteControlsAreNeverReplacedByLaterEditors() {
        for facts in [
            ElementFacts(role: "AXTextField", secure: true, editable: true),
            ElementFacts(role: "AXButton"),
            ElementFacts(role: "AXGroup", editable: true)
        ] {
            var waits = 0
            var requests = 0
            let result = FocusResolution.capture(
                sameApp: { true }, read: { facts }, facts: { $0 },
                requestAccessibility: { requests += 1 }, wait: { waits += 1 })
            XCTAssertEqual(result?.role, facts.role)
            XCTAssertEqual(result?.secure, facts.secure)
            XCTAssertEqual(waits, 0)
            XCTAssertEqual(requests, 0)
        }
    }

    func testChangingAppsWhileTheTreeWakesAbandonsCapture() {
        var active = true
        var reads = 0
        let result: ElementFacts? = FocusResolution.capture(
            sameApp: { active },
            read: { reads += 1; return ElementFacts(role: "AXGroup") }, facts: { $0 },
            requestAccessibility: {}, wait: { active = false })
        XCTAssertNil(result)
        XCTAssertEqual(reads, 1)
    }

    func testChangingAppsDuringTheAccessibilityReadAbandonsCapture() {
        var active = true
        let result: ElementFacts? = FocusResolution.capture(
            sameApp: { active },
            read: { active = false; return ElementFacts(role: "AXTextField", editable: true) },
            facts: { $0 }, requestAccessibility: {}, wait: {})
        XCTAssertNil(result)
    }

    func testAnUnresolvedTreeHasABoundedWaitAndNeverFindsArbitraryChildren() {
        var waits = 0
        var reads = 0
        let result = FocusResolution.capture(
            sameApp: { true },
            read: { reads += 1; return ElementFacts(role: "AXGroup") }, facts: { $0 },
            requestAccessibility: {}, wait: { waits += 1 })
        XCTAssertEqual(result?.editable, false)
        XCTAssertEqual(waits, 40)
        XCTAssertEqual(reads, 41)
    }
}

final class PasteReadinessTests: XCTestCase {
    func testSelectionGuardsAreRecheckedAfterWaitingEvenWithoutAReadableValueOrRange() {
        let cases: [(DeliveryGuards, String)] = [
            (DeliveryGuards(expectSelection: "original"), "selection-changed"),
            (DeliveryGuards(replace: "original"), "text-changed")
        ]
        for (guards, expectedReason) in cases {
            var selection: String? = "original"
            let reason = PasteReadiness.refusal(
                validate: { guards.refusal(selected: selection) },
                secureInput: { true }, wait: { selection = "different" })
            XCTAssertEqual(reason, expectedReason)
            XCTAssertEqual(guards.refusal(selected: nil), expectedReason)
            XCTAssertNil(guards.refusal(selected: "original"))
        }
    }

    func testTransientSecureInputCanClearBeforeAnyInsertion() {
        var waits = 0
        var validations = 0
        let reason = PasteReadiness.refusal(
            validate: { validations += 1; return nil },
            secureInput: { waits < 2 }, wait: { waits += 1 })
        XCTAssertNil(reason)
        XCTAssertEqual(waits, 2)
        XCTAssertEqual(validations, 4, "validate each wait and after the input block clears")
    }

    func testPersistentGlobalSecureInputHasItsOwnReason() {
        var waits = 0
        let reason = PasteReadiness.refusal(
            validate: { nil }, secureInput: { true }, wait: { waits += 1 })
        XCTAssertEqual(reason, "secure-input")
        XCTAssertEqual(waits, 6)
    }

    func testFocusChangeOrPasswordFieldDuringTheWaitStopsPaste() {
        for refusal in ["focus-changed", "secure-field", "accessibility-denied", "not-editable"] {
            var waits = 0
            let reason = PasteReadiness.refusal(
                validate: { waits == 0 ? nil : refusal },
                secureInput: { true }, wait: { waits += 1 })
            XCTAssertEqual(reason, refusal)
            XCTAssertEqual(waits, 1)
        }
    }

    func testKeystrokeBoundaryRechecksWithoutWaiting() {
        var waits = 0
        let reason = PasteReadiness.refusal(
            validate: { nil }, secureInput: { true }, wait: { waits += 1 }, attempts: 0)
        XCTAssertEqual(reason, "secure-input")
        XCTAssertEqual(waits, 0)
    }

    func testTargetBecomingSecureAsGlobalInputClearsIsStillRefused() {
        var checks = 0
        let reason = PasteReadiness.refusal(
            validate: { checks += 1; return checks == 2 ? "secure-field" : nil },
            secureInput: { false }, wait: {})
        XCTAssertEqual(reason, "secure-field")
    }
}
