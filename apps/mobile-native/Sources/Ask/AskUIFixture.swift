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
        let data = try JSONSerialization.jsonObject(with: Data(source.utf8)) as! [String: Any]
        if let text = data["source"] as? String {
            return String(decoding: try JSONSerialization.data(withJSONObject: ["quotes": [text]]), as: UTF8.self)
        }
        if let evidence = data["evidence"] as? [[String: Any]] {
            let claims = evidence.map { ["text": $0["text"]!, "citations": [["source": $0["source"]!, "quote": $0["text"]!]]] }
            return String(decoding: try JSONSerialization.data(withJSONObject: ["claims": claims]), as: UTF8.self)
        }
        return "{\"census\":\"none\"}"

    }
}
#endif
