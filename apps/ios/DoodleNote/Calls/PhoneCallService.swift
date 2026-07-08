import Foundation
import AVFoundation
import SwiftData
import SwiftUI
import TwilioVoice

/// Outbound phone calls with on-device transcription of both sides.
///
/// The call is a VoIP leg bridged to the phone network by our server
/// (apps/web/app/api/voice); DoodleAudioDevice taps the mic (You) and the
/// far end (Them) into two live transcription providers, so the transcript
/// never leaves the phone — the desktop's two-channel model, on a call.
@MainActor
@Observable
final class PhoneCallService: NSObject {
    enum State: Equatable {
        case idle
        case preparing(String)
        case ringing
        case connected(Date)
        case ended(String?)
    }

    private(set) var state: State = .idle
    private(set) var youPartial = ""
    private(set) var themPartial = ""
    private(set) var meeting: Meeting?

    private let audioDevice = DoodleAudioDevice()
    private var call: Call?
    private var micProvider: TranscriptionProvider?
    private var remoteProvider: TranscriptionProvider?
    private var eventTasks: [Task<Void, Never>] = []
    private var context: ModelContext?

    var isActive: Bool {
        switch state {
        case .idle, .ended: false
        default: true
        }
    }

    func dial(number: String, context: ModelContext) async {
        guard !isActive else { return }
        self.context = context
        state = .preparing("Checking account…")

        do {
            let token = try await SyncEngine.shared.voiceToken()

            state = .preparing("Preparing transcription…")
            guard await AVAudioApplication.requestRecordPermission() else {
                state = .ended("Microphone access is off. Enable it in Settings.")
                return
            }
            let mic = AppleSpeechProvider()
            let remote = AppleSpeechProvider()
            micProvider = mic
            remoteProvider = remote
            try await mic.prepare()
            try await remote.prepare()
            try await mic.start(inputFormat: DoodleAudioDevice.pcmFormat)
            try await remote.start(inputFormat: DoodleAudioDevice.pcmFormat)

            audioDevice.onCapturedAudio = { [weak mic] buffer in mic?.ingest(buffer) }
            audioDevice.onRenderedAudio = { [weak remote] buffer in remote?.ingest(buffer) }

            let meeting = Meeting(title: "Call \(number)")
            meeting.startedAt = .now
            context.insert(meeting)
            try? context.save()
            self.meeting = meeting

            watch(provider: mic, speaker: "You", channel: "mic")
            watch(provider: remote, speaker: "Them", channel: "system")

            state = .ringing
            TwilioVoiceSDK.audioDevice = audioDevice
            let options = ConnectOptions(accessToken: token.token) { builder in
                builder.params = ["To": number]
            }
            call = TwilioVoiceSDK.connect(options: options, delegate: self)
        } catch {
            state = .ended(friendlyError(error))
            await teardown()
        }
    }

    func hangUp() {
        call?.disconnect()
    }

    private func watch(provider: TranscriptionProvider, speaker: String, channel: String) {
        let task = Task { [weak self] in
            for await event in provider.events {
                guard let self else { return }
                switch event {
                case .partial(let text):
                    if speaker == "You" { self.youPartial = text } else { self.themPartial = text }
                case .final(let text, let startMs, let endMs):
                    if speaker == "You" { self.youPartial = "" } else { self.themPartial = "" }
                    guard let meeting = self.meeting, let context = self.context else { return }
                    let segment = Segment(
                        channel: channel, speaker: speaker,
                        text: text, startMs: startMs, endMs: endMs
                    )
                    segment.meeting = meeting
                    context.insert(segment)
                    try? context.save()
                case .error:
                    break
                }
            }
        }
        eventTasks.append(task)
    }

    private func finishCall(errorMessage: String?) {
        Task {
            meeting?.endedAt = .now
            try? context?.save()
            await teardown()
            state = .ended(errorMessage)
        }
    }

    private func teardown() async {
        call = nil
        await micProvider?.finish()
        await remoteProvider?.finish()
        for task in eventTasks { await task.value }
        eventTasks = []
        micProvider = nil
        remoteProvider = nil
        audioDevice.onCapturedAudio = nil
        audioDevice.onRenderedAudio = nil
        youPartial = ""
        themPartial = ""
    }

    private func friendlyError(_ error: Error) -> String {
        if let syncError = error as? SyncAPI.SyncError {
            switch syncError {
            case .invalidToken:
                return "Phone calls need a linked account — connect one in Settings → Cloud sync."
            case .http(503, _):
                return "Phone calls aren't enabled on the server yet."
            default:
                return syncError.localizedDescription
            }
        }
        return error.localizedDescription
    }
}

// MARK: Twilio call delegate

extension PhoneCallService: CallDelegate {
    nonisolated func callDidConnect(call: Call) {
        Task { @MainActor in
            self.state = .connected(.now)
        }
    }

    nonisolated func callDidFailToConnect(call: Call, error: Error) {
        Task { @MainActor in
            self.finishCall(errorMessage: "Call failed: \(error.localizedDescription)")
        }
    }

    nonisolated func callDidDisconnect(call: Call, error: Error?) {
        Task { @MainActor in
            self.finishCall(errorMessage: error.map { "Call ended: \($0.localizedDescription)" })
        }
    }
}
