import ApplicationServices
import XCTest

@testable import dictation_helper

final class ModifierToggleTests: XCTestCase {
    private let names = ["AltRight", "AltLeft", "ControlRight", "ControlLeft", "MetaRight", "MetaLeft",
                         "ShiftRight", "ShiftLeft", "Fn"]
    private func spec(_ name: String = "AltRight") -> ModifierToggleKeySpec {
        ModifierToggleKeySpec.named(name)!
    }
    private func press(_ machine: inout ModifierToggleMachine, extra: UInt64 = 0) -> [ModifierToggleMachine.Output] {
        machine.handle(.flagsChanged(keyCode: machine.spec.keyCode,
                                     flags: machine.spec.deviceMask | machine.spec.familyMask | extra))
    }
    private func release(_ machine: inout ModifierToggleMachine, remaining: UInt64 = 0) -> [ModifierToggleMachine.Output] {
        machine.handle(.flagsChanged(keyCode: machine.spec.keyCode, flags: remaining))
    }

    func testEverySupportedPhysicalModifierTogglesOnceOnReleaseAndNeverOnDown() {
        let codes: [Int64] = [61, 58, 62, 59, 54, 55, 60, 56, 63]
        let masks: [UInt64] = [0x40, 0x20, 0x2000, 0x1, 0x10, 0x8, 0x4, 0x2, 0x800000]
        for (index, name) in names.enumerated() {
            let key = spec(name)
            XCTAssertEqual(key.keyCode, codes[index], name)
            XCTAssertEqual(key.deviceMask, masks[index], name)
            var machine = ModifierToggleMachine(spec: key)
            XCTAssertEqual(press(&machine), [], name)
            for _ in 0..<5 { XCTAssertEqual(press(&machine), [], name) }
            XCTAssertEqual(release(&machine), [.toggle], name)
            XCTAssertEqual(release(&machine), [], name)
            XCTAssertEqual(press(&machine), [], name)
            XCTAssertEqual(release(&machine), [.toggle], name)
        }
        XCTAssertNil(ModifierToggleKeySpec.named("off"))
        XCTAssertNil(ModifierToggleKeySpec.named("Alt"))
        XCTAssertNil(ModifierToggleKeySpec.named("rightOption"))
    }

    func testOppositeSideCannotActivateAndItsPreexistingPressSpoilsTheCandidate() {
        for pair in [("AltRight", "AltLeft"), ("ControlRight", "ControlLeft"),
                     ("MetaRight", "MetaLeft"), ("ShiftRight", "ShiftLeft")] {
            for (selected, other) in [pair, (pair.1, pair.0)] {
                var machine = ModifierToggleMachine(spec: spec(selected))
                let twin = spec(other)
                XCTAssertEqual(machine.handle(.flagsChanged(keyCode: twin.keyCode,
                                                           flags: twin.deviceMask | twin.familyMask)), [])
                XCTAssertFalse(machine.isDown)
                XCTAssertEqual(press(&machine, extra: twin.deviceMask | twin.familyMask), [])
                XCTAssertEqual(release(&machine, remaining: twin.deviceMask | twin.familyMask), [])
                XCTAssertEqual(machine.handle(.flagsChanged(keyCode: twin.keyCode, flags: 0)), [])
                XCTAssertEqual(press(&machine), [])
                XCTAssertEqual(release(&machine), [.toggle])
            }
        }
    }

    func testEveryOtherPreexistingModifierRejectsAToggleEvenIfItReleasesFirst() {
        for selected in names {
            for other in names where other != selected {
                var machine = ModifierToggleMachine(spec: spec(selected))
                let held = spec(other)
                XCTAssertEqual(press(&machine, extra: held.deviceMask | held.familyMask), [])
                XCTAssertTrue(machine.tainted, "\(selected) + \(other)")
                XCTAssertEqual(machine.handle(.flagsChanged(keyCode: held.keyCode,
                                                           flags: machine.spec.deviceMask | machine.spec.familyMask)), [])
                XCTAssertEqual(release(&machine), [], "\(selected) + \(other)")
            }
        }
    }

    func testOtherModifierJoiningAndLeavingTaintsUntilTheSelectedKeyReleases() {
        var machine = ModifierToggleMachine(spec: spec())
        _ = press(&machine)
        let shift = spec("ShiftLeft")
        _ = machine.handle(.flagsChanged(keyCode: shift.keyCode,
                                        flags: shift.deviceMask | shift.familyMask | spec().deviceMask | spec().familyMask))
        _ = machine.handle(.flagsChanged(keyCode: shift.keyCode, flags: spec().deviceMask | spec().familyMask))
        XCTAssertEqual(press(&machine), []) // Repeat must not clear the chord.
        XCTAssertEqual(release(&machine), [])
        _ = press(&machine)
        XCTAssertEqual(release(&machine), [.toggle])
    }

    func testKeyboardShortcutAndAlreadyHeldKeyNeverToggle() {
        for seeded in [false, true] {
            var machine = ModifierToggleMachine(spec: spec(), keysDown: seeded ? [0] : [])
            if !seeded { _ = machine.handle(.keyDown(keyCode: 0)) }
            _ = press(&machine)
            _ = machine.handle(.keyUp(keyCode: 0))
            XCTAssertEqual(release(&machine), [])
            _ = press(&machine)
            _ = machine.handle(.keyDown(keyCode: 8))
            _ = machine.handle(.keyDown(keyCode: 8)) // ordinary-key autorepeat
            _ = machine.handle(.keyUp(keyCode: 8))
            XCTAssertEqual(release(&machine), [])
            _ = press(&machine)
            XCTAssertEqual(release(&machine), [.toggle])
        }
    }

    func testMouseChordsBeforeAndDuringThePressNeverToggle() {
        for button: Int64 in [0, 1, 2, 4] {
            for seeded in [false, true] {
                var machine = ModifierToggleMachine(spec: spec(), buttonsDown: seeded ? [button] : [])
                if !seeded { _ = machine.handle(.mouseDown(button: button)) }
                _ = press(&machine)
                _ = machine.handle(.mouseUp(button: button))
                XCTAssertEqual(release(&machine), [])
                _ = press(&machine)
                _ = machine.handle(.mouseDown(button: button))
                _ = machine.handle(.mouseUp(button: button))
                XCTAssertEqual(release(&machine), [])
                _ = press(&machine)
                XCTAssertEqual(release(&machine), [.toggle])
            }
        }
    }

    func testScrollingDraggingAndOrphanInputReleasesSpoilTheCandidate() {
        let inputs: [ModifierToggleMachine.Input] = [.mouseInteraction, .mouseUp(button: 0), .keyUp(keyCode: 8)]
        for input in inputs {
            var machine = ModifierToggleMachine(spec: spec())
            _ = press(&machine)
            XCTAssertEqual(machine.handle(input), [])
            XCTAssertEqual(release(&machine), [])
        }
    }

    func testCapsLockLatchedStateIsAllowedButChangingItDuringAPressIsAChord() {
        var machine = ModifierToggleMachine(spec: spec())
        _ = press(&machine, extra: 0x10000)
        XCTAssertEqual(release(&machine, remaining: 0x10000), [.toggle])
        _ = press(&machine)
        _ = machine.handle(.flagsChanged(keyCode: 57, flags: spec().deviceMask | spec().familyMask | 0x10000))
        XCTAssertEqual(release(&machine, remaining: 0x10000), [])
    }

    func testLostReleaseIsDiscardedInsteadOfInferredAndNextPressWorks() {
        var machine = ModifierToggleMachine(spec: spec("Fn"))
        _ = press(&machine)
        XCTAssertEqual(machine.handle(.flagsChanged(keyCode: 56, flags: 0x20002)), [])
        XCTAssertFalse(machine.isDown)
        XCTAssertEqual(release(&machine), [])
        _ = press(&machine)
        XCTAssertEqual(release(&machine), [.toggle])
    }

    func testResetAndTapDisabledRejectStaleReleasesAndRepeatedHeldFlags() {
        for reset in [ModifierToggleMachine.Input.reset, .tapDisabled] {
            var machine = ModifierToggleMachine(spec: spec())
            _ = press(&machine)
            XCTAssertEqual(machine.handle(reset), [])
            XCTAssertEqual(press(&machine), []) // old still-held flags after interruption
            XCTAssertEqual(release(&machine), [])
            XCTAssertEqual(release(&machine), [])
            _ = press(&machine)
            XCTAssertEqual(release(&machine), [.toggle])
        }
    }

    func testStartAndRearmWhileAlreadyHeldRequireAFreshPress() {
        for name in names {
            let key = spec(name)
            var machine = ModifierToggleMachine(spec: key, flags: key.deviceMask | key.familyMask)
            XCTAssertEqual(press(&machine), [])
            XCTAssertEqual(release(&machine), [])
            _ = press(&machine)
            XCTAssertEqual(release(&machine), [.toggle])
        }
    }

    func testQueuedInputFromBeforeTheSnapshotCannotTriggerOrTaintANewCycle() {
        let key = spec()
        var machine = ModifierToggleMachine(spec: key, eventsAfter: 100)
        XCTAssertEqual(machine.handle(.flagsChanged(keyCode: key.keyCode, flags: key.deviceMask), timestamp: 80), [])
        XCTAssertEqual(machine.handle(.flagsChanged(keyCode: key.keyCode, flags: 0), timestamp: 90), [])
        XCTAssertEqual(machine.handle(.keyDown(keyCode: 8), timestamp: 99), [])
        XCTAssertEqual(machine.handle(.flagsChanged(keyCode: key.keyCode, flags: key.deviceMask), timestamp: 101), [])
        XCTAssertEqual(machine.handle(.flagsChanged(keyCode: key.keyCode, flags: 0), timestamp: 102), [.toggle])
    }

    func testPermissionDenialNeverAcquiresATapOrEmitsAndOffNeedsNoPermission() {
        var checks = 0
        var acquisitions = 0
        var events = 0
        let watcher = ModifierToggleWatcher(listenPermission: {
            checks += 1
            return false
        }, makeTap: { _, _, _ in
            acquisitions += 1
            return nil
        }, emit: { events += 1 })
        XCTAssertNil(watcher.set(key: "off"))
        XCTAssertEqual(checks, 0)
        XCTAssertEqual(watcher.set(key: "unsupported"), "unknown-key")
        XCTAssertEqual(checks, 0)
        for key in names {
            XCTAssertEqual(watcher.set(key: key), "input-monitoring-denied")
            XCTAssertFalse(watcher.active)
        }
        XCTAssertEqual(acquisitions, 0)
        XCTAssertEqual(events, 0)
        watcher.stop()
        XCTAssertNil(watcher.set(key: "off"))
        XCTAssertFalse(watcher.active)
    }

    func testTapCreationFailureIsPermissionFailureAndCanBeRetriedWithoutAStaleListener() {
        var allowed = true
        var masks: [CGEventMask] = []
        let watcher = ModifierToggleWatcher(listenPermission: { allowed }, makeTap: { mask, _, _ in
            masks.append(mask)
            return nil
        }, emit: { XCTFail("A failed listener must never emit") })
        XCTAssertEqual(watcher.set(key: "AltRight"), "input-monitoring-denied")
        XCTAssertFalse(watcher.active)
        allowed = false
        XCTAssertEqual(watcher.set(key: "MetaLeft"), "input-monitoring-denied")
        XCTAssertEqual(masks.count, 1)
        allowed = true
        XCTAssertEqual(watcher.set(key: "Fn"), "input-monitoring-denied")
        XCTAssertEqual(masks.count, 2)
        for type: CGEventType in [.flagsChanged, .keyDown, .keyUp, .leftMouseDown, .leftMouseUp,
                                 .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
                                 .scrollWheel, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged] {
            XCTAssertNotEqual(masks[0] & (CGEventMask(1) << type.rawValue), 0)
        }
        XCTAssertNil(watcher.set(key: "off"))
        XCTAssertFalse(watcher.active)
    }
}
