#if DEBUG
import Foundation
/// Explicit synthetic evidence selector for repeatable UI testing, never normal or release inference.
actor AskUIFixture: LocalGenerationEngine {
    static var enabled: Bool { CommandLine.arguments.contains("--ui-testing") && CommandLine.arguments.contains("--ask-fixture") }
    func readiness(language: SpokenLanguage) -> GenerationReadiness {
        .init(available: !CommandLine.arguments.contains("--ask-unavailable"), detail: "Synthetic model unavailable")
    }
    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        if CommandLine.arguments.contains("--ask-slow") { try await Task.sleep(for: .seconds(30)) }
        let data = try JSONSerialization.jsonObject(with: Data(source.utf8)) as! [String: String]
        return String(decoding: try JSONSerialization.data(withJSONObject: ["quotes": [data["source"]!]]), as: UTF8.self)
    }
}
#endif
