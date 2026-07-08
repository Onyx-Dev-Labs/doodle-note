import SwiftUI
import SwiftData

/// Folder browser sheet: pick a filter for the home list, create, rename,
/// and delete folders. Folders sync with the workspace.
struct FoldersDrawer: View {
    @Binding var selectedFolderId: UUID?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @Query private var meetings: [Meeting]

    @State private var newFolderName = ""
    @State private var showNewFolder = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row(name: "All meetings", icon: "tray.full", count: meetings.count, id: nil)
                    ForEach(folders) { folder in
                        row(
                            name: folder.name,
                            icon: "folder.fill",
                            count: meetings.count { $0.folderId == folder.id },
                            id: folder.id
                        )
                        .swipeActions {
                            Button("Delete", role: .destructive) {
                                delete(folder)
                            }
                        }
                    }
                }

                Section {
                    Button {
                        showNewFolder = true
                    } label: {
                        Label("Create new folder", systemImage: "folder.badge.plus")
                            .foregroundStyle(Color.sageDeep)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.cream)
            .navigationTitle("Folders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("New folder", isPresented: $showNewFolder) {
                TextField("Name", text: $newFolderName)
                Button("Create") {
                    let name = newFolderName.trimmingCharacters(in: .whitespaces)
                    if !name.isEmpty {
                        context.insert(Folder(name: String(name.prefix(80))))
                        try? context.save()
                    }
                    newFolderName = ""
                }
                Button("Cancel", role: .cancel) { newFolderName = "" }
            }
        }
        .tint(Color.sageDeep)
    }

    private func row(name: String, icon: String, count: Int, id: UUID?) -> some View {
        Button {
            selectedFolderId = id
            dismiss()
        } label: {
            HStack {
                Label(name, systemImage: icon)
                    .foregroundStyle(Color.ink)
                Spacer()
                Text("\(count)")
                    .font(.footnote)
                    .foregroundStyle(Color.stone)
                if selectedFolderId == id {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.sageDeep)
                }
            }
        }
        .listRowBackground(Color.card)
    }

    private func delete(_ folder: Folder) {
        if folder.synced {
            SyncEngine.shared.noteFolderDeleted(id: folder.id)
        }
        // Meetings fall back to unfiled, matching the server's ON DELETE SET NULL.
        for meeting in meetings where meeting.folderId == folder.id {
            meeting.folderId = nil
        }
        if selectedFolderId == folder.id { selectedFolderId = nil }
        context.delete(folder)
        try? context.save()
    }
}
