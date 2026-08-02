import XCTest
@testable import DoodleNote

final class TimeoutTests: XCTestCase {
    func testNonCooperativeOperationDoesNotBlockTimeout() async {
        let clock = ContinuousClock()
        let elapsed = await clock.measure {
            await withTimeout(seconds: 0.05) {
                await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in
                    // Intentionally never resumed: models a wedged framework await.
                }
            }
        }

        XCTAssertLessThan(elapsed, .milliseconds(500))
    }

    func testThrowingTimeoutReturnsPromptly() async {
        let clock = ContinuousClock()
        let started = clock.now

        do {
            let _: Int = try await withThrowingTimeout(seconds: 0.05) {
                try await withCheckedThrowingContinuation {
                    (_: CheckedContinuation<Int, Error>) in
                    // Intentionally never resumed.
                }
            }
            XCTFail("Expected a timeout")
        } catch is TimeoutError {
            XCTAssertLessThan(started.duration(to: clock.now), .milliseconds(500))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
