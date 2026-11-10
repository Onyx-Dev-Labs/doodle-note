/** Curated public help only. Never import internal docs, meeting data, or account data here. */
export type HelpSection = { id: string; title: string; body: string };
export type HelpGuide = {
  slug: string;
  title: string;
  description: string;
  category: string;
  platforms: string;
  related: string[];
  sections: HelpSection[];
  image?: { src: string; alt: string; caption: string };
};

export const helpCategories = [
  "Getting started",
  "Meetings & notes",
  "Bark dictation",
  "Connected features",
  "Troubleshooting",
] as const;

export const helpGuides: HelpGuide[] = [
  {
    slug: "install",
    title: "Install DoodleNote",
    category: "Getting started",
    description: "Find the right download and make yourself at home.",
    platforms: "macOS · Windows beta",
    related: ["first-meeting", "recording-permissions", "privacy"],
    sections: [
      {
        id: "before-you-start",
        title: "Before you start",
        body: "On Mac, you need **Apple Silicon and macOS 14 or later**. On Windows, use **64-bit Windows 10 or 11**; the Windows app is in beta. Bark dictation is available on supported Macs.\n\nThe local app does not need a DoodleNote account. Cloud Sync is optional. Keep an internet connection available for the installer and initial model downloads.",
      },
      {
        id: "install-the-app",
        title: "Download and install",
        body: "1. Open the [download page](/download) and choose your operating system.\n2. Complete the download form and download the installer.\n3. On macOS, open the disk image and drag DoodleNote into Applications. Launch it from Applications. On Windows, run the downloaded installer.\n4. Follow the welcome tour and let required speech models finish preparing.\n\nThe Windows beta installer is unsigned, so Windows may show a SmartScreen warning. Verify that your installer came from DoodleNote’s official download page. On a managed device, ask your administrator if installation is blocked; do not disable your organization’s protections.",
      },
      {
        id: "next-step",
        title: "Make your first meeting",
        body: "You should arrive at the overview with your meetings and notes. Follow [Record your first meeting](/help/first-meeting) for a short test before an important call.\n\nIf setup cannot finish, check your connection and available disk space, then reopen the app. If it still fails, [contact us](/contact) with your operating system, app version, and the visible error. Do not include a private recording.",
      },
    ],
  },
  {
    slug: "first-meeting",
    title: "Record your first meeting",
    category: "Getting started",
    description:
      "Go from a conversation to a useful set of notes, without a meeting bot.",
    platforms: "macOS · Windows beta",
    related: ["recording-permissions", "transcripts", "ai-notes"],
    image: {
      src: "/help/doodlenote-home.png",
      alt: "DoodleNote overview showing recent meetings, folders, and the New button",
      caption:
        "Your meetings and notes live together in the overview. Shown on macOS.",
    },
    sections: [
      {
        id: "before-you-record",
        title: "Before you record",
        body: "Finish installation and speech-model setup. Check [recording permissions](/help/recording-permissions) and make sure your microphone is connected. Let participants know you are recording and obtain any permission required for your meeting.\n\nDoodleNote records from your computer. It does not send a bot into the call.",
      },
      {
        id: "start-a-meeting",
        title: "Start a meeting",
        body: "1. In the overview, choose **New → New meeting**.\n2. Give the meeting a recognizable title.\n3. Start recording in the meeting. If prompted, grant microphone and system-audio access.\n4. Speak a few sentences and check that transcript text appears. For an online call, also check that the other side is captured.\n5. Add rough notes while you listen—names, decisions, or points you want to remember.\n6. Stop recording when the conversation ends.\n\nRun this short test before your first real meeting. If either side is missing, use [Fix recording problems](/help/troubleshoot-recording).",
      },
      {
        id: "review-your-meeting",
        title: "Review and generate notes",
        body: "Open the transcript to check names and important details. With a notes model configured, choose **Generate notes** to turn the transcript and your rough notes into a structured summary. Some configurations also generate notes after recording stops.\n\nYour meeting should appear in the overview. Open it again to confirm your notes and transcript are there. Read [Generate AI notes](/help/ai-notes) for reviewing and refining the result.",
      },
    ],
  },
  {
    slug: "recording-permissions",
    title: "Set up recording permissions",
    category: "Getting started",
    description:
      "Let DoodleNote hear your microphone and the other side of a call.",
    platforms: "macOS · Windows beta",
    related: ["first-meeting", "troubleshoot-recording", "bark"],
    sections: [
      {
        id: "mac-permissions",
        title: "On macOS",
        body: "Your microphone captures your voice. System-audio access captures sound from the meeting app. The macOS permission name can vary by OS version and capture method.\n\n1. Start a short recording and follow DoodleNote’s permission prompts.\n2. If access was denied, open **System Settings → Privacy & Security** and find DoodleNote under Microphone and the relevant screen/system-audio recording permission.\n3. Enable the permissions requested by the app.\n4. Quit and reopen DoodleNote if macOS asks you to, then record another short test.\n\nBark also has separate permissions for shortcuts and inserting text. See [Set up Bark](/help/bark).",
      },
      {
        id: "windows-permissions",
        title: "On Windows",
        body: "Open Windows Settings and find the microphone privacy controls. Allow microphone access for desktop apps, then check that the intended input device is selected and not muted.\n\nFor system audio, use the output device where you hear your meeting. Changing headphones or speakers during a call can change the audio route. Re-test recording after changing devices. Windows support is in beta and does not include Bark.",
      },
      {
        id: "check-both-sides",
        title: "Check both sides",
        body: "Record yourself speaking, then play speech from your meeting app with the speaker’s knowledge. Verify that both appear in the transcript.\n\nIf only your voice appears, investigate the output device and system-audio permission. If only the other speaker appears, check microphone access and input selection. A running timer alone does not prove that both audio sources are working.",
      },
    ],
  },
  {
    slug: "privacy",
    title: "Understand what stays local",
    category: "Getting started",
    description:
      "Know when your data stays on your device and when a connected feature uses the cloud.",
    platforms: "All platforms",
    related: ["notes-model", "sync", "agents"],
    sections: [
      {
        id: "local-by-default",
        title: "Local by default",
        body: "Meeting capture and transcription run on your computer. You can generate notes with a downloaded local model without sending the meeting to an external AI provider. Local use does not require a DoodleNote account.\n\nRecording audio stays on your device. Bark recognizes speech on your Mac and does not keep dictation audio. Your computer’s own access controls and backups still matter.",
      },
      {
        id: "optional-connections",
        title: "When data leaves your device",
        body: "- **External AI:** choosing an external notes provider sends the content needed for the request to that provider. Review the provider notice before enabling it.\n- **Cloud Sync:** uploads meeting content, including notes and transcripts, to your workspace. Recording audio is not uploaded.\n- **Sharing:** anyone with an enabled share link can read the selected content until the link expires or you revoke it.\n- **AI agents:** local access lets another app read your notes. That app may send the content to its own AI provider. Hosted access reads the cloud-synced copy.\n- **Calendar:** connecting a calendar uses that provider’s authorization and brings calendar information into DoodleNote.",
      },
      {
        id: "choose-your-setup",
        title: "Choose your setup",
        body: "For a local workflow, use an on-device notes model and leave cloud connections off. If you enable a connected feature, review its scope and confirm the intended account or workspace.\n\nPausing Sync is not a request to erase data already uploaded. Review cloud data controls separately. See the [privacy policy](/privacy) for the full details and [contact us](/contact) if you need help with a data request.",
      },
    ],
  },
  {
    slug: "transcripts",
    title: "Review a transcript",
    category: "Meetings & notes",
    description:
      "Find what was said, check speaker labels, and return to the original conversation.",
    platforms: "macOS · Windows beta",
    related: ["ai-notes", "troubleshoot-recording", "sharing"],
    image: {
      src: "/help/doodlenote-transcript.png",
      alt: "A DoodleNote meeting with notes and a timestamped speaker transcript side by side",
      caption:
        "Use the transcript alongside your notes to check the original conversation. Shown on macOS.",
    },
    sections: [
      {
        id: "open-the-transcript",
        title: "Open the transcript",
        body: "1. Open a recorded meeting from the overview.\n2. Open its transcript view.\n3. Read the speaker labels and timestamps to find the part you need.\n4. Correct speaker names where the app offers label editing.\n\nA new meeting needs captured speech before it has a transcript. If a recording produces no text, check [recording troubleshooting](/help/troubleshoot-recording).",
      },
      {
        id: "check-important-details",
        title: "Check important details",
        body: "Transcription can mishear names, numbers, acronyms, and overlapping speech. Confirm important decisions against the original conversation before sharing a summary. Speaker labels help organize the transcript; they are not proof of a person’s identity.\n\nWhen a saved recording is available, use playback to check unclear passages. Playback depends on retaining the local audio. Cloud Sync does not upload that recording.",
      },
      {
        id: "use-with-notes",
        title: "Use it with your notes",
        body: "Add context in your rough notes when a transcript needs clarification, then generate or review the AI notes. Treat the summary as a draft: the source conversation is the reference for what was actually said.\n\nBefore sharing, decide whether the recipient needs the transcript at all. The web sharing controls let you choose whether to include it.",
      },
    ],
  },
  {
    slug: "ai-notes",
    title: "Generate AI notes",
    category: "Meetings & notes",
    description:
      "Turn your transcript and rough notes into a summary you can act on.",
    platforms: "macOS · Windows beta",
    related: ["notes-model", "transcripts", "sharing"],
    image: {
      src: "/help/doodlenote-enhanced-notes.png",
      alt: "Generated DoodleNote meeting notes with a summary, decisions, and action items",
      caption:
        "Review the generated summary, decisions, and next steps before using or sharing them.",
    },
    sections: [
      {
        id: "prepare-your-model",
        title: "Prepare your notes model",
        body: "Open **Settings → Notes model** and configure a model before generating notes. Choose a local model or an external provider you have enabled. Local models need a completed download; external providers need a working account, credentials, and network connection.\n\nSee [Choose a notes model](/help/notes-model) for the privacy and setup differences.",
      },
      {
        id: "generate-and-review",
        title: "Generate and review",
        body: "1. Open a meeting with a transcript or rough notes.\n2. Add context you want the summary to preserve, such as correct names or a decision.\n3. Choose **Generate notes** and select a template if offered.\n4. Wait for generation and saving to finish before switching meetings.\n5. Review the result against the transcript and your original notes.\n\nCheck owners, dates, numbers, and action items. AI can omit context or infer something that was never agreed. Edit the notes before sending them to anyone.",
      },
      {
        id: "when-generation-fails",
        title: "If generation does not finish",
        body: "Read the displayed error, then check the selected model in Settings. Finish any pending download. For external AI, check the provider connection and account limits. Retry from the same meeting when ready.\n\nIf the app says the meeting changed during generation, reopen the intended meeting and generate again. Your existing notes should be reviewed before replacing them; a failed request is not evidence that a new summary was saved.",
      },
    ],
  },
  {
    slug: "notes-model",
    title: "Choose a notes model",
    category: "Meetings & notes",
    description: "Use on-device AI or connect your own external provider.",
    platforms: "macOS · Windows beta",
    related: ["ai-notes", "privacy", "ask-your-notes"],
    sections: [
      {
        id: "local-or-external",
        title: "Choose local or external AI",
        body: "The **notes model** generates summaries and answers; it is separate from speech transcription. A local model runs on your computer. An external provider processes the content sent with your request and may charge your provider account.\n\nAvailable local models depend on your device. Choose from the options DoodleNote shows rather than assuming a model available on another computer will work on yours.",
      },
      {
        id: "set-up-a-model",
        title: "Set up a model",
        body: "1. Open **Settings → Notes model**.\n2. Select a supported local model and complete its download, or configure a listed external provider.\n3. For external AI, read the data-sharing notice and enter credentials only into the app’s intended provider settings. Never paste an API key into a meeting, support message, or shared screenshot.\n4. Select the model you want to use.\n5. Open a short test meeting and generate notes.\n\nYou should see a completed summary. The first local request may take longer while the model loads.",
      },
      {
        id: "troubleshoot-models",
        title: "If the model is unavailable",
        body: "Check free disk space and let downloads finish. If local generation is slow, close memory-intensive apps and choose a smaller supported model if one is available.\n\nFor external errors, check the provider credentials, connection, and usage limits. Switching providers changes who processes the request; only make that change if you are comfortable with the data flow.",
      },
    ],
  },
  {
    slug: "organize-notes",
    title: "Organize meetings and notes",
    category: "Meetings & notes",
    description: "Keep quick notes, meeting records, and folders easy to find.",
    platforms: "macOS · Windows beta",
    related: ["ask-your-notes", "transcripts", "sync"],
    sections: [
      {
        id: "create-a-note",
        title: "Capture a quick note",
        body: "Choose **New → New note** in the overview when you want to write without recording a meeting. Give the note a useful title and enter your text. Return to the overview and reopen it to check the saved content.\n\nUse a meeting for recorded conversations and a note for ideas, preparation, or follow-up work.",
      },
      {
        id: "use-folders-and-search",
        title: "Use folders and search",
        body: "1. Give each meeting a recognizable title, such as the project and meeting purpose.\n2. Create a folder from the sidebar for a project or topic.\n3. Use the meeting’s organization controls to place it in the appropriate folder.\n4. Select a folder to narrow the list, or use search to find a meeting again.\n\nA folder organizes your local library. It does not, by itself, share a meeting or grant someone access.",
      },
      {
        id: "trash-and-storage",
        title: "Check Trash before removing data",
        body: "If a meeting seems missing, clear the current search and folder filter, then check **Trash**. Restore it if the app offers that option and you still need it.\n\nTreat permanent deletion and audio cleanup as separate decisions. Read the confirmation before deleting anything. A synced text record does not replace a backup of locally stored audio.",
      },
    ],
  },
  {
    slug: "ask-your-notes",
    title: "Ask questions about your notes",
    category: "Meetings & notes",
    description: "Find decisions and follow-ups across your meeting history.",
    platforms: "macOS · Windows beta",
    related: ["notes-model", "organize-notes", "agents"],
    sections: [
      {
        id: "ask-a-question",
        title: "Ask a focused question",
        body: "Configure a notes model and make sure you have saved meeting content. From the overview, use **Ask anything** to ask a question about your meetings. Include a project, person, or approximate date when it helps narrow the request.\n\nFor example: “What follow-ups did we agree on in the website planning meeting? Include the source meetings and flag anything uncertain.”",
      },
      {
        id: "check-the-answer",
        title: "Check the source",
        body: "Open the referenced meeting and compare the answer with the original notes or transcript. An answer is a starting point for review, especially for deadlines, numbers, or promises to someone else.\n\nIf the response has too little context, name the meeting more precisely or open the relevant meeting and review it directly. Empty results do not prove that a conversation never happened.",
      },
      {
        id: "know-the-boundaries",
        title: "Know the boundaries",
        body: "Asking for a follow-up checklist produces text; it does not mean emails were sent or tasks were created in another service. Verify any action in the service where it would happen.\n\nThe selected AI model’s privacy settings also apply to questions. If you use an external provider, relevant meeting content may be sent to that provider. Read [what stays local](/help/privacy).",
      },
    ],
  },
  {
    slug: "bark",
    title: "Set up Bark dictation",
    category: "Bark dictation",
    description:
      "Speak into the apps you already use, with speech recognition on your Mac.",
    platforms: "macOS · Apple Silicon",
    related: ["bark-shortcuts", "troubleshoot-bark", "privacy"],
    image: {
      src: "/help/doodlenote-bark.png",
      alt: "Bark settings in DoodleNote with enable and keyboard shortcut controls",
      caption:
        "Bark has its own settings and shortcuts. Shown on macOS; controls may vary by app version.",
    },
    sections: [
      {
        id: "before-you-start",
        title: "Before you start",
        body: "Bark is DoodleNote’s dictation feature for supported Apple Silicon Macs. It is off until you enable it in **Settings → Bark**. It is not available in the Windows beta.\n\nBark recognizes your speech on the Mac and does not retain dictation audio. Review any cleanup or transformation settings separately if you choose to use an external AI provider.",
      },
      {
        id: "enable-bark",
        title: "Enable Bark",
        body: "1. Open **Settings → Bark** and turn Bark on.\n2. Complete the permission steps shown there. Microphone access captures speech; Accessibility allows text insertion; some shortcuts also need Input Monitoring.\n3. Finish any required model setup.\n4. Choose a shortcut or a hold-to-talk key.\n5. Open a simple text field in another app and place your cursor in it.\n6. Use the shortcut, speak a short sentence, and stop dictation.\n\nYour words should appear in the field you selected. Review them before sending a message or submitting a form.",
      },
      {
        id: "make-it-yours",
        title: "Make it yours",
        body: "Bark includes cleanup options, per-app style preferences, and a personal dictionary. Start with a short dictation, then adjust one setting at a time so you can hear how it changes your result.\n\nIf no text appears, follow [Fix Bark problems](/help/troubleshoot-bark). Keep the intended text field focused while dictating.",
      },
    ],
  },
  {
    slug: "bark-shortcuts",
    title: "Choose your Bark shortcuts",
    category: "Bark dictation",
    description:
      "Choose between toggling dictation and holding a key while you speak.",
    platforms: "macOS · Apple Silicon",
    related: ["bark", "troubleshoot-bark"],
    sections: [
      {
        id: "choose-a-mode",
        title: "Choose a mode",
        body: "With **press-to-toggle**, a shortcut starts dictation and another press stops it. With **hold-to-talk**, hold your selected key while speaking, then release it to finish.\n\nChoose the mode that suits your workflow. Use the shortcut displayed in your own Bark settings; it may differ from someone else’s configuration.",
      },
      {
        id: "set-your-shortcut",
        title: "Set your shortcut",
        body: "1. Open **Settings → Bark** and find the shortcut controls.\n2. Use the shortcut recorder for the action you want to change.\n3. Press the intended combination, then release the keys before saving.\n4. Check the status beneath the shortcut. Resolve permission requests or conflicts before trying it in another app.\n5. Test in an empty text field.\n\nHold-to-talk choices include modifier keys shown by the app. Avoid combinations that your usual apps already use.",
      },
      {
        id: "recover-a-dictation",
        title: "Recover a dictation",
        body: "Bark’s shortcut settings include actions for pasting or copying the last dictation. If text went into the wrong field, first check that field to avoid inserting the same words twice, then focus the intended destination and use the configured recovery action.\n\nIf a shortcut says it is unavailable, choose another combination. If it asks for Input Monitoring, follow the permissions instructions and relaunch when requested.",
      },
    ],
  },
  {
    slug: "calendar",
    title: "Connect your calendar",
    category: "Connected features",
    description:
      "Bring upcoming meetings into view and start a recording with context.",
    platforms: "Desktop · provider connection required",
    related: ["first-meeting", "privacy", "troubleshoot-recording"],
    sections: [
      {
        id: "connect-an-account",
        title: "Connect an account",
        body: "1. Open **Settings → Calendar**.\n2. Choose the available Google or Microsoft connection for your account.\n3. Complete the provider’s sign-in and permission flow in your browser.\n4. Return to DoodleNote and check the connected account.\n5. Choose the calendars you want to show and use **Sync now** to refresh them.\n\nYour organization may restrict access. If approval is required, contact its administrator. Only connect accounts whose calendar information you intend to use in DoodleNote.",
      },
      {
        id: "start-from-an-event",
        title: "Start from an event",
        body: "Find the event in your upcoming meetings and use its meeting action. DoodleNote can use the event’s context when preparing the meeting. Depending on the event, you may see a recording or joining action.\n\nJoining a call and recording it are distinct. Check DoodleNote’s recording state and transcript before relying on capture. A calendar connection does not place a bot into the call.",
      },
      {
        id: "missing-events",
        title: "If an event is missing",
        body: "Confirm the correct account and calendar are selected. Use **Sync now**, inspect any error, and complete sign-in again only if the connection requires it. An old sync timestamp can mean the displayed schedule is out of date.\n\nYou can still create a meeting manually while calendar access is unavailable.",
      },
    ],
  },
  {
    slug: "sync",
    title: "Set up Cloud Sync",
    category: "Connected features",
    description: "Connect your desktop library to your DoodleNote workspace.",
    platforms: "Desktop & web · Cloud Sync access required",
    related: ["privacy", "sharing", "account-billing"],
    sections: [
      {
        id: "before-you-connect",
        title: "Before you connect",
        body: "Cloud Sync is optional. It uploads meeting content, including notes and transcripts, so you can access it through your workspace. **Recording audio stays on your computer.**\n\nYou need a DoodleNote account and eligible Cloud Sync access. Check [current plans](/pricing). The desktop connection and the workspace you choose determine where the synced content goes.",
      },
      {
        id: "connect-and-sync",
        title: "Connect and sync",
        body: "1. Open **Settings → Get more** in the desktop app.\n2. Use the Cloud Sync account connection and finish sign-in or approval in your browser.\n3. Return to DoodleNote. Confirm the displayed email and workspace.\n4. Turn on **Sync meetings to the cloud**.\n5. Use **Sync now** and wait for pending meetings to finish.\n6. [Open the web workspace](/app) with the same account and check a meeting’s notes and transcript.\n\nA connected account alone does not mean every meeting has uploaded. Check pending items and any displayed error.",
      },
      {
        id: "pause-or-recover",
        title: "Pause or recover Sync",
        body: "Turn off **Sync meetings to the cloud** to pause uploads. **Disconnect** removes the desktop connection. Neither is a promise to delete existing cloud content.\n\nIf approval is stuck, use **Cancel** and restart the connection. If a meeting is missing on the web, check the account, workspace, pending count, and error message before reconnecting. See [Account and billing](/help/account-billing) if access has expired.",
      },
    ],
  },
  {
    slug: "sharing",
    title: "Share a meeting",
    category: "Connected features",
    description:
      "Create a link to reviewed notes and control what it includes.",
    platforms: "Web · synced meeting and sharing permission required",
    related: ["sync", "transcripts", "privacy"],
    sections: [
      {
        id: "review-before-sharing",
        title: "Review before sharing",
        body: "Sync the meeting to your intended workspace, then open it in the [web app](/app). Confirm that you have access to its sharing controls. Review the notes for confidential information and check AI-generated statements against the transcript.\n\nA share link gives access to anyone who has it. Only include content you are permitted to share.",
      },
      {
        id: "create-a-link",
        title: "Create a link",
        body: "1. Open the meeting in the web app and choose **Share**.\n2. Choose whether the link should include the transcript.\n3. Set the link’s expiration.\n4. Choose **Create link**, or **Update link** for an existing link.\n5. Use **Copy link** and review it in a private browser window before sending it yourself.\n\nCreating a link does not send it to anyone. The recording audio is not included in Cloud Sync.",
      },
      {
        id: "revoke-access",
        title: "Update or revoke access",
        body: "Return to **Share** to change the included content or expiration, then save with **Update link**. Choose **Revoke** to stop the public link from working.\n\nRevocation cannot retract copies someone has already made. If a recipient cannot open the link, check whether it expired or was revoked before creating another one.",
      },
    ],
  },
  {
    slug: "agents",
    title: "Connect an AI agent",
    category: "Connected features",
    description:
      "Give a compatible assistant read-only access to your meeting content.",
    platforms: "Local MCP or hosted MCP · availability depends on setup",
    related: ["privacy", "sync", "ask-your-notes"],
    sections: [
      {
        id: "choose-your-connection",
        title: "Choose local or hosted access",
        body: "MCP is a connection that lets an AI assistant use tools supplied by another app. DoodleNote’s meeting tools are read-only: they let an assistant find and read meeting content, not edit or delete it.\n\n**Local MCP** reads meetings on your computer. **Hosted MCP** reads cloud-synced meetings in a workspace and requires eligible cloud access. A local server configuration is not a hosted HTTPS server address.",
      },
      {
        id: "connect-local",
        title: "Connect on your computer",
        body: "1. Open **Settings → Get more** and find **Local MCP**. If the Cloud Sync access screen appears, connect an eligible account to reach the connected tools.\n2. Enable **Allow local AI agents to read meetings**.\n3. Use the available connection control for your client, or copy the generated configuration for another compatible MCP client.\n4. Follow your client’s connection instructions and refresh its tools if needed.\n5. Try a read-only request against a meeting you recognize.\n\nFor example: “Find my website planning meeting and summarize the action items. Name the source meeting and tell me if you cannot access it.”\n\nClient support varies. Seeing a connection configured does not prove that a particular client can use every tool.",
      },
      {
        id: "hosted-and-revocation",
        title: "Hosted access and revocation",
        body: "For a remote client, use the hosted connection guidance and token controls in **web Settings → Agent access**. Select the intended workspace and keep the generated token private. Follow the setup instructions shown for your chosen client.\n\nRevoke hosted tokens from the same settings when they are no longer needed. For local access, turn off the local access toggle. Remember that another AI client may send the content it reads to its own provider; local retrieval does not guarantee local model processing.",
      },
    ],
  },
  {
    slug: "account-billing",
    title: "Manage your account and billing",
    category: "Connected features",
    description:
      "Find your cloud subscription, connected devices, and account controls.",
    platforms: "Web · DoodleNote account required",
    related: ["sync", "privacy", "install"],
    sections: [
      {
        id: "local-and-cloud",
        title: "Local use and your cloud account",
        body: "You can use the local desktop app without a DoodleNote account. An account is used for cloud features such as Sync and sharing. The email used to download the installer does not, by itself, prove that you have an active cloud subscription.\n\nSee [Pricing](/pricing) for current plans and included features.",
      },
      {
        id: "find-your-settings",
        title: "Find your settings",
        body: "1. [Sign in](/login) using the account connected to your desktop app.\n2. Open **Settings** in the web workspace.\n3. Use **Sync & devices** to inspect your connection, **Billing** for subscription controls, or **Account & security** for account settings.\n4. Confirm the current workspace before changing anything.\n\nUse the billing controls shown for your role. If you cannot manage a team’s subscription, ask the workspace owner.",
      },
      {
        id: "access-problems",
        title: "If you cannot access your account",
        body: "Check the email address and sign-in method you used originally. Follow the recovery options presented on the sign-in screen. If you are signed into the wrong account, sign out and return with the intended one.\n\nFor billing or account problems, [contact the team](/contact) with the account email and a description of the problem. Never send a password, sign-in code, API key, or full payment details. A subscription change and deleting cloud data are different actions; read each confirmation carefully.",
      },
    ],
  },
  {
    slug: "troubleshoot-recording",
    title: "Fix recording problems",
    category: "Troubleshooting",
    description:
      "Work through missing audio, empty transcripts, and incomplete recordings.",
    platforms: "macOS · Windows beta",
    related: ["recording-permissions", "transcripts", "notes-model"],
    sections: [
      {
        id: "no-transcript",
        title: "No transcript appears",
        body: "1. Confirm the meeting is actually recording.\n2. Check microphone access and that your input is not muted.\n3. Make sure the required speech model finished downloading and preparing.\n4. Check the app for a capture or model error.\n5. Stop the test, correct the problem, and record a short new test.\n\nDo not assume a timer means speech was captured. If notes generation fails but the transcript is present, troubleshoot the [notes model](/help/notes-model) instead.",
      },
      {
        id: "one-side-missing",
        title: "Only one side is captured",
        body: "If your voice is missing, check the microphone device and permission. If other speakers are missing, check system-audio permission and the output device carrying the meeting sound.\n\nAfter connecting a headset or changing speakers, repeat a short test. On macOS, relaunch DoodleNote if you changed a permission and macOS requested it. See [recording permissions](/help/recording-permissions).",
      },
      {
        id: "interrupted-recording",
        title: "Recording stops or will not start",
        body: "Check available disk space, power/sleep settings, and any visible app error. Keep the computer awake during the meeting. Stop and inspect the existing meeting before starting another recording so you know what was preserved.\n\nIf the issue repeats, [contact us](/contact) with the app version, OS version, input/output devices, and the steps that reproduce it. Include the error text with private details removed. Do not attach a private recording or transcript unless you intentionally choose to share it through an agreed support channel.",
      },
    ],
  },
  {
    slug: "troubleshoot-bark",
    title: "Fix Bark problems",
    category: "Troubleshooting",
    description:
      "Get shortcuts, permissions, and text insertion working together.",
    platforms: "macOS · Apple Silicon",
    related: ["bark", "bark-shortcuts", "recording-permissions"],
    sections: [
      {
        id: "shortcut-not-working",
        title: "The shortcut does nothing",
        body: "Open **Settings → Bark** and confirm Bark is on. Check the shortcut’s status. If it needs Input Monitoring, grant the requested permission in macOS settings and relaunch when instructed. If the combination conflicts with another shortcut, record a different one.\n\nTest in a simple text editor. Bark is not available on Windows.",
      },
      {
        id: "speech-without-text",
        title: "Bark hears me, but no text appears",
        body: "1. Check Bark’s Accessibility permission.\n2. Focus an editable text field in the destination app.\n3. Dictate one short sentence and stop.\n4. Wait for processing to finish before moving the cursor.\n5. If insertion fails, try the configured copy-last or paste-last action and verify where the text goes.\n\nSome fields or apps restrict automated text entry. Compare with a simple text editor to distinguish a permissions problem from a destination-app limitation.",
      },
      {
        id: "unexpected-words",
        title: "The words are not what I expected",
        body: "Check your microphone and background noise first. Review cleanup and style settings, and use the personal dictionary for names or vocabulary you repeat. Test a short phrase after each change.\n\nIf the problem persists, [contact us](/contact) with the app version, macOS version, shortcut mode, destination app, and a non-sensitive example. Never include credentials or private dictated text in a public support post.",
      },
    ],
  },
];

export function getHelpGuide(slug: string): HelpGuide | undefined {
  return helpGuides.find((guide) => guide.slug === slug);
}

export function getHelpNavigation() {
  return helpCategories.map((category) => ({
    title: category,
    guides: helpGuides
      .filter((guide) => guide.category === category)
      .map(({ slug, title }) => ({ slug, title })),
  }));
}
