#if DEBUG
import Foundation

/// Explicit synthetic UI fixture, never selected by a release build or a normal launch.
actor SummaryUIFixture: LocalGenerationEngine {
    static var enabled: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("--ui-testing") && arguments.contains("--summary-fixture")
    }
    func readiness(language: SpokenLanguage) -> GenerationReadiness {
        .init(available: !ProcessInfo.processInfo.arguments.contains("--summary-unavailable"), detail: "Synthetic model unavailable")
    }
    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        if ProcessInfo.processInfo.arguments.contains("--summary-slow") { try await Task.sleep(for: .seconds(30)) }
        struct Input: Decodable { let id: Int; let text: String }
        let input = try JSONDecoder().decode([Input].self, from: Data(source.utf8))
        let items = input.prefix(6).map { ["kind": "point", "text": $0.text, "source": $0.id, "quote": $0.text] as [String: Any] }
        return String(decoding: try JSONSerialization.data(withJSONObject: ["items": items]), as: UTF8.self)
    }
}
#endif
