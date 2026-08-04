import SwiftUI

/// First-run onboarding. No account is required — the whole
/// notepad runs on-device; signing in is only for cloud sync.
struct WelcomeView: View {
    var onDone: () -> Void

    @State private var sync = SyncEngine.shared

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 32)

                    Image("Mascot")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 88, height: 88)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                    Wordmark(font: .largeTitle)
                        .padding(.top, 14)

                    Text("The AI notepad for\nin-person meetings.")
                        .font(.system(.largeTitle, design: .serif).weight(.medium))
                        .foregroundStyle(Color.ink)
                        .multilineTextAlignment(.center)
                        .padding(.top, 28)

                    Text("Records on your phone, transcribes on your phone, writes the notes on your phone. No bot, no cloud, no account needed.")
                        .font(.subheadline)
                        .foregroundStyle(Color.bark)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 36)
                        .padding(.top, 12)

                    Spacer(minLength: 36)

                    VStack(spacing: 10) {
                        Button {
                            onDone()
                        } label: {
                            Text("Get started")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.ink, in: RoundedRectangle(cornerRadius: 14))
                                .foregroundStyle(Color.cream)
                        }

                        Button {
                            Task { await sync.link() }
                        } label: {
                            HStack {
                                if sync.isLinking { ProgressView().tint(Color.ink) }
                                Text(sync.isLinking
                                    ? "Finish signing in with Safari…"
                                    : "Sign in & sync my meetings")
                            }
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.card, in: RoundedRectangle(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sand))
                            .foregroundStyle(Color.ink)
                        }
                        .disabled(sync.isLinking)
                        .onChange(of: sync.isLinked) { _, linked in
                            if linked { onDone() }
                        }

                        if let error = sync.lastError {
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }

                        Text("Sync is optional — you can link your account anytime in Settings.")
                            .font(.caption)
                            .foregroundStyle(Color.stone)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.cream)
    }
}
