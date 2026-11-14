import Foundation
import FoundationModels

/// Output shape only. Callers must still validate bounds, source membership and access.
enum LocalGenerationContract: CaseIterable, Equatable, Sendable {
    case summary, askEvidence, askSynthesis
}

@Generable
struct StructuredSummary: Codable {
    @Generable
    enum Kind: String, Codable { case point, decision, action }

    @Generable
    struct Item: Codable {
        @Guide(description: "Copy the integer id of the supplied fragment. Never invent an ID.")
        var source: Int
        @Guide(description: "First select a nonempty exact quote stating a substantive point, decision or agreed action. Copy the sentence that actually states it, in its original language.")
        var quote: String
        var kind: Kind
        @Guide(description: "Briefly summarize only the selected quote. Every fact in this claim must be stated by that quote.")
        var text: String
    }

    @Guide(.maximumCount(6))
    var items: [Item]
}

@Generable
struct StructuredAskEvidence: Codable {
    @Guide(description: "Exact verbatim substrings of the supplied source that help answer the question. Return an empty array if none.", .maximumCount(8))
    var quotes: [String]
}

@Generable
struct StructuredAskSynthesis: Codable {
    @Generable
    struct Citation: Codable {
        @Guide(description: "Copy the integer source ID from the supplied evidence. Never invent an ID.")
        var source: Int
        @Guide(description: "Exact original quote from the cited evidence supporting the claim.")
        var quote: String
    }

    @Generable
    struct Claim: Codable {
        @Guide(description: "Answer the question using only the supplied evidence. Do not infer missing people, owners or dates.")
        var text: String
        @Guide(.count(1...8))
        var citations: [Citation]
    }

    @Guide(.maximumCount(8))
    var claims: [Claim]
}
