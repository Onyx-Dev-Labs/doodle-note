import Link from "next/link";

import { LegalPage, LegalSection } from "../legal-page";

export const metadata = { title: "Privacy policy | DoodleNote" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="August 27, 2026">
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
          Neon for PostgreSQL, Stripe for billing, Resend for invitation email,
          Twilio for optional voice features, and Microsoft or Google for
          sign-in and calendar access. If you choose an external AI provider,
          the content you submit is sent to that provider under its terms. Local
          AI and Ollama do not require DoodleNote to receive that content.
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
          normal sync process. To request account or hosted-data deletion, email
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
