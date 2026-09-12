# Google OAuth verification: scope and AI data use

Prepared September 12, 2026. This describes the provider replacement patch, not a completed production release or Google's approval. Do not send the response template until the release, published privacy page, and new demo have been verified.

## Calendar permissions and data flow

The desktop authorization request in `apps/desktop/src/main/google-calendar.ts` uses `openid email https://www.googleapis.com/auth/calendar.readonly`. Google treats `email` as the identity scope `https://www.googleapis.com/auth/userinfo.email`. Web Google sign-in also uses the basic profile identity scope. Identity scopes are separate from Calendar API permissions.

The only Calendar scope needed by the current integration is `https://www.googleapis.com/auth/calendar.readonly`. The redundant `https://www.googleapis.com/auth/calendar.calendars.readonly` was removed from the production project's Data Access configuration and saved during this review. Do not add it back. The app lists calendars and reads events from selected calendars; it does not write calendars or events. A metadata-only scope would not authorize reading the events the feature displays. See [Calendar authorization](https://developers.google.com/workspace/calendar/api/auth).

Calendar event titles and IDs can become meeting titles and calendarEventId values. Note generation and questions can include the title, user notes, transcript, speaker labels, prior generated notes, and relevant chat history. Therefore Google-derived data can reach the user-selected AI provider. Do not claim Calendar data is isolated from AI.

Optional Cloud Sync uploads meeting records. User-authorized MCP clients can access synced meeting content. Composio is an optional integration/access path, not the app's model inference gateway. A user's external agent may have its own AI provider; DoodleNote cannot attest to every external client's configuration. The same Limited Use restrictions apply to that downstream use.

## Updated desktop provider inventory

These are bring-your-own-key API accounts. DoodleNote does not supply or certify the user's subscription, billing tier, retention approval, or dashboard settings. Model overrides remain supported within the selected direct provider.

| Provider | API service / required configuration | Default model | Request endpoint |
| --- | --- | --- | --- |
| Anthropic | Commercial API; no training/data-sharing opt-in | claude-sonnet-5 | https://api.anthropic.com/v1/messages |
| OpenAI | API account; no training/data-sharing opt-in; app sends store=false | gpt-5 | https://api.openai.com/v1/responses |
| xAI (Grok) | xAI API account; no permission to train on API inputs/outputs | grok-4.6 | https://api.x.ai/v1/chat/completions |
| Google Gemini | Gemini API project with active Cloud Billing; no training/data-sharing opt-in | gemini-3.8-flash | https://generativelanguage.googleapis.com/v1beta/openai/chat/completions |
| Ollama | Local weights on the user's computer, not a cloud-backed model/proxy | llama3.1 | http://localhost:11434/v1/chat/completions |

The OpenAI-compatible wire format used for Gemini and Grok does not send their requests to OpenAI. There is no aggregator, OpenRouter routing, or fallback to an upstream vendor in this implementation.

The desktop's downloaded local models are Qwen3 4B, Llama 3.1 8B, and Gemma 3 12B. Inference runs on-device through llama.cpp; downloading weights does not upload meeting content to the model publisher. Ollama can be configured outside DoodleNote, so local processing must not be claimed for an externally configured cloud model.

The repository also contains iOS code with on-device Apple Foundation Models and optional direct Anthropic API access (default claude-opus-4-8). This desktop patch does not retrofit the new confirmation into iOS. Disclose any mobile distribution included in the review separately; do not represent the desktop safeguards as covering every build in this repository.

## Terms and safeguards

- [Google Limited Use policy](https://developers.google.com/terms/api-services-user-data-policy): applies to raw and derived Google user data. The privacy page now includes the affirmative Limited Use statement and offline inference disclosure.
- [Gemini API terms](https://ai.google.dev/gemini-api/terms): paid-service data handling applies when the API project has active Cloud Billing. A consumer Gemini subscription is not sufficient. DoodleNote blocks hosted requests until the user confirms the requirements for the selected provider/key. This is an attestation, not an independent billing check, and cannot detect later dashboard changes.
- [Anthropic commercial data use](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training): API content is not used for training by default; users must not opt in to sharing for training.
- [OpenAI API data controls](https://platform.openai.com/docs/guides/your-data) and [optional data sharing](https://help.openai.com/en/articles/10306912-sharing-feedback-evals-and-api-data-with-openai): API training is not enabled by default; sharing opt-ins must remain off. `store=false` is not a claim of account-wide Zero Data Retention.
- [xAI API security](https://docs.x.ai/developers/faq/security): API data is not used for model training without explicit permission. Abuse-monitoring retention and optional Zero Data Retention are distinct from training restrictions. This patch does not enable or certify ZDR on any account.

Previous Groq and OpenRouter configurations remain readable, but generation through them is blocked in the updated desktop. Users must choose a supported provider and enter that provider's key. Old keys are never sent to a replacement provider. An incomplete provider change preserves the prior saved configuration. No meeting or Cloud Sync data migration is required.

Older installed versions retain their old provider behavior until upgraded. Do not claim the new controls apply to those installations. The privacy-page disclosure explicitly calls for an update before external AI use with Google-derived content.

## Verification performed and remaining gates

Automated tests exercise real SDK request serialization with synthetic responses, direct URLs/models, no-network-before-confirmation behavior, retired-provider rejection, and OpenAI store=false. A temporary settings fixture exercises actual settings load/save and proves no old-provider key reuse and preservation of unrelated meeting/profile data. Existing Calendar tests assert the exact requested scope. No paid API request or real user data was used for these tests.

Before replying to Google:

1. Merge and release the reviewed desktop change through normal signing, notarization, updater, and upgrade checks. Record the actual version and source commit.
2. Deploy the privacy page and verify its public URL. Check that its description matches the released desktop.
3. Run a real synthetic-content test with the chosen paid API account. Independently check the demo project's active billing and training-sharing settings. Never show the key or billing/payment details in the recording.
4. Record the supplemental demo below. The original demo did not show AI configuration or use, so it does not establish a model or API tier.
5. Complete the response template with verified facts and obtain approval before sending it as a reply to Google's existing email.

## Supplemental demo script

Use a demo Google account and a synthetic calendar event, not customer meetings.

1. Show the released DoodleNote version and app home page/privacy-policy links. Say: "DoodleNote reads selected calendar events to display meetings and associate a meeting title with notes."
2. Connect Google Calendar from DoodleNote. Show the authorization flow and full consent permissions clearly, including the read-only Calendar permission. Select the demo calendar and show its event inside DoodleNote.
3. Open Notes model settings. Show the direct provider list, select Google Gemini, show the data-use disclosure and billing confirmation. Briefly show that the API project has active Cloud Billing with sensitive fields concealed. Record the actual model selected.
4. Start a note from the synthetic calendar event. Add a short synthetic transcript or recording, then generate notes. Show the title and generated output. Say: "This action sends the displayed meeting context to my selected paid Gemini API project. It is not used for generalized model training under the paid API terms."
5. Show the public privacy policy's Limited Use statement and local/offline processing disclosure. Explain that local models process content on-device; optional Sync and authorized agent access are disclosed separately.
6. Show disconnect/revoke controls without deleting real notes. If agent access is demonstrated, identify the actual external client/provider and its data-use configuration too.

## Response template: draft only, not sent

Hello Google Verification Team,

We have aligned the Calendar permissions. The application requests `https://www.googleapis.com/auth/calendar.readonly`; we removed the redundant `https://www.googleapis.com/auth/calendar.calendars.readonly` from Data Access. The integration reads calendar lists and selected calendars' events and does not modify Calendar data.

[After deployment: identify the released desktop version/source commit and verified public privacy-policy URL.]

We explicitly disclose that a Calendar title can become a meeting title and may be included in AI note generation. Our updated desktop offers the direct API providers and local model options in the inventory below. OpenRouter and Groq have been retired in that desktop version; their existing keys are not migrated to other providers. There is no model aggregator in the updated built-in inference path.

[Include the provider inventory above, actual demo provider/model, confirmed API tier/billing configuration, and applicable data-sharing settings. Do not claim every customer's API account has been independently verified. Disclose any mobile versions included in the review.]

Our privacy policy contains an affirmative Limited Use statement and explains that downloaded local models perform offline inference without sending Google user data back to their publishers. External API use requires confirmation of the provider's no-training requirements; Gemini additionally requires an API project with active Cloud Billing. These confirmations do not independently verify billing or guarantee Zero Data Retention.

The earlier demo did not show the AI flow. [Insert the new reviewer-accessible video URL and timestamps for OAuth consent, paid API configuration, generation, and the privacy disclosure after recording and verification.]

Please let us know if you need further clarification.
