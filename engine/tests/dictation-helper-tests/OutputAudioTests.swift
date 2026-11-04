import XCTest

@testable import dictation_helper

/// A pretend output device: nothing here touches the real volume.
private final class FakeOutput: OutputDeviceControl {
    var device: UInt32? = 1
    var alive = true
    var mute: Bool?
    var channels: [(UInt32, Float)] = []
    var setCalls = 0

    func defaultDevice() -> UInt32? { device }
    func exists(_ device: UInt32) -> Bool { alive }
    func muteSwitch(_ device: UInt32) -> Bool? { mute }
    func setMuteSwitch(_ device: UInt32, _ muted: Bool) -> Bool {
        setCalls += 1
        mute = muted
        return true
    }
    func volumes(_ device: UInt32) -> [(UInt32, Float)] { channels }
    func setVolume(_ device: UInt32, element: UInt32, _ value: Float) -> Bool {
        setCalls += 1
        if let index = channels.firstIndex(where: { $0.0 == element }) {
            channels[index].1 = value
            return true
        }
        return false
    }
}

final class OutputAudioTests: XCTestCase {
    func testMutesWithTheDeviceSwitchAndGivesTheSoundBack() {
        let fake = FakeOutput()
        fake.mute = false
        let muter = OutputMuter(control: fake)
        XCTAssertEqual(muter.mute(), .muted)
        XCTAssertEqual(fake.mute, true)
        XCTAssertTrue(muter.isHolding)
        XCTAssertEqual(muter.restore(), .restored)
        XCTAssertEqual(fake.mute, false)
        XCTAssertFalse(muter.isHolding)
    }

    func testFallsBackToVolumesAndRestoresEachChannelsOwnLevel() {
        let fake = FakeOutput()
        fake.channels = [(1, 0.8), (2, 0.4)]
        let muter = OutputMuter(control: fake)
        XCTAssertEqual(muter.mute(), .muted)
        XCTAssertEqual(fake.channels.map { $0.1 }, [0, 0])
        XCTAssertEqual(muter.restore(), .restored)
        XCTAssertEqual(fake.channels.map { $0.1 }, [0.8, 0.4])
    }

    func testAnOutputThatIsAlreadyMutedOrAtZeroIsNeverTouchedOrUnmuted() {
        let muted = FakeOutput()
        muted.mute = true
        let a = OutputMuter(control: muted)
        XCTAssertEqual(a.mute(), .alreadySilent)
        XCTAssertEqual(a.restore(), .nothing)
        XCTAssertEqual(muted.mute, true)
        XCTAssertEqual(muted.setCalls, 0)

        let quiet = FakeOutput()
        quiet.channels = [(0, 0)]
        let b = OutputMuter(control: quiet)
        XCTAssertEqual(b.mute(), .alreadySilent)
        XCTAssertEqual(b.restore(), .nothing)
        XCTAssertEqual(quiet.setCalls, 0)
    }

    func testAskingTwiceHoldsOnceAndRestoresOnce() {
        let fake = FakeOutput()
        fake.mute = false
        let muter = OutputMuter(control: fake)
        XCTAssertEqual(muter.mute(), .muted)
        XCTAssertEqual(muter.mute(), .alreadyHeld)
        XCTAssertEqual(muter.restore(), .restored)
        XCTAssertEqual(muter.restore(), .nothing)
        XCTAssertEqual(fake.setCalls, 2)
    }

    func testASoundTheUserChangedMeanwhileIsLeftAlone() {
        let mute = FakeOutput()
        mute.mute = false
        let a = OutputMuter(control: mute)
        _ = a.mute()
        mute.mute = false  // they unmuted it themselves
        XCTAssertEqual(a.restore(), .userChanged)
        XCTAssertEqual(mute.mute, false)

        let volume = FakeOutput()
        volume.channels = [(0, 0.7)]
        let b = OutputMuter(control: volume)
        _ = b.mute()
        volume.channels = [(0, 0.3)]  // they turned it up to a level of their own
        XCTAssertEqual(b.restore(), .userChanged)
        XCTAssertEqual(volume.channels[0].1, 0.3)
    }

    func testNoDeviceUnsupportedDeviceAndAVanishedDevice() {
        let none = FakeOutput()
        none.device = nil
        XCTAssertEqual(OutputMuter(control: none).mute(), .noDevice)

        let bare = FakeOutput()
        XCTAssertEqual(OutputMuter(control: bare).mute(), .unsupported)

        let gone = FakeOutput()
        gone.mute = false
        let muter = OutputMuter(control: gone)
        _ = muter.mute()
        gone.alive = false
        XCTAssertEqual(muter.restore(), .gone)
        XCTAssertFalse(muter.isHolding)
    }
}
