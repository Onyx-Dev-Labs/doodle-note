import SwiftUI
import SwiftData

/// "Ask anything" chat — over one meeting or across all recent meetings.
/// Conversations are in-memory per sheet (persistence is a follow-up).
struct ChatView: View {
    enum Scope {
        case meeting(Meeting)
        case global
    }

    let scope: Scope
    var initialQuestion: String?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [Message] = []
    @State private var input = ""
    @State private var busy = false
    @FocusState private var inputFocused: Bool

    struct Message: Identifiable {
        let id = UUID()
        var role: Role
        var text: String
        enum Role { case user, assistant, error }
    }

    private var title: String {
        switch scope {
        case .meeting(let meeting): meeting.displayTitle
        case .global: "Ask your meetings"
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            hint
                        }
                        ForEach(messages) { message in
                            bubble(message)
                        }
                        if busy {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Thinking…")
                                    .font(.footnote)
                                    .foregroundStyle(Color.stone)
                            }
                            .padding(.horizontal, 4)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .defaultScrollAnchor(messages.isEmpty ? .top : .bottom)

                inputBar
            }
            .background(Color.cream)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .tint(Color.sageDeep)
        .task {
            inputFocused = true
            if let initialQuestion, !initialQuestion.isEmpty {
                input = initialQuestion
                await send()
            }
        }
    }

    private var hint: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(scopeHint)
                .font(.subheadline)
                .foregroundStyle(Color.stone)
        }
        .padding(.top, 8)
    }

    private var scopeHint: String {
        switch scope {
        case .meeting:
            "Ask about this meeting — \"what did we decide?\", \"draft a follow-up email\". Answers use only this meeting's transcript and notes."
        case .global:
            "Ask across your recent meetings — \"list my open todos\", \"what did I promise the customer this week?\""
        }
    }

    @ViewBuilder
    private func bubble(_ message: Message) -> some View {
        switch message.role {
        case .user:
            Text(message.text)
                .font(.callout)
                .foregroundStyle(Color.cream)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.sageDeep, in: RoundedRectangle(cornerRadius: 16))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant:
            MarkdownText(markdown: message.text)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sand))
        case .error:
            Text(message.text)
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Ask anything", text: $input, axis: .vertical)
                .lineLimit(1...4)
                .focused($inputFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.sand))
                .onSubmit { Task { await send() } }

            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Color.sageDeep)
            }
            .disabled(busy || input.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.cardSoft)
    }

    private func send() async {
        let question = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, !busy else { return }
        input = ""
        messages.append(Message(role: .user, text: question))
        busy = true
        defer { busy = false }

        let history: [AskEngine.Exchange] = zip(
            messages.filter { $0.role == .user }.dropLast(),
            messages.filter { $0.role == .assistant }
        ).map { AskEngine.Exchange(question: $0.text, answer: $1.text) }

        do {
            let answer: String
            switch scope {
            case .meeting(let meeting):
                answer = try await AskEngine.ask(meeting: meeting, question: question, history: history)
            case .global:
                var descriptor = FetchDescriptor<Meeting>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
                descriptor.fetchLimit = 25
                let meetings = (try? context.fetch(descriptor)) ?? []
                answer = try await AskEngine.askGlobal(meetings: meetings, question: question, history: history)
            }
            messages.append(Message(role: .assistant, text: answer))
        } catch {
            messages.append(Message(role: .error, text: error.localizedDescription))
        }
    }
}
