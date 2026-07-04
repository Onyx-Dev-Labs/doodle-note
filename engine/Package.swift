// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "engine",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.15.4")
    ],
    targets: [
        .executableTarget(
            name: "engine",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        )
    ]
)
