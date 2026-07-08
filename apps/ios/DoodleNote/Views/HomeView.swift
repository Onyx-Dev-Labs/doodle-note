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
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    titleRow
                    if calendar.access == .granted, !calendar.upcoming.isEmpty, searchText.isEmpty {
                        comingUpSection
                    }
                    meetingsSection
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 90)
            }
            .background(Color.cream)
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
            .searchable(text: $searchText, prompt: "Search meetings, notes, transcripts")
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
                }
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
                    || meeting.segments.contains { $0.text.lowercased().contains(query) }
            }
        }
        return result
    }

    private var groupedByDay: [(day: Date, meetings: [Meeting])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: visibleMeetings) { calendar.startOfDay(for: $0.createdAt) }
        return groups.keys.sorted(by: >).map { (day: $0, meetings: groups[$0] ?? []) }
    }

    @ViewBuilder
    private var meetingsSection: some View {
        if visibleMeetings.isEmpty {
            emptyState
        } else {
            ForEach(groupedByDay, id: \.day) { group in
                VStack(alignment: .leading, spacing: 8) {
                    Text(relativeDayLabel(group.day))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.stone)
                    ForEach(group.meetings) { meeting in
                        SwipeableRow(
                            onTap: { path.append(meeting) },
                            onMove: { movingMeeting = meeting },
                            onDelete: { deleteMeeting(meeting) }
                        ) {
                            MeetingRow(meeting: meeting)
                        }
                        .contextMenu {
                            Button("Move to folder", systemImage: "folder") { movingMeeting = meeting }
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                deleteMeeting(meeting)
                            }
                        }
                    }
                }
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

            Button {
                startMeeting(title: "", calendarEventId: nil)
            } label: {
                Image(systemName: "plus")
                    .font(.title3.weight(.semibold))
                    .frame(width: 50, height: 50)
                    .background(Color.sageDeep, in: Circle())
                    .foregroundStyle(Color.cream)
            }
            .accessibilityLabel("New meeting")
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
                    if meeting.generatedNotes != nil {
                        Label("Notes", systemImage: "sparkles")
                    }
                    if !meeting.segments.isEmpty {
                        Text("· \(meeting.segments.count) segments")
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
struct SwipeableRow<Content: View>: View {
    let onTap: () -> Void
    let onMove: () -> Void
    let onDelete: () -> Void
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @State private var committed: CGFloat = 0
    private let actionsWidth: CGFloat = 148

    var body: some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: 8) {
                actionButton("Move", "folder", Color.sage) {
                    reset(); onMove()
                }
                actionButton("Delete", "trash", Color(red: 0.66, green: 0.26, blue: 0.18)) {
                    reset(); onDelete()
                }
            }
            .padding(.leading, 8)

            content
                .background(Color.cream) // hide the actions until swiped
                .offset(x: offset)
                .contentShape(Rectangle())
                .onTapGesture {
                    if committed != 0 { reset() } else { onTap() }
                }
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { value in
                            let proposed = committed + value.translation.width
                            offset = min(0, max(-actionsWidth, proposed))
                        }
                        .onEnded { value in
                            let open = value.translation.width < -actionsWidth / 2 || committed != 0
                                && value.translation.width < actionsWidth / 2
                            withAnimation(.snappy(duration: 0.22)) {
                                committed = open ? -actionsWidth : 0
                                offset = committed
                            }
                        }
                )
        }
    }

    private func actionButton(_ title: String, _ icon: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon)
                Text(title).font(.caption2.weight(.semibold))
            }
            .frame(width: 62)
            .frame(maxHeight: .infinity)
            .foregroundStyle(.white)
            .background(tint, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func reset() {
        withAnimation(.snappy(duration: 0.22)) {
            committed = 0
            offset = 0
        }
    }
}
