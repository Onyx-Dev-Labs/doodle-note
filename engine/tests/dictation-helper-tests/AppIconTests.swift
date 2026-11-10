import XCTest

@testable import dictation_helper

final class AppIconTests: XCTestCase {
    func testAnInstalledAppGivesAPngOfTheRequestedSize() throws {
        let data = try XCTUnwrap(AppIcon.png(path: "/System/Applications/TextEdit.app", pixels: 48))
        XCTAssertEqual(Array(data.prefix(8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "a PNG")
        let image = try XCTUnwrap(NSBitmapImageRep(data: data))
        XCTAssertEqual(image.pixelsWide, 48)
        XCTAssertEqual(image.pixelsHigh, 48)
    }

    func testOnlyAnAbsoluteAppBundlePathIsRead() {
        XCTAssertNil(AppIcon.png(path: "/etc/hosts"), "not an app bundle")
        XCTAssertNil(AppIcon.png(path: "Applications/Safari.app"), "not absolute")
        XCTAssertNil(AppIcon.png(path: "/Applications/Not A Real App.app"), "does not exist")
        XCTAssertNil(AppIcon.png(path: ""))
    }
}
