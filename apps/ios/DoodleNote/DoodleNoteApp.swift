import SwiftUI
import SwiftData

@main
struct DoodleNoteApp: App {
    @AppStorage("hasOnboarded") private var hasOnboarded = false

    let container: ModelContainer = {
        do {
            return try ModelContainer(for: Meeting.self, Segment.self, Folder.self)
        } catch {
            // A force-kill mid-write can leave the store unopenable, and a
            // fatalError here bricks the app into a black screen forever
            // (exactly what happened on the first device test). Move the
            // damaged store aside and start clean — synced meetings come
            // back from the cloud; a fresh store beats a dead app.
            let fm = FileManager.default
            if let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
                let stamp = Int(Date().timeIntervalSince1970)
                for suffix in ["", "-shm", "-wal"] {
                    let file = support.appendingPathComponent("default.store\(suffix)")
                    let backup = support.appendingPathComponent("default.store.corrupt-\(stamp)\(suffix)")
                    try? fm.moveItem(at: file, to: backup)
                }
            }
            do {
                return try ModelContainer(for: Meeting.self, Segment.self, Folder.self)
            } catch {
                fatalError("Failed to create model container even after store reset: \(error)")
            }
        }
    }()

    init() {
        NotificationRouter.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if hasOnboarded {
                    HomeView()
                } else {
                    WelcomeView { hasOnboarded = true }
                }
            }
            .onOpenURL { url in
                SyncEngine.shared.handleCallback(url)
            }
        }
        .modelContainer(container)
    }
}
