import SwiftUI
import SwiftData

@main
struct DoodleNoteApp: App {
    @AppStorage("hasOnboarded") private var hasOnboarded = false

    let container: ModelContainer = {
        do {
            return try ModelContainer(for: Meeting.self, Segment.self, Folder.self)
        } catch {
            fatalError("Failed to create model container: \(error)")
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
