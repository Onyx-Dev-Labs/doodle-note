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
            .navigationDestination(for: Meeting.self) { meeting in
                MeetingView(meeting: meeting, startRecordingOnAppear: meeting === autoRecordMeeting)
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
                        NavigationLink(value: meeting) {
                            MeetingRow(meeting: meeting)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                SyncEngine.shared.noteDeleted(meeting: meeting)
                                context.delete(meeting)
                                try? context.save()
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
