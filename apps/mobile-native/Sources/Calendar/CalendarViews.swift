import SwiftUI

struct CalendarSettingsView: View {
    @Bindable var calendar: CalendarCoordinator
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Calendar accounts") {
                    ForEach(CalendarProvider.allCases, id: \.self) { provider in
                        Button("Connect \(provider == .google ? "Google Calendar" : "Microsoft 365")") { calendar.connect(provider) }
                            .disabled(!calendar.configured(provider) || calendar.busyProviders.contains(provider))
                        if !calendar.configured(provider) { Text("Connection is unavailable in this build.").font(.caption).foregroundStyle(.secondary) }
                        if calendar.busyProviders.contains(provider) {
                            Button("Cancel connection") { Task { await calendar.cancel(provider) } }
                        }
                    }
                }
                ForEach(calendar.snapshots, id: \.account) { account in
                    Section(account.displayName) {
                        Text(account.account.provider == .google ? "Google Calendar" : "Microsoft 365")
                        if account.failure != nil || account.state != .connected {
                            Text("Calendar refresh needs attention. Previously saved events may be out of date.").foregroundStyle(.orange)
                            Button("Reconnect account") { calendar.connect(account.account.provider, existing: account.account) }
                        }
                        ForEach(account.calendars, id: \.id) { item in
                            Toggle(item.name, isOn: Binding(get: {
                                account.selectedCalendarIDs?.contains(item.id) ?? item.isDefault
                            }, set: { enabled in Task { await calendar.select(item.id, enabled: enabled, account: account.account) } }))
                        }
                        Button(account.state == .disconnecting ? "Retry disconnect" : "Disconnect account", role: .destructive) {
                            Task { await calendar.disconnect(account.account) }
                        }
                        Text("Disconnecting keeps your notes.").font(.caption)
                    }
                }
                Section("Meeting reminders") {
                    Toggle("Reminders", isOn: Binding(get: { calendar.remindersEnabled }, set: { value in Task { await calendar.enableReminders(value) } }))
                        .accessibilityIdentifier("calendarReminders")
                    Picker("Remind me", selection: Binding(get: { calendar.leadMinutes }, set: { value in Task { await calendar.setLead(value) } })) {
                        Text("At start time").tag(0)
                        ForEach([5, 10, 15], id: \.self) { Text("\($0) minutes before").tag($0) }
                    }.disabled(!calendar.remindersEnabled)
                    Text("Reminders open meeting details. Recording starts only when you choose Record in a note.").font(.caption)
                }
                if let problem = calendar.problem { Section { Text(problem).foregroundStyle(.orange) } }
            }.navigationTitle("Calendars").toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct UpcomingMeetingsSection: View {
    @Bindable var calendar: CalendarCoordinator
    let libraryID: UUID
    var body: some View {
        Section("Upcoming · 14 days") {
            if calendar.loading { ProgressView("Refreshing calendars…") }
            if calendar.snapshots.isEmpty {
                Text("Connect a calendar to see your upcoming meetings.").foregroundStyle(.secondary)
            } else if calendar.upcoming.isEmpty && !calendar.loading {
                Text("No upcoming events in your selected calendars.").foregroundStyle(.secondary)
            }
            ForEach(calendar.snapshots.filter { $0.failure != nil || $0.state != .connected }, id: \.account) { account in
                Text("\(account.displayName): cached events may be out of date. Check Calendar settings.").font(.caption).foregroundStyle(.orange)
            }
            ForEach(calendar.upcoming) { event in
                Button { calendar.openFromHome(event, libraryID: libraryID) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.title).font(.headline)
                        Text(event.isAllDay ? "All day" : event.start.formatted(date: .abbreviated, time: .shortened))
                            .font(.subheadline)
                        Text(calendar.accountName(event.key)).font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("calendarEvent")
            }
            Button("Refresh calendars") { Task { await calendar.refresh() } }.disabled(calendar.loading)
        }
    }
}

struct CalendarMeetingView: View {
    let event: CalendarOccurrence
    @Bindable var library: NoteLibrary
    let requestedLibraryID: UUID
    let opened: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var busy = false
    @State private var problem: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(event.title).font(.title2)
                    Text(event.start.formatted(date: .complete, time: event.isAllDay ? .omitted : .shortened))
                    Text("Event timezone: \(event.timeZoneID)").font(.caption)
                    if let url = event.safeJoinURL {
                        Button("Join meeting", systemImage: "video") { openURL(url) }
                    }
                    Button("Open meeting note", systemImage: "note.text") {
                        busy = true
                        Task {
                            do {
                                let id = try await library.openEventNote(event, libraryID: requestedLibraryID)
                                opened(id); dismiss()
                            } catch { problem = "This note is unavailable. Check the selected library and Trash, then try again." }
                            busy = false
                        }
                    }.disabled(busy).accessibilityIdentifier("openMeetingNote")
                    Text("Opening a note does not start recording.").font(.caption)
                }
                if let invitees = event.invitees, !invitees.isEmpty {
                    Section("Invitee suggestions") {
                        Text("Calendar invitees are suggestions, not identified voices. Confirm speaker names yourself.").font(.caption)
                        ForEach(Array(invitees.enumerated()), id: \.offset) { _, name in Text(name) }
                    }
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            }.navigationTitle("Meeting").toolbar { Button("Done") { dismiss() } }
        }
    }
}
