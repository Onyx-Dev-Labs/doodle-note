import Link from "next/link";

import { LegalPage, LegalSection } from "../legal-page";

export const metadata = { title: "Privacy policy | DoodleNote" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 12, 2026">
      <p>
        DoodleNote is operated by Onyx Dev Labs. This policy explains how the
        DoodleNote apps, website, and optional hosted Sync service handle
        information.
      </p>

      <LegalSection title="Local app behavior">
        <p>
          DoodleNote can record, transcribe, store, search, and summarize
          meetings on your device without a DoodleNote account. DoodleNote does
          not upload meeting audio as part of Sync. Local data leaves your
          device only when you enable an optional cloud feature or direct the
          app to use an external provider.
        </p>
      </LegalSection>

      <LegalSection title="Information we process">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Account details such as your name, email address, and sign-in
            provider.
          </li>
          <li>
            Contact-form details such as your name, email address, optional
            company and phone number, and the message you send us.
          </li>
          <li>
            Workspace membership, invitations, linked devices, and security
            tokens.
          </li>
          <li>
            When Sync is enabled, meeting titles, notes, transcripts, speaker
            labels, timestamps, folders, tags, and attachments.
          </li>
          <li>
            Subscription, invoice, and payment-status identifiers from Stripe.
          </li>
          <li>
            Optional integration data for features you enable, such as calendar,
            email invitation, AI provider, hosted agent, or voice calling data.
          </li>
          <li>
            Operational logs needed to secure, diagnose, and maintain the
            service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>
          We use information to provide the features you request, authenticate
          accounts and devices, keep workspaces separated, process billing,
          deliver invitations, prevent abuse, troubleshoot failures, and improve
          reliability. We do not sell personal information or use meeting
          content for advertising.
        </p>
      </LegalSection>

      <LegalSection title="Optional providers">
        <p>
          Hosted features may use Vercel for application and object hosting,
          Neon for PostgreSQL, Stripe for billing, Resend for account,
          invitation, billing, and contact-form email, Twilio for optional voice
          features, and Microsoft or Google for sign-in and calendar access. If
          you choose an external AI provider, the content you submit is sent to
          that provider under its terms. Local AI and Ollama do not require
          DoodleNote to receive that content.
        </p>
      </LegalSection>

      <LegalSection title="Google user data and Limited Use">
        <p>
          DoodleNote&apos;s use and transfer of information received from Google
          APIs, including raw and derived Google Workspace API data, will adhere
          to the{' '}
          <a className="text-sage-deep underline" href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements. We do not use Google user
          data to train generalized AI or machine-learning models, sell it, or use
          it for advertising. Google user data must not be sent to a service or
          account configuration that uses it for generalized model training.
        </p>
        <p>
          When you connect Google Calendar, DoodleNote reads your calendar list
          and selected calendars&apos; events to display upcoming meetings and
          meeting links. This includes calendar names, event titles, times,
          locations, organizer details, and whether participants are present.
          The desktop integration requests calendar.readonly and does not create,
          edit, or delete Google calendars or events. OAuth tokens are stored
          locally using operating-system encryption. Disconnecting Google Calendar
          removes its local credentials; you can also revoke access in your Google account.
        </p>
        <p>
          Starting a note from a calendar event can copy its title and event
          identifier into the meeting record. That title, and text derived from
          it, may be included in note generation and meeting questions. Enabling
          Cloud Sync can upload that meeting record. Granting an agent or
          Composio access can expose the synced title and meeting content to
          that client. Disconnecting Calendar does not delete meeting notes
          already created from events; use the meeting deletion controls to remove them.
        </p>
      </LegalSection>

      <LegalSection title="AI processing and your provider choices">
        <p>
          On-device AI runs downloaded model weights locally, including Qwen,
          Llama, and Gemma models. In this offline inference mode, Google user
          data and meeting content are processed on your device and are not
          sent back to the model publisher for training or secondary purposes.
          Downloading a model is separate from sending it meeting content.
          Ollama connects to localhost; this local-processing description applies
          when you run local weights, not a cloud-backed model or proxy you configure.
        </p>
        <p>
          Optional external AI uses your own API account. Supported direct
          providers are Anthropic, OpenAI, xAI (Grok), and Google Gemini with an
          active Cloud Billing project. A consumer chatbot subscription is not
          the same as an API account. Meeting titles, transcripts, notes, speaker
          labels, questions, and relevant conversation history can be sent to
          the provider you select. Meeting audio is not sent for note generation.
          Do not enable provider options that share these inputs or outputs for
          model training. Unpaid Gemini API configurations are not permitted for
          this processing. Provider abuse-monitoring retention may still apply;
          a no-training policy does not itself mean zero retention.
        </p>
        <p>
          These direct-provider changes require an updated desktop app. Older
          versions offered Groq and OpenRouter. Update before using external AI
          with Google-derived content. The updated app preserves retired-provider
          settings but blocks their use until you choose a supported provider;
          it never transfers an old key to a replacement provider. It asks you
          to confirm the selected API account&apos;s data-use requirements. It
          cannot independently verify your Gemini billing status or changes you
          later make in a provider&apos;s dashboard.
        </p>
        <p>
          Remote MCP and Composio are optional access paths for clients you
          authorize, not built-in model hosting. Only connect them to clients
          and API accounts whose data-use settings comply with the same Limited
          Use restrictions. Revoke the dedicated agent token to end that access.
        </p>
      </LegalSection>

      <LegalSection title="Sharing and link access">
        <p>
          Meeting sharing is off by default. Anyone with an enabled public share
          link can view the content included in that link until it expires or is
          revoked. Synced attachments use difficult-to-guess object URLs, but a
          person who receives an attachment URL may be able to open it. Do not
          sync or share content you are not authorized to disclose.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Local data remains on your device until you remove it. Hosted data is
          retained while needed to provide your account and Sync service, meet
          legal obligations, resolve disputes, and maintain security records.
          Deleting a synced meeting removes the active cloud record through the
          normal sync process.
        </p>
        <p>
          When you schedule cancellation, Cloud Sync remains available through
          the date Stripe shows in the billing portal. On that date, DoodleNote
          permanently deletes the active cloud copy of meetings, transcripts,
          notes, folders, tags, public share links, and attachments in your
          Personal workspace and disconnects your linked Sync devices and
          hosted-agent tokens. Local notes and recordings remain on your
          devices. Content in shared workspaces is retained for the other
          workspace members, while your access through the canceled subscription
          ends. Encrypted provider backups may retain deleted records until they
          age out through the provider&apos;s normal backup rotation, but those
          records are not available through the service.
        </p>
        <p>
          Billing, email-delivery, security, and deletion audit records may be
          retained when required for legal, fraud-prevention, and operational
          accountability purposes. To request account or other hosted-data
          deletion, email
          <a
            className="ml-1 text-sage-deep underline"
            href="mailto:team@onyxdev.io"
          >
            team@onyxdev.io
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Security and choices">
        <p>
          We use encrypted transport, scoped account and workspace access, and
          hashed device and agent tokens. No system can guarantee absolute
          security. You can keep all meetings local, disable Sync, revoke share
          links and devices, disconnect integrations, or request deletion.
        </p>
      </LegalSection>

      <LegalSection title="Children and policy changes">
        <p>
          DoodleNote is not directed to children under 13. We may update this
          policy as the product changes. Material changes will be posted here
          with a new effective date.
        </p>
      </LegalSection>

      <p>
        Questions about this policy can be sent to{" "}
        <a className="text-sage-deep underline" href="mailto:team@onyxdev.io">
          team@onyxdev.io
        </a>
        . Security reports should follow the private process in the
        repository&apos;s{" "}
        <Link
          className="text-sage-deep underline"
          href="https://github.com/Onyx-Dev-Labs/doodle-note/security/policy"
        >
          security policy
        </Link>
        .
      </p>
    </LegalPage>
  );
}
