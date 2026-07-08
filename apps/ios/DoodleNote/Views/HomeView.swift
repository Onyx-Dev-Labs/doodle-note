import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Meeting.createdAt, order: .reverse) private var meetings: [Meeting]

    @State private var path: [Meeting] = []
    @State private var autoRecordMeeting: Meeting?

    private var groupedByDay: [(day: Date, meetings: [Meeting])] {
        let calendar = Calendar.current
        let groups = Dictionary(grouping: meetings) { calendar.startOfDay(for: $0.createdAt) }
        return groups.keys.sorted(by: >).map { (day: $0, meetings: groups[$0] ?? []) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if meetings.isEmpty {
                    emptyState
                } else {
                    meetingList
                }
            }
            .background(Color.cream)
            .navigationDestination(for: Meeting.self) { meeting in
                MeetingView(meeting: meeting, startRecordingOnAppear: meeting === autoRecordMeeting)
            }
            .toolbar {
                ToolbarItem(placement: .principal) { Wordmark() }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(Color.bark)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                newMeetingButton
            }
        }
        .tint(Color.sageDeep)
    }

    private var meetingList: some View {
        List {
            ForEach(groupedByDay, id: \.day) { group in
                Section {
                    ForEach(group.meetings) { meeting in
                        NavigationLink(value: meeting) {
                            MeetingRow(meeting: meeting)
                        }
                        .listRowBackground(Color.card)
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            context.delete(group.meetings[index])
                        }
                        try? context.save()
                    }
                } header: {
                    Text(group.day, format: .dateTime.weekday(.wide).month().day())
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.stone)
                        .textCase(nil)
                }
            }
        }
        .scrollContentBackground(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "waveform.badge.mic")
                .font(.system(size: 44))
                .foregroundStyle(Color.sage)
            Text("No meetings yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.ink)
            Text("Tap New meeting when you sit down with someone. DoodleNote records, transcribes on your phone, and writes the notes.")
                .font(.subheadline)
                .foregroundStyle(Color.bark)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var newMeetingButton: some View {
        Button {
            let meeting = Meeting()
            context.insert(meeting)
            try? context.save()
            autoRecordMeeting = meeting
            path.append(meeting)
        } label: {
            Label("New meeting", systemImage: "record.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.sageDeep, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(Color.cream)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
    }
}

private struct MeetingRow: View {
    let meeting: Meeting

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(meeting.displayTitle)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.ink)
                .lineLimit(1)
            HStack(spacing: 6) {
                Text(meeting.createdAt, format: .dateTime.hour().minute())
                if meeting.generatedNotes != nil {
                    Label("Notes", systemImage: "sparkles")
                        .labelStyle(.titleAndIcon)
                }
                if !meeting.segments.isEmpty {
                    Text("·")
                    Text("\(meeting.segments.count) segments")
                }
            }
            .font(.caption)
            .foregroundStyle(Color.stone)
        }
        .padding(.vertical, 2)
    }
}
