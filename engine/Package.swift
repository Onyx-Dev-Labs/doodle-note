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
        ),
        // Original macOS delivery helper for system-wide dictation: target
        // identity, validated text insertion and hold-key detection. Kept out of
        // the `engine` target so it carries no speech models and starts instantly.
        .executableTarget(
            name: "dictation-helper",
            path: "Sources/dictation-helper",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        // Hold-key decision logic (taps, holds, chords, a lost release, Fn).
        // Run with `swift test --filter HoldMachineTests`.
        .testTarget(
            name: "dictation-helper-tests",
            dependencies: ["dictation-helper"],
            path: "tests/dictation-helper-tests",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        )
    ]
)
