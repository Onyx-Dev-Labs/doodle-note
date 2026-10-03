import Foundation

extension NoteRecord {
    /// Local review provenance never grants authority to changed cloud text.
    mutating func preserveLocalTranscript(from old: NoteRecord, sources: inout [NoteRevision]) {
        speechSessions = old.speechSessions
        transcriptNeedsReview = old.transcriptNeedsReview
        transcriptCloudReviewRequired = old.transcriptCloudReviewRequired
        transcriptCorrectionSources = old.transcriptCorrectionSources
        func matches(_ first: TranscriptPassage, _ second: TranscriptPassage) -> Bool {
            first.id == second.id && first.text == second.text &&
                (first.start * 1000).rounded() == (second.start * 1000).rounded() &&
                (first.end * 1000).rounded() == (second.end * 1000).rounded()
        }
        for corrected in old.passages where corrected.isUserEdited == true {
            if let index = passages.firstIndex(where: { matches($0, corrected) }) {
                passages[index].isUserEdited = true
                // Only augment a new source copy; existing revisions remain byte-for-byte immutable.
                for sourceIndex in sources.indices {
                    for passageIndex in sources[sourceIndex].passages.indices
                    where matches(sources[sourceIndex].passages[passageIndex], corrected) {
                        sources[sourceIndex].passages[passageIndex].isUserEdited = true
                    }
                }
            } else if let metadata = old.metadata {
                let anchor = SourceAnchor(libraryID: metadata.libraryID, noteID: old.id,
                                          revisionID: metadata.revisionID, content: .transcript(corrected.id))
                var anchors = transcriptCorrectionSources ?? []
                if !anchors.contains(anchor) { anchors.append(anchor) }
                transcriptCorrectionSources = anchors
                transcriptCloudReviewRequired = true
                transcriptNeedsReview = true
            }
        }
        if transcriptCloudReviewRequired == true || transcriptNeedsReview == true {
            metadata?.cloudTranscriptStatus = .partial
        }
    }

    mutating func acknowledgeTranscriptCloudReview() {
        transcriptCloudReviewRequired = false
        // A human acknowledgement is not successful speech processing.
        metadata?.cloudTranscriptStatus = .partial
    }
}
