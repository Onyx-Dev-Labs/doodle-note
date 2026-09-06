---
status: accepted
---

# Explicit external AI choice and local recording audio

The mobile app favors on-device processing where it meets requirements and may use external AI only after the user explicitly enables it. It must not silently upload content when local processing is unavailable. This preserves the user's processing choice at the cost of requiring explicit handling when local capabilities are insufficient.

V1 cloud sync carries notes and transcripts while recording audio remains on its recording device until user removal. This avoids adding cloud audio storage and playback to the initial release, but a synced transcript on another device will not have playable audio. Later rounds accept extending sync for editable ink/previews, a complete user-directed archive backup including local audio, and free core functionality with optional existing paid Sync. Archive protection/restore details, device support, provider selection, credential handling, and the purchase flow remain separate implementation or final-review decisions.

External AI processing consent is distinct from enabling cloud note synchronization. Keeping audio out of DoodleNote cloud sync does not itself decide whether an explicitly selected external transcription provider may receive audio.

Round 4 selects user-supplied provider API keys for optional external AI. Provider charges remain separate from the DoodleNote sync subscription; there is no accepted mobile managed-inference billing service.
