import SwiftUI

struct SettingsView: View {
    @AppStorage("transcriptionEngine") private var transcriptionEngine = TranscriptionEngine.apple.rawValue
    @AppStorage("notesEngine") private var notesEngine = NotesEngineChoice.onDevice.rawValue
    @AppStorage("byokModel") private var byokModel = AnthropicEngine.defaultModel

    @State private var apiKey = Keychain.read(key: .anthropicAPIKey) ?? ""

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
    }
}
