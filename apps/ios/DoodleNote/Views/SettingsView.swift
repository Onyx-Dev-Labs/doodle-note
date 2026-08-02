import SwiftUI

struct SettingsView: View {
    @Environment(\.openURL) private var openURL
    @AppStorage("transcriptionEngine") private var transcriptionEngine = TranscriptionEngine.apple.rawValue
    @AppStorage("notesEngine") private var notesEngine = NotesEngineChoice.onDevice.rawValue
    @AppStorage("byokModel") private var byokModel = AnthropicEngine.defaultModel
    @AppStorage("meetingNotifications") private var meetingNotifications = false

    @State private var apiKey = Keychain.read(key: .anthropicAPIKey) ?? ""
    @State private var calendar = CalendarService.shared
    @State private var router = NotificationRouter.shared

    var body: some View {
        Form {
            Section {
                Picker("Engine", selection: $transcriptionEngine) {
                    ForEach(TranscriptionEngine.allCases) { engine in
                        Text(engine.label).tag(engine.rawValue)
                    }
                }
            } header: {
                Text("Transcription")
            } footer: {
                Text(TranscriptionEngine(rawValue: transcriptionEngine)?.detail ?? "")
            }

            Section {
                Picker("Notes model", selection: $notesEngine) {
                    ForEach(NotesEngineChoice.allCases) { choice in
                        Text(choice.label).tag(choice.rawValue)
                    }
                }
                if notesEngine == NotesEngineChoice.byok.rawValue {
                    SecureField("Anthropic API key (sk-ant-…)", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: apiKey) { _, newValue in
                            if newValue.isEmpty {
                                Keychain.delete(key: .anthropicAPIKey)
                            } else {
                                Keychain.save(key: .anthropicAPIKey, value: newValue)
                            }
                        }
                    TextField("Model", text: $byokModel)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            } header: {
                Text("AI notes")
            } footer: {
                Text(notesEngine == NotesEngineChoice.onDevice.rawValue
                    ? "Notes are written by Apple's on-device model. Nothing leaves your phone."
                    : "Notes are generated with your own Anthropic API key. The key is stored in the Keychain and sent only to Anthropic.")
            }

            calendarSection

            SyncSettingsSection()

            CallerIdSection()

            Section {
                LabeledContent("Version") {
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                }
            } header: {
                Text("About")
            } footer: {
                Text("Local-first. Your meetings never leave your device unless you turn on sync.")
            }
        }
        .navigationTitle("Settings")
        .scrollContentBackground(.hidden)
        .background(Color.cream)
        .task {
            await calendar.refresh(promptIfNeeded: false)
            await router.refreshAuthorization()
        }
        .onChange(of: meetingNotifications) { _, enabled in
            Task {
                if enabled {
                    let granted = await router.requestAuthorizationAndSchedule(for: calendar.upcoming)
                    if !granted { meetingNotifications = false }
                } else {
                    router.disableNotifications()
                }
            }
        }
    }

    private var calendarSection: some View {
        Section {
            switch calendar.access {
            case .unknown:
                Button {
                    Task { await calendar.refresh(promptIfNeeded: true) }
                } label: {
                    Label("Connect calendar", systemImage: "calendar.badge.plus")
                }
            case .denied:
                Button {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    openURL(url)
                } label: {
                    Label("Calendar access is off", systemImage: "calendar.badge.exclamationmark")
                }
            case .granted:
                LabeledContent("Calendar") { Text("Connected") }
            }

            Toggle("Meeting reminders", isOn: $meetingNotifications)
                .disabled(calendar.access != .granted)

            if router.authorization == .denied {
                Button("Enable notifications in Settings") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    openURL(url)
                }
            }
        } header: {
            Text("Calendar & reminders")
        } footer: {
            Text("Optional. Calendar events stay on this phone. Reminders are only scheduled after you turn them on.")
        }
    }
}
