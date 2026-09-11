import SwiftUI

struct FirstRunView: View {
    var onContinue: () -> Void
    @AppStorage("appLanguage") private var language = SpokenLanguage.english.rawValue

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Your notes, on your device").font(.title2.bold())
                    Text("Write and draw immediately. No account or model download is required. Cloud sync is optional.")
                }
                Section("Language") {
                    Picker("App language", selection: $language) {
                        ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0.rawValue) }
                    }.accessibilityIdentifier("setupLanguage")
                    Text("Speech and generation support are checked separately for each language and device.").font(.footnote)
                }
                Section {
                    Text("Live transcription, speaker labels and generated notes use separate on-device models. You can prepare them later in Models.")
                    Button("Start taking notes", action: onContinue).accessibilityIdentifier("finishSetup")
                }
            }.navigationTitle(L10n.text("Welcome to DoodleNote"))
        }
    }
}

struct ModelSettingsView: View {
    @Bindable var recording: RecordingSession
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appLanguage") private var languageID = SpokenLanguage.english.rawValue
    @State private var generation = GenerationReadiness(available: false, detail: "Checking on-device generation…")
    @State private var confirmingRemoval = false
    private let engine = AppleLocalGeneration()
    private var language: SpokenLanguage { SpokenLanguage(rawValue: languageID) ?? .english }
    private var captureActive: Bool { recording.busy || recording.noteID != nil }
    private var preparing: Bool { recording.speech.readiness == .downloading || recording.speakers.preparing }

    var body: some View {
        NavigationStack {
            Form {
                Section("Language") {
                    Picker("App language", selection: $languageID) {
                        ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0.rawValue) }
                    }.disabled(captureActive || preparing).accessibilityIdentifier("settingsLanguage")
                }
                if captureActive { Text("Finish recording before changing models.") }
                Section("Live transcription") {
                    Text(L10n.message(recording.speech.detail))
                    if recording.speech.readiness == .downloading {
                        ProgressView(value: recording.speech.downloadProgress)
                        Button("Cancel speech download") { recording.speech.cancelDownload() }
                            .disabled(recording.speech.cancellingDownload)
                    } else {
                        Button("Check speech readiness") { Task { await recording.speech.check(language) } }
                        if recording.speech.readiness == .downloadNeeded {
                            Button("Download speech model") { Task { await recording.speech.download(language) } }
                        }
                        Button("Release speech model reservation") { Task { await recording.speech.releaseModel(language) } }
                        Text("Speech assets are managed by Apple. Releasing a reservation does not guarantee immediate disk-space recovery.").font(.footnote)
                    }
                }.disabled(captureActive)
                Section("Speaker labels") {
                    Text(L10n.message(recording.speakers.detail))
                    if recording.speakers.state == .downloading {
                        ProgressView(value: recording.speakers.downloadProgress)
                        Button("Cancel speaker download") { recording.speakers.cancelDownload() }
                    } else {
                        Button("Download or repair speaker model") { recording.speakers.download() }
                        Button("Remove speaker model", role: .destructive) { confirmingRemoval = true }
                    }
                    Text("The download is verified before use. Completed files are kept for retry after an interruption. Speaker accuracy still requires device qualification.").font(.footnote)
                }.disabled(captureActive || recording.speakers.state == .preparing)
                Section("Voice recognition model") {
                    Text(L10n.key(recording.voiceEmbedding.ready ? "Ready" : "Not available"))
                    Text("Download a separate 30 MB model to remember voices. Accuracy needs testing on your device.")
                    if recording.voiceEmbedding.downloading {
                        ProgressView(value: recording.voiceEmbedding.progress)
                        Button("Cancel voice model download") { recording.voiceEmbedding.cancel() }
                    } else {
                        Button("Download voice recognition model") { recording.voiceEmbedding.download() }
                        Button("Remove voice recognition model", role: .destructive) { Task { await recording.voiceEmbedding.remove() } }
                    }
                    if let problem = recording.voiceEmbedding.problem { Text(L10n.message(problem)) }
                }.disabled(captureActive)
                Section("Saved voices") {
                    Text(L10n.message(recording.voices.detail))
                    if recording.voices.profiles.isEmpty {
                        Text("No saved voices yet.").font(.footnote)
                    }
                    ForEach(recording.voices.profiles) { profile in
                        HStack {
                            Toggle(profile.name, isOn: Binding(
                                get: { recording.voices.catalog.selectedIDs.contains(profile.id) },
                                set: { enabled in Task { await recording.voices.setSelected(profile.id, enabled: enabled) } }))
                            Button("Remove saved voice", role: .destructive) {
                                Task { try? await recording.voices.remove(profile.id) }
                            }
                        }
                    }
                    Text("Voice profiles stay on this device. They are not synced or backed up. Recording works without saved voices.").font(.footnote)
                }.disabled(captureActive)
                Section("Generated notes") {
                    Label(L10n.key(generation.available ? "Ready" : "Not available"), systemImage: generation.available ? "checkmark.circle" : "info.circle")
                    Text(L10n.message(generation.detail))
                    Text("Apple Intelligence manages this model's preparation, storage and removal in system Settings. DoodleNote never silently sends requests to a cloud model.").font(.footnote)
                    Button("Check generation readiness") { Task { generation = await engine.readiness(language: language) } }
                }
                Section { Text("Removing models does not remove notes, drawings, transcripts or recordings. Installed functions can run offline when this device and language support them.") }
            }
            .navigationTitle(L10n.text("Models"))
            .toolbar { Button("Done") { dismiss() } }
            .task(id: languageID) {
                guard !captureActive else { return }
                await recording.speech.check(language)
                await recording.speakers.check()
                await recording.voices.refresh()
                await recording.voiceEmbedding.check()
                generation = await engine.readiness(language: language)
            }
            .confirmationDialog("Remove downloaded speaker assets?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
                Button("Remove speaker model", role: .destructive) {
                    guard !captureActive else { return }
                    Task { await recording.speakers.removeModel() }
                }
            } message: { Text("This removes installed and partially downloaded speaker models. Your notes and recordings are kept.") }
        }
    }
}
