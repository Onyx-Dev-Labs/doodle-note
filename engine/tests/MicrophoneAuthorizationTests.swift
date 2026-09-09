// Run from the repository root:
// swiftc -parse-as-library engine/Sources/engine/MicrophoneAuthorization.swift \
//   engine/tests/MicrophoneAuthorizationTests.swift -o /tmp/doodle-permission-tests && /tmp/doodle-permission-tests
import AVFoundation
import Foundation

@main
struct MicrophoneAuthorizationTests {
    static func main() async {
        var currentStatus: AVAuthorizationStatus = .authorized
        var requests = 0
        var waits = 0
        var grant = true
        func run() async -> Bool {
            await MicrophoneAuthorization.authorize(
                status: { currentStatus },
                request: { requests += 1; return grant },
                willRequest: { waits += 1 }
            )
        }
        for _ in 0..<3 {
            let allowed = await run()
            precondition(allowed)
        }
        precondition(requests == 0 && waits == 0, "authorized repeats must not request or wait")
        for denied in [AVAuthorizationStatus.denied, .restricted] {
            currentStatus = denied
            let allowed = await run()
            precondition(!allowed, "revoked/restricted access must not use a stale grant")
        }
        precondition(requests == 0 && waits == 0)
        currentStatus = .notDetermined
        let firstGrant = await run()
        precondition(firstGrant && requests == 1 && waits == 1)
        grant = false
        let firstDenial = await run()
        precondition(!firstDenial && requests == 2 && waits == 2)
        currentStatus = .authorized
        let recovered = await run()
        precondition(recovered && requests == 2 && waits == 2)
        print("PASS: repeated authorization, revocation, restriction, first grant/denial and recovery; no real TCC calls")
    }
}
