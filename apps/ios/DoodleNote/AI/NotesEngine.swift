import Foundation
import FoundationModels

struct NotesInput {
    var title: String
    var roughNotes: String
    var segments: [(speaker: String, text: String, startMs: Int)]
    var durationMs: Int?
    var templateId: String
}

enum NotesEngineChoice: String, CaseIterable, Identifiable {
    case onDevice
    case byok

    var id: String { rawValue }

    var label: String {
        switch self {
        case .onDevice: "On-device (Apple Intelligence)"
        case .byok: "My own API key (Anthropic)"
        }
    }
}

enum NotesError: LocalizedError {
    case onDeviceUnavailable(String)
    case missingAPIKey
    case apiFailure(String)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .onDeviceUnavailable(let reason):
            "The on-device model isn't available: \(reason) You can add an Anthropic API key in Settings instead."
        case .missingAPIKey:
            "Add your Anthropic API key in Settings to generate notes with a cloud model."
        case .apiFailure(let detail):
            "Note generation failed: \(detail)"
        case .emptyResponse:
            "The model returned no notes. Try again."
        }
    }
}

protocol NotesEngine {
    func generate(_ input: NotesInput) async throws -> String
}

enum NotesEngineFactory {
    /// Same ordering as desktop: local model is the default; BYOK is opt-in.
    static func make() -> NotesEngine {
        let choice = NotesEngineChoice(
            rawValue: UserDefaults.standard.string(forKey: "notesEngine") ?? "onDevice"
        ) ?? .onDevice
        switch choice {
        case .onDevice: return FoundationModelsEngine()
        case .byok: return AnthropicEngine()
        }
    }
}

// MARK: - On-device (Apple Foundation Models)

/// Free, private, works with no account — the default, matching the product's
/// local-first ordering. The system model's context is small (~4K tokens), so
/// the transcript is head/tail-trimmed to fit.
struct FoundationModelsEngine: NotesEngine {
    func generate(_ input: NotesInput) async throws -> String {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            break
        case .unavailable(let reason):
            throw NotesError.onDeviceUnavailable(describe(reason))
        }

        let session = LanguageModelSession(
            instructions: NotePrompt.systemPrompt(templateId: input.templateId)
        )
        let message = NotePrompt.userMessage(
            title: input.title,
            roughNotes: input.roughNotes,
            segments: input.segments,
            durationMs: input.durationMs,
            maxTranscriptChars: 6_000
        )
        let response = try await session.respond(to: message)
        let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw NotesError.emptyResponse }
        return text
    }

    private func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            "this device doesn't support Apple Intelligence."
        case .appleIntelligenceNotEnabled:
            "Apple Intelligence is turned off in Settings."
        case .modelNotReady:
            "the model is still downloading — try again in a minute."
        @unknown default:
            "it's unavailable right now."
        }
    }
}

// MARK: - BYOK (Anthropic Messages API)

/// Bring-your-own-key path, calling the Anthropic Messages API directly.
/// Swift has no official Anthropic SDK, so this is a thin raw-HTTP client.
struct AnthropicEngine: NotesEngine {
    static let defaultModel = "claude-opus-4-8"

    func generate(_ input: NotesInput) async throws -> String {
        guard let apiKey = Keychain.read(key: .anthropicAPIKey), !apiKey.isEmpty else {
            throw NotesError.missingAPIKey
        }
        let model = UserDefaults.standard.string(forKey: "byokModel").flatMap {
            $0.isEmpty ? nil : $0
        } ?? Self.defaultModel

        let message = NotePrompt.userMessage(
            title: input.title,
            roughNotes: input.roughNotes,
            segments: input.segments,
            durationMs: input.durationMs,
            maxTranscriptChars: 300_000
        )

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = 300

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 4096,
            "system": NotePrompt.systemPrompt(templateId: input.templateId),
            "messages": [["role": "user", "content": message]],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NotesError.apiFailure("no response")
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

        guard http.statusCode == 200 else {
            let detail =
                ((json?["error"] as? [String: Any])?["message"] as? String)
                ?? "HTTP \(http.statusCode)"
            throw NotesError.apiFailure(detail)
        }

        if let stopReason = json?["stop_reason"] as? String, stopReason == "refusal" {
            throw NotesError.apiFailure("the model declined this request")
        }
        guard
            let content = json?["content"] as? [[String: Any]],
            let text = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String,
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw NotesError.emptyResponse
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
