import SwiftUI
import SwiftData

/// Outbound phone calls: dial a number, watch the live two-sided transcript,
/// and land in the meeting when you hang up.
struct DialerView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var service = PhoneCallService()
    @State private var number = "+1"
    var onOpenMeeting: (Meeting) -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch service.state {
                case .idle:
                    dialPad
                case .preparing(let status):
                    statusView(icon: "phone.badge.waveform", text: status, spinner: true)
                case .ringing:
                    inCall(status: "Calling \(number)…")
                case .connected(let since):
                    inCall(status: nil, connectedSince: since)
                case .ended(let error):
                    endedView(error: error)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.cream)
            .navigationTitle("Phone call")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !service.isActive {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .interactiveDismissDisabled(service.isActive)
        }
        .tint(Color.sageDeep)
    }

    private func statusView(icon: String, text: String, spinner: Bool) -> some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundStyle(Color.sage)
            if spinner { ProgressView().tint(Color.sageDeep) }
            Text(text)
                .font(.headline)
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    // MARK: Dial pad

    private var dialPad: some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "phone.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(Color.sage)
            Text("Call from DoodleNote")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.ink)
            Text("The call is bridged through your workspace's number. Both sides are transcribed on your phone — notes, action items, and follow-ups like any meeting.")
                .font(.footnote)
                .foregroundStyle(Color.bark)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            TextField("+15551234567", text: $number)
                .keyboardType(.phonePad)
                .font(.title2.monospacedDigit())
                .multilineTextAlignment(.center)
                .padding(.vertical, 12)
                .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sand))
                .padding(.horizontal, 40)

            Button {
                Task { await service.dial(number: normalized, context: context) }
            } label: {
                Label("Call", systemImage: "phone.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(validNumber ? Color.sageDeep : Color.stone, in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(Color.cream)
            }
            .disabled(!validNumber)
            .padding(.horizontal, 40)

            Text("Outbound calls only — standard add-on rates apply.")
                .font(.caption)
                .foregroundStyle(Color.stone)
            Spacer()
        }
    }

    private var normalized: String {
        "+" + number.filter(\.isNumber)
    }

    private var validNumber: Bool {
        let digits = number.filter(\.isNumber)
        return digits.count >= 7 && digits.count <= 15
    }

    // MARK: In-call

    private func inCall(status: String?, connectedSince: Date? = nil) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "waveform.and.person.filled")
                .font(.system(size: 44))
                .foregroundStyle(Color.sage)
            if let status {
                Text(status).font(.headline).foregroundStyle(Color.ink)
            } else if let connectedSince {
                ElapsedTimeText(since: connectedSince)
                    .font(.title2.monospacedDigit().weight(.medium))
                    .foregroundStyle(Color.ink)
            }

            VStack(alignment: .leading, spacing: 10) {
                livePartialRow(label: "You", text: service.youPartial)
                livePartialRow(label: "Them", text: service.themPartial)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sand))
            .padding(.horizontal, 24)

            Text("Transcribing on this phone — nothing is uploaded.")
                .font(.caption)
                .foregroundStyle(Color.stone)

            Spacer()

            Button {
                service.hangUp()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.title2)
                    .frame(width: 64, height: 64)
                    .background(.red, in: Circle())
                    .foregroundStyle(.white)
            }
            .padding(.bottom, 30)
        }
    }

    private func livePartialRow(label: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(label == "You" ? Color.sageDeep : Color.stone)
                .frame(width: 40, alignment: .leading)
            Text(text.isEmpty ? "…" : text)
                .font(.callout)
                .foregroundStyle(Color.bark)
                .lineLimit(2)
        }
    }

    // MARK: Ended

    private func endedView(error: String?) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: error == nil ? "checkmark.circle" : "exclamationmark.triangle")
                .font(.system(size: 44))
                .foregroundStyle(error == nil ? Color.sage : .orange)
            Text(error ?? "Call ended")
                .font(.headline)
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if let meeting = service.meeting {
                Button {
                    dismiss()
                    onOpenMeeting(meeting)
                } label: {
                    Label("Open notes", systemImage: "sparkles")
                        .font(.headline)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(Color.sageDeep, in: Capsule())
                        .foregroundStyle(Color.cream)
                }
            }
            Spacer()
        }
    }
}
