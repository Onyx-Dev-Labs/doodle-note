import SwiftUI
import SwiftData

@main
struct DoodleNoteApp: App {
    let container: ModelContainer = {
        do {
            return try ModelContainer(for: Meeting.self, Segment.self)
        } catch {
            fatalError("Failed to create model container: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            HomeView()
        }
        .modelContainer(container)
    }
}
