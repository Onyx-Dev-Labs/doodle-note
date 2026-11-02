import XCTest

@testable import dictation_helper

final class DeliveryTests: XCTestCase {
    func testAnAppThatIgnoredAccessibilityIsRemembered() {
        let memory = AxNoOpMemory()
        XCTAssertFalse(memory.knows("com.example.web"))
        memory.remember("com.example.web")
        XCTAssertTrue(memory.knows("com.example.web"))
        XCTAssertFalse(memory.knows("com.example.native"), "only the app that ignored it")
    }

    func testAnEmptyBundleIdentifierIsNeverRemembered() {
        let memory = AxNoOpMemory()
        memory.remember("")
        XCTAssertFalse(memory.knows(""))
    }

    func testChromiumBasedAppsAreRecognizedByTheirShippedEngine() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("dn-\(UUID().uuidString).app")
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = root.appendingPathComponent(
            "Contents/Frameworks/Some Framework.framework/Resources")
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        XCTAssertFalse(WebEngine.detect(root), "a framework without Chromium data is not Chromium")
        FileManager.default.createFile(
            atPath: resources.appendingPathComponent("icudtl.dat").path, contents: Data())
        XCTAssertTrue(WebEngine.detect(root))
    }

    func testAnAppWithNoFrameworksOrNoBundleIsNotChromium() {
        XCTAssertFalse(WebEngine.detect(nil))
        XCTAssertFalse(WebEngine.detect(URL(fileURLWithPath: "/nonexistent/Thing.app")))
    }

    func testTimingsReportDurationsAndTheSkipFlagOnly() {
        var timings = DeliveryTimings()
        timings.confirmMs = 12
        timings.skippedAx = true
        let result = DeliveryResult(outcome: .delivered, method: "paste", timings: timings)
        let reported = result.fields["timings"] as? [String: Any]
        XCTAssertEqual(reported?["confirmMs"] as? Int, 12)
        XCTAssertEqual(reported?["skippedAx"] as? Bool, true)
        XCTAssertEqual(Set(reported?.keys ?? [:].keys),
            ["validateMs", "insertMs", "confirmMs", "settleMs", "skippedAx"])
    }
}
