import XCTest
@testable import DoodleNoteNative

private actor LegacyStructuredEngine: LocalGenerationEngine {
    enum Failure: Error { case sentinel }
    var shouldThrow = false
    private(set) var requests: [(String, String, SpokenLanguage)] = []
    func readiness(language: SpokenLanguage) -> GenerationReadiness { .init(available: true, detail: "Fixture") }
    func failNext() { shouldThrow = true }
    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        requests.append((instructions, source, language))
        if shouldThrow { throw Failure.sentinel }
        return source
    }
}

private actor ContractSummaryEngine: LocalGenerationEngine {
    private(set) var contracts: [LocalGenerationContract] = []
    func readiness(language: SpokenLanguage) -> GenerationReadiness { .init(available: true, detail: "Fixture") }
    func generate(instructions: String, source: String, language: SpokenLanguage) async throws -> String {
        XCTFail("A summary must select its structured response contract")
        return "invalid"
    }
    func generate(instructions: String, source: String, language: SpokenLanguage, contract: LocalGenerationContract) async throws -> String {
        contracts.append(contract)
        return #"{"items":[{"kind":"point","text":"Review exports.","source":1,"quote":"Review exports."}]}"#
    }
}

final class StructuredGenerationTests: XCTestCase {
    func testLegacyEngineReceivesEveryContractWithoutChangingItsPayload() async throws {
        let legacy = LegacyStructuredEngine()
        let engine: any LocalGenerationEngine = legacy
        for contract in LocalGenerationContract.allCases {
            let response = try await engine.generate(instructions: "Keep exact quotes", source: "Original Danish evidence", language: .danish, contract: contract)
            XCTAssertEqual(response, "Original Danish evidence")
        }
        let requests = await legacy.requests
        XCTAssertEqual(requests.count, 3)
        XCTAssertTrue(requests.allSatisfy { $0.0 == "Keep exact quotes" && $0.1 == "Original Danish evidence" && $0.2 == .danish })
    }

    func testLegacyEngineFailurePropagatesWithoutRetryOrFallback() async throws {
        let legacy = LegacyStructuredEngine()
        await legacy.failNext()
        let engine: any LocalGenerationEngine = legacy
        do {
            _ = try await engine.generate(instructions: "", source: "Source", language: .english, contract: .summary)
            XCTFail("Expected the original engine failure")
        } catch LegacyStructuredEngine.Failure.sentinel { }
        let requests = await legacy.requests
        XCTAssertEqual(requests.count, 1)
    }

    func testSummarySelectsStructuredOverloadThroughProtocolAndKeepsCitation() async throws {
        let engine = ContractSummaryEngine()
        var note = NoteRecord(); note.text = "Review exports."
        let draft = try await SummaryGenerator(engine: engine).generate(note: note, format: .general, language: .english) { _, _ in }
        let contracts = await engine.contracts
        XCTAssertEqual(contracts, [.summary])
        XCTAssertEqual(draft.sources.first?.content, .personalParagraph(0))
        XCTAssertTrue(draft.text.contains("Review exports. [1]"))
        XCTAssertTrue(draft.text.contains("> Review exports."))
    }
}
