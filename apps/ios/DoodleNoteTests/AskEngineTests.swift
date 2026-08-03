import XCTest
@testable import DoodleNote

final class AskEngineTests: XCTestCase {
    func testNamedMeetingWinsOverNewerUnrelatedMeetings() {
        let target = meeting(
            title: "Jordan Conley IT Consultation | Celebration Community Church",
            generated: "Sean will prepare the managed services proposal.",
            daysAgo: 5
        )
        let newest = meeting(
            title: "Turnkey Estimator Prototype Demo",
            generated: "Roofing estimator API follow-up.",
            daysAgo: 1
        )

        let result = retrieve(
            [newest, target],
            question: "What are my to dos from the meeting with celebration church?"
        )

        XCTAssertEqual(result.selectedMeetingIDs, [target.id])
        XCTAssertTrue(result.allChunks.contains { $0.text.contains("managed services proposal") })
    }

    func testRoughNotesRemainSearchableWhenGeneratedNotesExist() {
        let target = meeting(
            title: "Celebration Community Church",
            generated: "Managed services proposal and security review.",
            rough: "Replace the wifi access points before the office move.",
            daysAgo: 2
        )

        let result = retrieve(
            [target],
            question: "What did Celebration Church say about Wi-Fi?"
        )

        XCTAssertTrue(result.allChunks.contains {
            $0.source == .roughNotes && $0.text.contains("wifi")
        })
    }

    func testGeneratedNotesCanFindMeetingWhenTitleDoesNotMatch() {
        let target = meeting(
            title: "Weekly customer call",
            generated: "Follow up with Celebration Community Church about the proposal.",
            daysAgo: 3
        )
        let unrelated = meeting(
            title: "Internal planning",
            generated: "Review next quarter's hiring plan.",
            daysAgo: 1
        )

        let result = retrieve(
            [unrelated, target],
            question: "What did we promise Celebration Church?"
        )

        XCTAssertEqual(result.selectedMeetingIDs.first, target.id)
        XCTAssertTrue(result.allChunks.contains {
            $0.meetingID == target.id && $0.text.contains("Celebration Community Church")
        })
    }

    func testFullTranscriptRemainsSearchableWhenGeneratedNotesExist() {
        let target = meeting(
            title: "XChange Security 2026 Prep Call",
            generated: "Reviewed the presentation and event schedule.",
            segments: [
                .init(
                    speaker: "Speaker",
                    text: "Cody will present the threat landscape slides on Friday.",
                    startMs: 15_040,
                    endMs: 19_000
                ),
            ],
            daysAgo: 4
        )

        let result = retrieve(
            [target],
            question: "What did Cody say in the XChange Security prep call?"
        )

        XCTAssertTrue(result.allChunks.contains {
            $0.source == .transcript && $0.text.contains("Cody")
        })
    }

    func testExhaustiveActionQuestionKeepsEveryMatchingMeetingAcrossBatches() {
        let meetings = (1...4).map { index in
            meeting(
                title: "Customer \(index)",
                generated: """
                ## Action Items
                - Owner \(index) will send the proposal and schedule the follow-up review.
                \(String(repeating: "Supporting action-item detail. ", count: 14))
                """,
                daysAgo: index
            )
        }

        let result = retrieve(
            meetings,
            question: "What are all my open action items?",
            maxBatchChars: 1_000
        )

        XCTAssertTrue(result.isExhaustive)
        XCTAssertGreaterThan(result.batches.count, 1)
        XCTAssertEqual(Set(result.selectedMeetingIDs), Set(meetings.map(\.id)))
        XCTAssertEqual(Set(result.allChunks.map(\.meetingID)), Set(meetings.map(\.id)))
    }

    func testThisWeekUsesMeetingDatesInsteadOfMatchingWeeklyInTitle() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 8, day: 5, hour: 12
        )))
        let thisWeek = meeting(
            title: "Customer review",
            generated: "## Action Items\n- Send the revised quote.",
            createdAt: try XCTUnwrap(calendar.date(byAdding: .day, value: -1, to: now))
        )
        let olderWeekly = meeting(
            title: "Weekly coaching",
            generated: "## Action Items\n- Update the coaching plan.",
            createdAt: try XCTUnwrap(calendar.date(byAdding: .day, value: -14, to: now))
        )

        let result = AskRetrieval.retrieve(
            meetings: [olderWeekly, thisWeek],
            question: "What were all my action items this week?",
            maxBatchChars: 6_000,
            now: now,
            calendar: calendar,
            useSemanticSearch: false
        )

        XCTAssertEqual(result.selectedMeetingIDs, [thisWeek.id])
        XCTAssertFalse(result.allChunks.contains { $0.meetingID == olderWeekly.id })
    }

    func testFollowUpQuestionKeepsPriorMeetingScope() {
        let target = meeting(
            title: "Celebration Community Church",
            generated: "The proposal deadline is Friday.",
            daysAgo: 3
        )
        let recent = meeting(
            title: "Internal planning",
            generated: "The hiring review is due Monday.",
            daysAgo: 1
        )

        let result = AskRetrieval.retrieve(
            meetings: [recent, target],
            question: "What was the deadline?",
            history: ["Previous question: What did we promise Celebration Church?"],
            maxBatchChars: 6_000,
            useSemanticSearch: false
        )

        XCTAssertEqual(result.selectedMeetingIDs, [target.id])
        XCTAssertTrue(result.allChunks.contains { $0.text.contains("Friday") })
    }

    func testMeetingOlderThanFormerTwentyFiveItemLimitCanBeRetrieved() {
        let recent = (1...30).map { index in
            meeting(title: "Recent \(index)", generated: "General planning notes.", daysAgo: index)
        }
        let olderTarget = meeting(
            title: "Bluebird Clinic Migration",
            generated: "Move the firewall during the Saturday maintenance window.",
            daysAgo: 60
        )

        let result = retrieve(
            recent + [olderTarget],
            question: "What is the plan for the Bluebird Clinic migration?"
        )

        XCTAssertEqual(result.selectedMeetingIDs, [olderTarget.id])
    }

    func testLastMeetingActionQuestionDoesNotExpandAcrossCorpus() {
        let newest = meeting(
            title: "Newest customer call",
            generated: "## Action Items\n- Send the revised agreement.",
            daysAgo: 1
        )
        let older = meeting(
            title: "Older customer call",
            generated: "## Action Items\n- Schedule the migration.",
            daysAgo: 4
        )

        let result = retrieve(
            [older, newest],
            question: "What are my action items from my last meeting?"
        )

        XCTAssertFalse(result.isExhaustive)
        XCTAssertEqual(result.selectedMeetingIDs, [newest.id])
        XCTAssertFalse(result.allChunks.contains { $0.meetingID == older.id })
    }

    func testRenderedEvidenceStaysWithinBatchBudget() {
        let target = meeting(
            title: "Long planning meeting",
            generated: "## Action Items\n" + String(repeating: "- Complete a detailed task.\n", count: 200),
            daysAgo: 1
        )

        let result = retrieve(
            [target],
            question: "What are all the action items?",
            maxBatchChars: 1_500
        )

        XCTAssertFalse(result.batches.isEmpty)
        for batch in result.batches {
            XCTAssertLessThanOrEqual(result.render(batch).count, 1_650)
            XCTAssertTrue(batch.allSatisfy { $0.text.count <= 900 })
        }
    }

    func testAnswerIncludesDeterministicMeetingSources() {
        let target = meeting(
            title: "Celebration Community Church",
            generated: "Sean will send the proposal.",
            daysAgo: 2
        )

        let result = retrieve(
            [target],
            question: "What did we promise Celebration Church?"
        )
        let attributed = result.attributed("Send the proposal.")

        XCTAssertTrue(attributed.contains("**Sources**"))
        XCTAssertTrue(attributed.contains("[M1] Celebration Community Church"))
    }

    private func retrieve(
        _ meetings: [AskMeetingSnapshot],
        question: String,
        maxBatchChars: Int = 6_000
    ) -> AskRetrievalResult {
        AskRetrieval.retrieve(
            meetings: meetings,
            question: question,
            maxBatchChars: maxBatchChars,
            useSemanticSearch: false
        )
    }

    private func meeting(
        title: String,
        generated: String,
        rough: String = "",
        segments: [AskMeetingSnapshot.TranscriptSegment] = [],
        daysAgo: Int
    ) -> AskMeetingSnapshot {
        meeting(
            title: title,
            generated: generated,
            rough: rough,
            segments: segments,
            createdAt: Date(timeIntervalSinceNow: -Double(daysAgo) * 86_400)
        )
    }

    private func meeting(
        title: String,
        generated: String,
        rough: String = "",
        segments: [AskMeetingSnapshot.TranscriptSegment] = [],
        createdAt: Date
    ) -> AskMeetingSnapshot {
        AskMeetingSnapshot(
            id: UUID(),
            title: title,
            createdAt: createdAt,
            generatedNotes: generated,
            roughNotes: rough,
            segments: segments
        )
    }
}
