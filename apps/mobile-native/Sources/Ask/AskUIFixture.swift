#if DEBUG
import Foundation
/// Explicit synthetic evidence selector for repeatable UI testing, never normal or release inference.
/// Mirrors AskTestEngine(.relevant) so UI and unit fixtures stay aligned.
actor AskUIFixture: LocalGenerationEngine {
    private static var arguments: [String] { ProcessInfo.processInfo.arguments }
    static var enabled: Bool {
        arguments.contains("--ui-testing") && arguments.contains("--ask-fixture")
    }

    func readiness(language: SpokenLanguage) -> GenerationReadiness {
        .init(available: !Self.arguments.contains("--ask-unavailable"), detail: "Synthetic model unavailable")
    }

    func generate(instructions: String, source: String, language: SpokenLanguage, contract: LocalGenerationContract) async throws -> String {
        try await generate(instructions: instructions, source: source, language: language)
    }

    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        if Self.arguments.contains("--ask-slow") { try await Task.sleep(for: .seconds(30)) }
        let value = try JSONSerialization.jsonObject(with: Data(source.utf8)) as! [String: Any]
        if let text = value["source"] as? String {
            return String(decoding: try JSONSerialization.data(withJSONObject: ["quotes": [text]]), as: UTF8.self)
        }
        if let evidence = value["evidence"] as? [[String: Any]] {
            let claims = evidence.map { ["text": $0["text"]!, "citations": [["source": $0["source"]!, "quote": $0["text"]!]]] }
            return String(decoding: try JSONSerialization.data(withJSONObject: ["claims": claims]), as: UTF8.self)
        }
        return "{\"quotes\":[]}"
    }
}
#endif
