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
            if hasOnboarded {
                HomeView()
            } else {
                WelcomeView { hasOnboarded = true }
            }
        }
        .modelContainer(container)
    }
}
