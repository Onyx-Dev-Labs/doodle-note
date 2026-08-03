import XCTest
@testable import DoodleNote

final class AskEngineTests: XCTestCase {
    @MainActor
    func testNamedMeetingWinsOverNewerUnrelatedMeetings() {
        let target = meeting(
            title: "Jordan Conley IT Consultation | Celebration Community Church",
            notes: "Sean will prepare the managed services proposal.",
            age: 5
        )
        let newest = meeting(
            title: "Turnkey Estimator Prototype Demo",
            notes: "Roofing estimator API follow-up.",
            age: 1
        )

        let result = AskEngine.prioritizedGlobalMeetings(
            [newest, target],
            question: "What are my to dos from the meeting with celebration church?"
        )

        XCTAssertEqual(result.map(\.id), [target.id])
    }

    @MainActor
    func testNotesMatchFindsRelevantMeetingWhenTitleDoesNotMatch() {
        let target = meeting(
            title: "Weekly customer call",
            notes: "Follow up with Celebration Community Church about the proposal.",
            age: 3
        )
        let unrelated = meeting(
            title: "Internal planning",
            notes: "Review next quarter's hiring plan.",
            age: 1
        )

        let result = AskEngine.prioritizedGlobalMeetings(
            [unrelated, target],
            question: "What did we promise Celebration Church?"
        )

        XCTAssertEqual(result.map(\.id), [target.id])
    }

    @MainActor
    func testGenericQuestionKeepsRecentMeetingOrder() {
        let newest = meeting(title: "Newest", notes: "Alpha", age: 1)
        let older = meeting(title: "Older", notes: "Beta", age: 2)

        let result = AskEngine.prioritizedGlobalMeetings(
            [older, newest],
            question: "What are my open action items?"
        )

        XCTAssertEqual(result.map(\.id), [newest.id, older.id])
    }

    @MainActor
    private func meeting(title: String, notes: String, age: TimeInterval) -> Meeting {
        let meeting = Meeting(title: title, createdAt: Date(timeIntervalSinceNow: -age))
        meeting.generatedNotes = notes
        return meeting
    }
}
