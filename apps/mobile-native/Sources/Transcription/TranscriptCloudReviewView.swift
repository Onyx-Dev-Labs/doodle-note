import SwiftUI

struct TranscriptCloudReviewView: View {
    let note: NoteRecord
    @Bindable var library: NoteLibrary
    @State private var originals: [String] = []
    @State private var opened = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cloud changes affect a previous correction. Review the original correction in history before retrying.")
                .font(.caption).foregroundStyle(.orange)
            Button("Show original corrections") {
                let generation = library.authenticationGeneration
                let revision = note.metadata?.revisionID
                Task {
                    do {
                        var values: [String] = []
                        for anchor in note.transcriptCorrectionSources ?? [] {
                            guard let value = try await library.resolveSearchSource(anchor) else { throw TranscriptFailure.stale }
                            values.append(value)
                        }
                        guard generation == library.authenticationGeneration,
                              library.note(note.id)?.metadata?.revisionID == revision else { return }
                        originals = values; opened = !values.isEmpty; problem = nil
                    } catch {
                        guard generation == library.authenticationGeneration else { return }
                        problem = "The original correction is unavailable. Keep the transcript review pending."
                    }
                }
            }
            ForEach(Array(originals.enumerated()), id: \.offset) { _, text in Text(text).textSelection(.enabled) }
            if let problem { Text(L10n.message(problem)).foregroundStyle(.orange) }
            Button("Acknowledge transcript review") {
                guard library.note(note.id)?.metadata?.revisionID == note.metadata?.revisionID else { return }
                library.update(note.id) { $0.acknowledgeTranscriptCloudReview() }
            }.disabled(!opened || note.metadata?.cloudReadOnly == true)
        }
        .onChange(of: note.metadata?.revisionID) { _, _ in originals = []; opened = false; problem = nil }
        .onChange(of: library.authenticationGeneration) { _, _ in originals = []; opened = false; problem = nil }
    }
}
