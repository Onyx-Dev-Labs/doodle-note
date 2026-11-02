import XCTest

@testable import dictation_helper

private typealias Output = HoldMachine.Output

final class HoldMachineTests: XCTestCase {
    private let optionCode: Int64 = 61
    private let optionMask: UInt64 = 0x40
    private let shiftCode: Int64 = 56
    private let shiftBit: UInt64 = 0x20000

    private func option() -> HoldMachine { HoldMachine(keyCode: 61, deviceMask: 0x40) }
    /// The Fn/Globe key as the helper configures it.
    private func fn() -> HoldMachine {
        let spec = HoldKeySpec.named("fn")!
        return HoldMachine(keyCode: spec.keyCode, deviceMask: spec.deviceMask)
    }

    private func press(_ m: inout HoldMachine, extra: UInt64 = 0) -> [Output] {
        m.handle(.flagsChanged(keyCode: m.keyCode, flags: m.deviceMask | extra))
    }
    private func release(_ m: inout HoldMachine) -> [Output] {
        m.handle(.flagsChanged(keyCode: m.keyCode, flags: 0))
    }

    func testHoldIsAnnouncedAfterTheDelayAndPairedOnRelease() {
        var m = option()
        XCTAssertEqual(press(&m), [.cancelAnnounce, .scheduleAnnounce])
        XCTAssertEqual(m.handle(.announceTimer), [.holdDown(id: 1)])
        XCTAssertEqual(release(&m), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
    }

    func testReleaseBeforeTheDelayIsATapAndNeverAHold() {
        var m = option()
        _ = press(&m)
        XCTAssertEqual(release(&m), [.cancelAnnounce, .tap])
        // The timer was cancelled, but even if it fires late nothing is announced.
        XCTAssertEqual(m.handle(.announceTimer), [])
    }

    func testTwoQuickTapsAreTwoTapEvents() {
        var m = option()
        var taps = 0
        for _ in 0..<2 {
            _ = press(&m)
            taps += release(&m).filter { $0 == .tap }.count
        }
        XCTAssertEqual(taps, 2)
    }

    func testAnotherKeyMakesItAChordNotATapOrHold() {
        var m = option()
        _ = press(&m)
        _ = m.handle(.keyDown)
        XCTAssertEqual(m.handle(.announceTimer), [])
        XCTAssertEqual(release(&m), [.cancelAnnounce])
    }

    func testAnotherModifierJoiningIsAChord() {
        var m = option()
        _ = press(&m)
        XCTAssertEqual(
            m.handle(.flagsChanged(keyCode: shiftCode, flags: optionMask | shiftBit)), [])
        XCTAssertEqual(m.handle(.announceTimer), [])
        XCTAssertEqual(release(&m), [.cancelAnnounce])
    }

    func testAKeyStruckDuringAnAnnouncedHoldDoesNotEndIt() {
        var m = option()
        _ = press(&m)
        _ = m.handle(.announceTimer)
        XCTAssertEqual(m.handle(.keyDown), [])
        XCTAssertEqual(release(&m), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
    }

    func testALostReleaseIsNoticedFromAnotherKeysEvent() {
        var m = option()
        _ = press(&m)
        _ = m.handle(.announceTimer)
        // Shift is pressed later; its event no longer carries our bit.
        XCTAssertEqual(
            m.handle(.flagsChanged(keyCode: shiftCode, flags: shiftBit)),
            [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
        XCTAssertFalse(m.keyIsDown)
    }

    func testTapDisabledEndsAnAnnouncedHold() {
        var m = option()
        _ = press(&m)
        _ = m.handle(.announceTimer)
        XCTAssertEqual(m.handle(.tapDisabled), [.holdUp(id: 1, reason: "tap-disabled")])
        XCTAssertEqual(m.handle(.tapDisabled), [])
    }

    func testResetEndsAnAnnouncedHoldOnce() {
        var m = option()
        _ = press(&m)
        _ = m.handle(.announceTimer)
        XCTAssertEqual(m.handle(.reset), [.cancelAnnounce, .holdUp(id: 1, reason: "stopped")])
        XCTAssertEqual(m.handle(.reset), [.cancelAnnounce])
    }

    func testHoldIdsKeepCountingAcrossRestarts() {
        var first = option()
        _ = press(&first)
        _ = first.handle(.announceTimer)
        var second = HoldMachine(keyCode: 61, deviceMask: 0x40, holdId: first.holdId)
        _ = press(&second)
        XCTAssertEqual(second.handle(.announceTimer), [.holdDown(id: 2)])
    }

    func testRepeatedPressEventsDoNotRestartTheDelay() {
        var m = option()
        _ = press(&m)
        XCTAssertEqual(press(&m), [])
    }

    // Fn / Globe

    func testFnUsesTheSecondaryFnFlagOnKeyCode63() {
        let spec = HoldKeySpec.named("fn")!
        XCTAssertEqual(spec.keyCode, 63)
        XCTAssertEqual(spec.deviceMask, CGEventFlags.maskSecondaryFn.rawValue)
    }

    func testFnDoubleTapIsTwoTaps() {
        var m = fn()
        var taps = 0
        for _ in 0..<2 {
            _ = press(&m)
            taps += release(&m).filter { $0 == .tap }.count
        }
        XCTAssertEqual(taps, 2)
    }

    func testFnHoldStillWorks() {
        var m = fn()
        _ = press(&m)
        XCTAssertEqual(m.handle(.announceTimer), [.holdDown(id: 1)])
        XCTAssertEqual(release(&m), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
    }

    func testFnWithAnArrowOrFunctionKeyIsAChordNotATap() {
        var m = fn()
        _ = press(&m)
        _ = m.handle(.keyDown)  // Fn+Left arrow, Fn+F-key
        XCTAssertEqual(release(&m), [.cancelAnnounce])
    }

    func testFnReleaseLostThenAnotherModifierPressedEndsTheHold() {
        var m = fn()
        _ = press(&m)
        _ = m.handle(.announceTimer)
        XCTAssertEqual(
            m.handle(.flagsChanged(keyCode: shiftCode, flags: shiftBit)),
            [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
    }

    func testFnStillHeldWhileAnotherModifierJoinsKeepsTheChordRule() {
        var m = fn()
        _ = press(&m)
        let fnBit = CGEventFlags.maskSecondaryFn.rawValue
        XCTAssertEqual(m.handle(.flagsChanged(keyCode: shiftCode, flags: fnBit | shiftBit)), [])
        XCTAssertEqual(release(&m), [.cancelAnnounce])
    }

    // Mouse button

    private func mouse(_ button: Int64 = 3) -> HoldMachine { HoldMachine(mouseButton: button) }

    func testMouseHoldIsAnnouncedAfterTheDelayAndPairedOnRelease() {
        var m = mouse()
        XCTAssertEqual(m.handle(.buttonDown(button: 3)), [.cancelAnnounce, .scheduleAnnounce])
        XCTAssertEqual(m.handle(.announceTimer), [.holdDown(id: 1)])
        XCTAssertEqual(
            m.handle(.buttonUp(button: 3)), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
    }

    func testMouseQuickClickIsATapAndTwoOfThemAreADoubleTap() {
        var m = mouse()
        var taps = 0
        for _ in 0..<2 {
            _ = m.handle(.buttonDown(button: 3))
            taps += m.handle(.buttonUp(button: 3)).filter { $0 == .tap }.count
        }
        XCTAssertEqual(taps, 2)
        XCTAssertEqual(m.handle(.announceTimer), [], "a cancelled delay announces nothing")
    }

    func testOnlyTheConfiguredButtonCounts() {
        var m = mouse(3)
        XCTAssertEqual(m.handle(.buttonDown(button: 4)), [])
        XCTAssertEqual(m.handle(.buttonUp(button: 4)), [])
        XCTAssertFalse(m.isDown)
        _ = m.handle(.buttonDown(button: 3))
        XCTAssertEqual(m.handle(.buttonUp(button: 4)), [], "another button's release is not ours")
        XCTAssertTrue(m.isDown)
    }

    func testKeysAndModifiersNeverSpoilAMouseHold() {
        var m = mouse()
        _ = m.handle(.buttonDown(button: 3))
        XCTAssertEqual(m.handle(.keyDown), [])
        XCTAssertEqual(m.handle(.flagsChanged(keyCode: 56, flags: 0x20000)), [])
        XCTAssertEqual(m.handle(.announceTimer), [.holdDown(id: 1)], "still a hold")
    }

    func testRepeatedButtonDownDoesNotRestartTheDelay() {
        var m = mouse()
        _ = m.handle(.buttonDown(button: 3))
        XCTAssertEqual(m.handle(.buttonDown(button: 3)), [])
    }

    func testALostButtonReleaseIsNoticedFromTheLiveButtonState() {
        var m = mouse()
        _ = m.handle(.buttonDown(button: 3))
        _ = m.handle(.announceTimer)
        XCTAssertEqual(m.handle(.buttonState(down: true)), [], "still held")
        XCTAssertEqual(
            m.handle(.buttonState(down: false)), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
        XCTAssertFalse(m.isDown)
        XCTAssertEqual(m.handle(.buttonState(down: false)), [], "nothing more to end")
    }

    func testALostReleaseBeforeTheDelayIsATapNotAHold() {
        var m = mouse()
        _ = m.handle(.buttonDown(button: 3))
        XCTAssertEqual(m.handle(.buttonState(down: false)), [.cancelAnnounce, .tap])
    }

    func testMouseTapDisabledAndResetEndAnAnnouncedHold() {
        var a = mouse()
        _ = a.handle(.buttonDown(button: 3))
        _ = a.handle(.announceTimer)
        XCTAssertEqual(a.handle(.tapDisabled), [.holdUp(id: 1, reason: "tap-disabled")])
        var b = mouse()
        _ = b.handle(.buttonDown(button: 3))
        _ = b.handle(.announceTimer)
        XCTAssertEqual(b.handle(.reset), [.cancelAnnounce, .holdUp(id: 1, reason: "stopped")])
    }

    func testAKeyMachineIgnoresMouseInputsAndAMouseMachineIgnoresKeyInputs() {
        var key = option()
        XCTAssertEqual(key.handle(.buttonDown(button: 3)), [])
        XCTAssertFalse(key.isDown)
        var m = mouse()
        XCTAssertEqual(m.handle(.flagsChanged(keyCode: 61, flags: 0x40)), [])
        XCTAssertFalse(m.isDown)
    }

    func testNoPrimaryButtonIsAllowedAsATrigger() {
        XCTAssertFalse(HoldWatcher.allowedButton(0))
        XCTAssertFalse(HoldWatcher.allowedButton(1))
        XCTAssertFalse(HoldWatcher.allowedButton(-1))
        XCTAssertTrue(HoldWatcher.allowedButton(2))
        XCTAssertTrue(HoldWatcher.allowedButton(4))
        XCTAssertTrue(HoldWatcher.allowedButton(31))
        XCTAssertFalse(HoldWatcher.allowedButton(32))
    }

    // Key and mouse together

    func testTheFirstSourceHeldOwnsTheSessionAndTheOtherIsIgnored() {
        var arbiter = HoldArbiter()
        XCTAssertTrue(arbiter.allow(.holdDown(id: 1), from: .key))
        XCTAssertFalse(arbiter.allow(.holdDown(id: 2), from: .mouse), "second source ignored")
        XCTAssertFalse(arbiter.allow(.tap, from: .mouse), "no tap while the other is held")
        XCTAssertFalse(arbiter.allow(.holdUp(id: 2, reason: "released"), from: .mouse))
        XCTAssertEqual(arbiter.owner, .key, "the owner is unaffected")
        XCTAssertTrue(arbiter.allow(.holdUp(id: 1, reason: "released"), from: .key))
        XCTAssertNil(arbiter.owner)
        // Free again: either may own the next one, and taps are heard.
        XCTAssertTrue(arbiter.allow(.tap, from: .mouse))
        XCTAssertTrue(arbiter.allow(.holdDown(id: 3), from: .mouse))
        XCTAssertFalse(arbiter.allow(.holdDown(id: 4), from: .key))
        XCTAssertTrue(arbiter.allow(.holdUp(id: 3, reason: "released"), from: .mouse))
    }

    func testSchedulingOutputsAlwaysPassAndAnOrphanReleaseIsDropped() {
        var arbiter = HoldArbiter()
        XCTAssertTrue(arbiter.allow(.scheduleAnnounce, from: .mouse))
        XCTAssertTrue(arbiter.allow(.cancelAnnounce, from: .key))
        XCTAssertFalse(arbiter.allow(.holdUp(id: 9, reason: "released"), from: .key))
        XCTAssertNil(arbiter.owner)
    }

    func testBothSourcesAreIndependentMachines() {
        var key = option()
        var button = mouse()
        _ = press(&key)
        _ = button.handle(.buttonDown(button: 3))
        XCTAssertEqual(key.handle(.announceTimer), [.holdDown(id: 1)])
        // The key being held does not make the button a chord.
        XCTAssertEqual(button.handle(.announceTimer), [.holdDown(id: 1)])
        XCTAssertEqual(
            button.handle(.buttonUp(button: 3)), [.cancelAnnounce, .holdUp(id: 1, reason: "released")])
        XCTAssertTrue(key.isDown, "releasing the button leaves the key held")
    }
}

final class ClickModeTests: XCTestCase {
    private func clicker(_ button: Int64 = 3) -> HoldMachine {
        HoldMachine(mouseButton: button, clickMode: true)
    }

    func testEveryPressIsOneClickAtOnceAndTheReleaseDoesNothing() {
        var m = clicker()
        XCTAssertEqual(m.handle(.buttonDown(button: 3)), [.click])
        XCTAssertEqual(m.handle(.buttonUp(button: 3)), [])
        XCTAssertEqual(m.handle(.buttonDown(button: 3)), [.click])
        XCTAssertEqual(m.handle(.buttonUp(button: 3)), [])
    }

    func testAPressHeldForAWhileIsStillJustOneClickAndNeverAHold() {
        var m = clicker()
        XCTAssertEqual(m.handle(.buttonDown(button: 3)), [.click])
        XCTAssertEqual(m.handle(.announceTimer), [], "no hold is ever announced")
        XCTAssertEqual(m.handle(.buttonState(down: false)), [], "no lost-release handling either")
        XCTAssertEqual(m.handle(.buttonUp(button: 3)), [])
    }

    func testOnlyTheConfiguredButtonClicks() {
        var m = clicker(3)
        XCTAssertEqual(m.handle(.buttonDown(button: 4)), [])
        XCTAssertEqual(m.handle(.buttonUp(button: 4)), [])
    }

    func testKeysAndResetsDoNothingInClickMode() {
        var m = clicker()
        XCTAssertEqual(m.handle(.keyDown), [])
        XCTAssertEqual(m.handle(.flagsChanged(keyCode: 61, flags: 0x40)), [])
        XCTAssertEqual(m.handle(.tapDisabled), [])
        XCTAssertEqual(m.handle(.reset), [.cancelAnnounce])
    }

    func testAClickIsHeardOnlyWhenTheKeyDoesNotOwnASession() {
        var arbiter = HoldArbiter()
        XCTAssertTrue(arbiter.allow(.click, from: .mouse))
        XCTAssertTrue(arbiter.allow(.holdDown(id: 1), from: .key))
        XCTAssertFalse(arbiter.allow(.click, from: .mouse), "the key's hold is not disturbed")
        XCTAssertTrue(arbiter.allow(.holdUp(id: 1, reason: "released"), from: .key))
        XCTAssertTrue(arbiter.allow(.click, from: .mouse))
    }

    func testClickModeAndHoldModeAreChosenAtConstruction() {
        var hold = HoldMachine(mouseButton: 3)
        XCTAssertEqual(hold.handle(.buttonDown(button: 3)), [.cancelAnnounce, .scheduleAnnounce])
        XCTAssertFalse(hold.clickMode)
        XCTAssertTrue(clicker().clickMode)
    }
}
