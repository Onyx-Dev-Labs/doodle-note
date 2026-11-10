import XCTest

@testable import dictation_helper

final class AppInfoTests: XCTestCase {
    func testAnInstalledAppGivesItsNameAndIcon() throws {
        let info = AppInfo.lookup(bundleId: "com.apple.finder")
        XCTAssertEqual(info["bundleId"] as? String, "com.apple.finder")
        XCTAssertEqual(info["name"] as? String, "Finder")
        let png = try XCTUnwrap(info["png"] as? String)
        XCTAssertFalse(png.isEmpty)
    }

    func testAnAppThatIsNotInstalledOrAnEmptyIdGivesNothingElse() {
        for id in ["com.example.not-installed-anywhere", "", String(repeating: "a", count: 300)] {
            let info = AppInfo.lookup(bundleId: id)
            XCTAssertNil(info["name"], id)
            XCTAssertNil(info["png"], id)
        }
    }
}
