import SwiftUI

struct CalendarSettingsView: View {
    @Bindable var calendar: CalendarCoordinator
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Calendar accounts") {
                    ForEach(CalendarProvider.allCases, id: \.self) { provider in
                        Button("Connect \(provider == .google ? L10n.text("Google Calendar") : L10n.text("Microsoft 365"))") { calendar.connect(provider) }
                            .disabled(!calendar.configured(provider) || calendar.busyProviders.contains(provider))
                        if !calendar.configured(provider) { Text("Connection is unavailable in this build.").font(.caption).foregroundStyle(.secondary) }
                        if calendar.busyProviders.contains(provider) {
                            Button("Cancel connection") { Task { await calendar.cancel(provider) } }
                        }
                    }
                }
                ForEach(calendar.snapshots, id: \.account) { account in
                    Section(account.localizedDisplayName) {
                        Text(account.account.provider == .google ? L10n.text("Google Calendar") : L10n.text("Microsoft 365"))
                        if account.failure != nil || account.state != .connected {
                            Text("Calendar refresh needs attention. Previously saved events may be out of date.").foregroundStyle(.orange)
                            Button("Reconnect account") { calendar.connect(account.account.provider, existing: account.account) }
                        }
                        ForEach(account.calendars, id: \.id) { item in
                            Toggle(item.name, isOn: Binding(get: {
                                account.selectedCalendarIDs?.contains(item.id) ?? item.isDefault
                            }, set: { enabled in Task { await calendar.select(item.id, enabled: enabled, account: account.account) } }))
                        }
                        Button(L10n.key(account.state == .disconnecting ? "Retry disconnect" : "Disconnect account"), role: .destructive) {
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
                        ForEach([5, 10, 15], id: \.self) { Text(L10n.format("%lld minutes before", $0)).tag($0) }
                    }.disabled(!calendar.remindersEnabled)
                    Text("Reminders open meeting details. Recording starts only when you choose Record in a note.").font(.caption)
                }
                if let problem = calendar.problem { Section { Text(L10n.message(problem)).foregroundStyle(.orange) } }
            }.navigationTitle(L10n.text("Calendars")).toolbar { Button("Done") { dismiss() } }
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
                Text("\(account.localizedDisplayName): cached events may be out of date. Check Calendar settings.").font(.caption).foregroundStyle(.orange)
            }
            ForEach(calendar.upcoming) { event in
                Button { calendar.openFromHome(event, libraryID: libraryID) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.title).font(.headline)
                        Text(event.isAllDay ? L10n.text("All day") : L10n.date(event.start))
                            .font(.subheadline)
                        Text(calendar.snapshots.first { $0.account.provider.rawValue == event.key.provider && $0.account.subject == event.key.accountID }?.localizedDisplayName ?? calendar.accountName(event.key)).font(.caption).foregroundStyle(.secondary)
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
                    Text(L10n.date(event.start, time: !event.isAllDay))
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
                if let problem { Text(L10n.message(problem)).foregroundStyle(.red) }
            }.navigationTitle(L10n.text("Meeting")).toolbar { Button("Done") { dismiss() } }
        }
    }
}

private extension CalendarConnection {
    var localizedDisplayName: String {
        // This exact fallback is generated by our adapter. Verified provider names/emails stay verbatim.
        let fallback = "Google account \(account.subject.prefix(16))"
        if account.provider == .google && displayName == fallback {
            return L10n.format("Google account %@", String(account.subject.prefix(16)))
        }
        let parts = account.subject.split(separator: "/")
        if account.provider == .microsoft, parts.count == 2 {
            let microsoftFallback = "Microsoft account (\(parts[0].prefix(8))/\(parts[1].prefix(8)))"
            if displayName.lowercased() == microsoftFallback.lowercased() {
                return L10n.text("Microsoft account") + String(displayName.dropFirst("Microsoft account".count))
            }
        }
        return displayName
    }
}
