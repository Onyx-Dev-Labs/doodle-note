import SwiftUI

/// Settings section for Verified Caller ID: verify your own number once and
/// outbound DoodleNote calls display it instead of the shared workspace
/// number. Flow: enter number → Twilio calls it and we show a 6-digit code →
/// answer and enter the code on the keypad → verified.
struct CallerIdSection: View {
    @State private var sync = SyncEngine.shared

    enum Phase: Equatable {
        case loading
        case none
        case entering
        case awaitingCode(code: String, number: String)
        case verified(String)
        case error(String)
    }

    @State private var phase: Phase = .loading
    @State private var number = "+1"
    @State private var busy = false

    var body: some View {
        if sync.isLinked {
            Section {
                content
            } header: {
                Text("Caller ID")
            } footer: {
                footerText
            }
            .task { await refresh() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            HStack { Text("Caller ID"); Spacer(); ProgressView() }

        case .none, .error:
            Button("Use my number as caller ID") { phase = .entering }
            if case .error(let message) = phase {
                Text(message).font(.footnote).foregroundStyle(.red)
            }

        case .entering:
            TextField("+16145551234", text: $number)
                .keyboardType(.phonePad)
                .font(.body.monospacedDigit())
            Button {
                Task { await startVerification() }
            } label: {
                HStack {
                    Text("Verify — Twilio will call this number")
                    if busy { Spacer(); ProgressView() }
                }
            }
            .disabled(busy || !isValid)

        case .awaitingCode(let code, let verifyingNumber):
            VStack(alignment: .leading, spacing: 6) {
                Text("Answer the call to \(verifyingNumber) and enter:")
                    .font(.footnote)
                    .foregroundStyle(Color.stone)
                Text(code)
                    .font(.system(size: 34, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.ink)
                HStack(spacing: 6) {
                    ProgressView()
                    Text("Waiting for verification…")
                        .font(.footnote)
                        .foregroundStyle(Color.stone)
                }
            }
            .padding(.vertical, 4)
            Button("Cancel", role: .destructive) {
                Task { await remove() }
            }

        case .verified(let verifiedNumber):
            LabeledContent("Your calls show") { Text(verifiedNumber) }
            Button("Stop using my number", role: .destructive) {
                Task { await remove() }
            }
        }
    }

    private var footerText: Text {
        switch phase {
        case .verified:
            Text("People you call see your own number and can call you back on it.")
        default:
            Text("Without this, calls show the shared DoodleNote number. Verifying takes one short automated call.")
        }
    }

    private var isValid: Bool {
        let digits = number.filter(\.isNumber)
        return digits.count >= 7 && digits.count <= 15
    }

    // MARK: Actions

    private func refresh() async {
        do {
            let state = try await sync.callerIdAPI().callerIdStatus()
            apply(state)
        } catch {
            phase = .none
        }
    }

    private func startVerification() async {
        busy = true
        defer { busy = false }
        let normalized = "+" + number.filter(\.isNumber)
        do {
            let state = try await sync.callerIdAPI()
                .requestCallerIdVerification(phoneNumber: normalized)
            if state.status == "verified" {
                phase = .verified(state.phoneNumber ?? normalized)
            } else if let code = state.validationCode {
                phase = .awaitingCode(code: code, number: normalized)
                await pollUntilVerified()
            } else {
                phase = .error("Verification did not start. Try again.")
            }
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    /// Twilio's validation call gives the user ~90 seconds to enter the code.
    private func pollUntilVerified() async {
        for _ in 0..<30 {
            try? await Task.sleep(for: .seconds(4))
            guard case .awaitingCode = phase else { return }
            if let state = try? await sync.callerIdAPI().callerIdStatus(),
               state.status == "verified" {
                phase = .verified(state.phoneNumber ?? "")
                return
            }
        }
        if case .awaitingCode = phase {
            phase = .error("The verification call timed out. Try again.")
        }
    }

    private func remove() async {
        try? await sync.callerIdAPI().deleteCallerId()
        phase = .none
    }

    private func apply(_ state: SyncAPI.CallerIdState) {
        switch state.status {
        case "verified": phase = .verified(state.phoneNumber ?? "")
        case "pending": phase = .none
        default: phase = .none
        }
    }
}
