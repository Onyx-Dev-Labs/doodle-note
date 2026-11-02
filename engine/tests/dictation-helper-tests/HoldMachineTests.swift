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
}
