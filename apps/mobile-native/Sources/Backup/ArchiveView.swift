import SwiftUI
import UniformTypeIdentifiers

struct ArchiveView: View {
    @Bindable var library: NoteLibrary
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var includeTrash = true
    @State private var importing = false
    @State private var exporting: URL?
    @State private var task: Task<Void, Never>?
    @State private var status: String?
    @State private var failed = false
    private var valid: Bool { (12...1024).contains(password.utf8.count) }

    var body: some View {
        Form {
            Section("Encrypted backup") {
                Text("Back up the selected library, including note history, ink and audio. Credentials and saved voice profiles are excluded.")
                SecureField("Archive password", text: $password).textContentType(.newPassword)
                    .accessibilityIdentifier("archivePassword")
                Text("Use at least 12 characters. Keep your password safe; it cannot be recovered.").font(.caption)
                SecureField("Confirm password", text: $confirmation).textContentType(.newPassword)
                    .accessibilityIdentifier("archiveConfirmation")
                Toggle("Include retained Trash", isOn: $includeTrash)
                Button("Save encrypted archive to Files") { export() }
                    .disabled(!valid || confirmation != password || task != nil)
                    .accessibilityIdentifier("archiveExport")
            }
            Section("Restore archive") {
                Text("Restored notes are new copies in Only on this device. Existing notes stay unchanged. Included Trash gets a new 30-day recovery period. Sync requires a separate deliberate choice.")
                Button("Choose encrypted archive") { importing = true }
                    .disabled(!valid || task != nil).accessibilityIdentifier("archiveImport")
            }
            if task != nil {
                Section {
                    ProgressView("Processing archive…")
                    Button("Cancel") { task?.cancel() }
                }
            }
            if let status { Text(L10n.key(status)).foregroundStyle(failed ? .red : .secondary).accessibilityIdentifier("archiveStatus") }
        }
        .navigationTitle(L10n.text("Backup & restore"))
        .toolbar { Button("Done") { password = ""; confirmation = ""; dismiss() }.disabled(task != nil) }
        .interactiveDismissDisabled(task != nil)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.data], allowsMultipleSelection: false) { result in
            guard case .success(let urls) = result, let url = urls.first else { return }
            restore(url)
        }
        .sheet(item: Binding(get: { exporting.map(ArchiveExportItem.init) }, set: { if $0 == nil { clearExport() } })) { item in
            ArchiveFilesExporter(url: item.url) { success in
                status = success ? "Encrypted archive saved." : "Archive export cancelled."
                clearExport()
            }
        }
        .onDisappear { if task == nil { clearExport(); password = ""; confirmation = "" } }
    }

    private func clearExport() { if let exporting { try? FileManager.default.removeItem(at: exporting) }; exporting = nil }
    private func export() {
        let secret = password, trash = includeTrash, scope = library.selectedLibraryID, identities = library.identities
        failed = false; status = nil
        task = Task {
            defer { task = nil; password = ""; confirmation = "" }
            do {
                guard await library.flush(), let repository = library.cloudRepository else { throw EncryptedArchive.Failure.busy }
                let url = URL.temporaryDirectory.appendingPathComponent("DoodleNote-\(UUID().uuidString).doodlenote")
                try await repository.exportArchive(libraryID: scope, identities: identities, includeTrash: trash, password: secret, to: url)
                if Task.isCancelled { try? FileManager.default.removeItem(at: url); throw CancellationError() }
                exporting = url
            } catch { report(error) }
        }
    }
    private func restore(_ url: URL) {
        let secret = password
        failed = false; status = nil
        task = Task {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() }; task = nil; password = ""; confirmation = "" }
            do {
                guard await library.flush(), let repository = library.cloudRepository else { throw EncryptedArchive.Failure.busy }
                _ = try await repository.restoreArchive(from: url, password: secret)
                try await library.refreshAfterCloud()
                library.selectLibrary(LibraryRecord.localID)
                status = "Archive restored to Only on this device."
            } catch { report(error) }
        }
    }
    private func report(_ error: Error) {
        failed = !(error is CancellationError)
        status = error is CancellationError ? "Archive operation cancelled. Existing notes are unchanged." : "Archive could not be processed. Check the password, file integrity, available space and supported archive version."
    }
}
private struct ArchiveExportItem: Identifiable { let url: URL; var id: URL { url } }
private struct ArchiveFilesExporter: UIViewControllerRepresentable {
    let url: URL
    let completion: (Bool) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let completion: (Bool) -> Void
        init(completion: @escaping (Bool) -> Void) { self.completion = completion }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { completion(false) }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { completion(true) }
    }
}
