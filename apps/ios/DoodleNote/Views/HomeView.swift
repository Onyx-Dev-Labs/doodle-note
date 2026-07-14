import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Query(sort: \Meeting.createdAt, order: .reverse) private var meetings: [Meeting]
    @Query(sort: \Folder.createdAt) private var folders: [Folder]

    @State private var path: [Meeting] = []
    @State private var autoRecordMeeting: Meeting?
    @State private var calendar = CalendarService.shared
    @State private var router = NotificationRouter.shared
    @State private var sync = SyncEngine.shared
    @State private var selectedFolderId: UUID?
    @State private var showFolders = false
    @State private var movingMeeting: Meeting?
    @State private var showGlobalChat = false
    @State private var showDialer = false
    @State private var searchText = ""
    @State private var showAllUpcoming = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    titleRow
                    if calendar.access == .granted, !calendar.upcoming.isEmpty, searchText.isEmpty {
                        comingUpSection
                    }
                }
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                .listRowBackground(Color.cream)
                .listRowSeparator(.hidden)

                meetingsList
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color.cream)
            .environment(\.defaultMinListRowHeight, 0)
            .confirmationDialog(
                "Move to folder",
                isPresented: Binding(
                    get: { movingMeeting != nil },
                    set: { if !$0 { movingMeeting = nil } }
                ),
                titleVisibility: .visible,
                presenting: movingMeeting
            ) { meeting in
                Button("My notes") { moveMeeting(meeting, to: nil) }
                ForEach(folders) { folder in
                    Button(folder.name) { moveMeeting(meeting, to: folder.id) }
                }
                Button("Cancel", role: .cancel) {}
            }
            .navigationDestination(for: Meeting.self) { meeting in
                MeetingView(
                    meeting: meeting,
                    // Only a brand-new, never-recorded meeting auto-starts. Re-opening
                    // a finished meeting to read its notes must NOT record again.
                    startRecordingOnAppear: meeting === autoRecordMeeting && meeting.startedAt == nil
                )
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showFolders = true
                    } label: {
                        Image(systemName: selectedFolderId == nil ? "folder" : "folder.fill")
                            .foregroundStyle(Color.bark)
                    }
                }
                ToolbarItem(placement: .principal) { Wordmark(font: .subheadline) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showDialer = true
                    } label: {
                        Image(systemName: "phone")
                            .foregroundStyle(Color.bark)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(Color.bark)
                    }
                }
            }
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search meetings, notes, transcripts"
            )
            .safeAreaInset(edge: .bottom) { bottomBar }
            .sheet(isPresented: $showFolders) {
                FoldersDrawer(selectedFolderId: $selectedFolderId)
            }
            .sheet(isPresented: $showGlobalChat) {
                ChatView(scope: .global)
            }
            .sheet(isPresented: $showDialer) {
                DialerView { meeting in
                    path.append(meeting)
                }
            }
        }
        .tint(Color.sageDeep)
        .task {
            await calendar.requestAndLoad()
            await router.schedule(for: calendar.upcoming)
            if sync.isLinked {
                await sync.syncNow(context: context)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await calendar.requestAndLoad()
                    await router.schedule(for: calendar.upcoming)
                    if sync.isLinked { await sync.syncNow(context: context) }
                }
            }
        }
        .task(id: scenePhase) {
            // Periodic sync while the app is foregrounded, so meetings from
            // other devices show up without relaunching. Cancels when the
            // scene leaves .active (task id change) or the view goes away.
            guard scenePhase == .active, sync.isLinked else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 180_000_000_000) // 3 min
                if Task.isCancelled { break }
                await sync.syncNow(context: context)
            }
        }
        .onChange(of: router.pendingStart) { _, pending in
            guard let pending else { return }
            router.pendingStart = nil
            startMeeting(title: pending.title, calendarEventId: pending.eventId)
        }
    }

    // MARK: Header

    private var titleRow: some View {
        Text(selectedFolderName ?? "My notes")
            .font(.system(size: 34, weight: .medium, design: .serif))
            .foregroundStyle(Color.ink)
            .padding(.top, 4)
    }

    private var selectedFolderName: String? {
        selectedFolderId.flatMap { id in folders.first { $0.id == id }?.name }
    }

    // MARK: Coming up

    private var comingUpSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Coming up")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.stone)
                Spacer()
                if calendar.upcoming.count > 3 {
                    Button(showAllUpcoming ? "Show less" : "Show more") {
                        showAllUpcoming.toggle()
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.sageDeep)
                }
            }

            ForEach(showAllUpcoming ? calendar.upcoming : Array(calendar.upcoming.prefix(3))) { event in
                upcomingCard(event)
            }
        }
    }

    private func upcomingCard(_ event: UpcomingEvent) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                VStack(spacing: 0) {
                    Text(event.start, format: .dateTime.month(.abbreviated))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.sageDeep)
                        .textCase(.uppercase)
                    Text(event.start, format: .dateTime.day())
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.ink)
                }
                .frame(width: 44, height: 44)
                .background(Color.sageFill, in: RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 2) {
                    Text(event.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Color.ink)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(event.start, format: .dateTime.hour().minute())
                        if event.attendeeCount > 0 {
                            Text("· \(event.attendeeCount) attendees")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(Color.stone)
                }
                Spacer()
            }

            if event.isImminent {
                Button {
                    startMeeting(title: event.title, calendarEventId: event.id)
                } label: {
                    Text("Start notes")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.cream, in: Capsule())
                        .foregroundStyle(Color.ink)
                }
            }
        }
        .padding(12)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sand))
    }

    // MARK: Meetings list

    private var visibleMeetings: [Meeting] {
        var result = meetings
        if let folderId = selectedFolderId {
            result = result.filter { $0.folderId == folderId }
        }
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty {
            result = result.filter { meeting in
                meeting.displayTitle.lowercased().contains(query)
                    || meeting.roughNotes.lowercased().contains(query)
                    || (meeting.generatedNotes?.lowercased().contains(query) ?? false)
            }
        }
        return result
    }

    private var groupedByDay: [(day: Date, meetings: [Meeting])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: visibleMeetings) { calendar.startOfDay(for: $0.createdAt) }
        return groups.keys.sorted(by: >).map { (day: $0, meetings: groups[$0] ?? []) }
    }

    // MARK: Meetings list (native List rows → real swipe, jank-free scroll)

    @ViewBuilder private var meetingsList: some View {
        if visibleMeetings.isEmpty {
            Section {
                emptyState
                    .frame(maxWidth: .infinity)
                    .listRowInsets(EdgeInsets(top: 48, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.cream)
                    .listRowSeparator(.hidden)
            }
        } else {
            ForEach(groupedByDay, id: \.day) { group in
                Section {
                    ForEach(group.meetings) { meeting in
                        Button { path.append(meeting) } label: {
                            MeetingRow(meeting: meeting)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowBackground(Color.cream)
                        .listRowSeparator(.hidden)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { deleteMeeting(meeting) } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button { movingMeeting = meeting } label: {
                                Label("Move", systemImage: "folder")
                            }
                            .tint(Color.sage)
                        }
                        .contextMenu {
                            Button("Move to folder", systemImage: "folder") { movingMeeting = meeting }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleteMeeting(meeting) }
                        }
                    }
                } header: {
                    Text(relativeDayLabel(group.day))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.stone)
                        .textCase(nil)
                }
                .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 2, trailing: 16))
                .listRowBackground(Color.cream)
            }
        }
    }

    private func relativeDayLabel(_ day: Date) -> String {
        if Calendar.current.isDateInToday(day) { return "Today" }
        if Calendar.current.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: searchText.isEmpty ? "waveform.badge.mic" : "magnifyingglass")
                .font(.system(size: 44))
                .foregroundStyle(Color.sage)
            Text(searchText.isEmpty ? "No meetings yet" : "No matches")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.ink)
            if searchText.isEmpty {
                Text("Tap the + button when you sit down with someone. DoodleNote records, transcribes on your phone, and writes the notes.")
                    .font(.subheadline)
                    .foregroundStyle(Color.bark)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    // MARK: Bottom bar (Ask anything + new meeting)

    private var bottomBar: some View {
        HStack(spacing: 12) {
            Button {
                showGlobalChat = true
            } label: {
                HStack {
                    Text("Ask anything")
                        .foregroundStyle(Color.stone)
                    Spacer()
                    Image(systemName: "sparkles")
                        .foregroundStyle(Color.sage)
                }
                .font(.body)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(Color.card, in: Capsule())
                .overlay(Capsule().stroke(Color.sand))
            }

            Menu {
                Button {
                    startMeeting(title: "", calendarEventId: nil)
                } label: {
                    Label("Record meeting", systemImage: "record.circle.fill")
                }
                Button {
                    startNote()
                } label: {
                    Label("New note", systemImage: "square.and.pencil")
                }
            } label: {
                Image(systemName: "plus")
                    .font(.title3.weight(.semibold))
                    .frame(width: 50, height: 50)
                    .background(Color.sageDeep, in: Circle())
                    .foregroundStyle(Color.cream)
            }
            .accessibilityLabel("New")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func deleteMeeting(_ meeting: Meeting) {
        SyncEngine.shared.noteDeleted(meeting: meeting)
        context.delete(meeting)
        try? context.save()
    }

    private func moveMeeting(_ meeting: Meeting, to folderId: UUID?) {
        // folderId is in the content hash, so this marks the meeting dirty;
        // the next syncNow (foreground + periodic) carries it to the cloud.
        meeting.folderId = folderId
        try? context.save()
    }

    private func startMeeting(title: String, calendarEventId: String?) {
        let meeting = Meeting(title: title)
        meeting.calendarEventId = calendarEventId
        meeting.folderId = selectedFolderId
        context.insert(meeting)
        try? context.save()
        autoRecordMeeting = meeting
        path.append(meeting)
    }

    /// Standalone quick note — typing is its default, nothing records.
    private func startNote() {
        let note = Meeting(kind: "note")
        note.folderId = selectedFolderId
        context.insert(note)
        try? context.save()
        path.append(note)
    }
}

private struct MeetingRow: View {
    let meeting: Meeting

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(meeting.displayTitle)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(meeting.createdAt, format: .dateTime.hour().minute())
                    if meeting.isNote {
                        Label("Note", systemImage: "square.and.pencil")
                    }
                    if meeting.generatedNotes != nil {
                        Label("Notes", systemImage: "sparkles")
                    }
                    // Duration comes from startedAt/endedAt — a couple of cheap
                    // stored dates. Reading meeting.segments here faulted the
                    // WHOLE transcript from disk on every row draw, which froze
                    // scrolling (worse under List, which re-renders rows).
                    if let minutes = meeting.durationMinutes {
                        Text("· \(minutes)m")
                    } else if meeting.startedAt != nil {
                        Label("Recorded", systemImage: "waveform")
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.stone)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.stone)
        }
        .padding(12)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// A row that reveals Move + Delete when swiped left, since the home list is
/// a styled ScrollView (native List `.swipeActions` don't apply here). Tap the
/// content to open; swipe to act. Only one row opens at a time via a shared
/// binding would be ideal, but per-row state keeps it self-contained — a new
/// swipe on another row leaves this one open until tapped, which is fine.
