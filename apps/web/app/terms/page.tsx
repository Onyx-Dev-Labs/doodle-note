import { LegalPage, LegalSection } from "../legal-page";

export const metadata = { title: "Terms of service | DoodleNote" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="August 31, 2026">
      <p>
        These terms apply to the official DoodleNote website, signed apps, and
        hosted Sync service operated by Onyx Dev Labs. By creating an account or
        using the hosted service, you agree to these terms.
      </p>

      <LegalSection title="Local software and open source">
        <p>
          DoodleNote source code is available under the MIT License. The MIT
          License governs your use, modification, and redistribution of that
          source code. These service terms separately govern the official hosted
          service, signed builds, accounts, billing, support, and DoodleNote
          trademarks.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and security">
        <p>
          You must provide accurate account information and protect access to
          your account, linked devices, share links, and agent tokens. You are
          responsible for activity performed through credentials you control.
          Notify us promptly at team@onyxdev.io if you suspect unauthorized
          access.
        </p>
      </LegalSection>

      <LegalSection title="Recording and content responsibility">
        <p>
          You are responsible for obtaining any consent required to record,
          transcribe, store, process, or share a conversation. You retain
          ownership of your meeting content. You grant Onyx Dev Labs only the
          limited permission needed to host, transmit, back up, and display
          content through features you enable.
        </p>
      </LegalSection>

      <LegalSection title="Hosted Sync and public links">
        <p>
          Sync is optional. Enabling it sends selected meeting content to the
          hosted service, but not recording audio. Public share links and
          link-accessible attachments can be opened by anyone who obtains the
          URL. You are responsible for choosing what to sync or share and for
          revoking access when it is no longer appropriate.
        </p>
      </LegalSection>

      <LegalSection title="Billing">
        <p>
          The current official Sync price, trial period, taxes, and renewal
          terms are shown at checkout. Stripe processes payments. Subscriptions
          renew until canceled through the billing portal. Canceling stops
          future renewals. Cloud Sync remains available through the cancellation
          date shown by Stripe. On that date, DoodleNote permanently deletes the
          active cloud copy in your Personal workspace and disconnects your
          linked Sync devices and hosted-agent tokens. Meetings, notes, and
          recordings stored locally on your devices are not deleted.
          Shared-workspace content is retained for the other workspace members.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You may not use DoodleNote to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            violate law, privacy rights, intellectual-property rights, or
            recording-consent requirements;
          </li>
          <li>
            access another person&apos;s account, workspace, data, or systems
            without authorization;
          </li>
          <li>
            distribute malware, abuse the service, evade limits, or interfere
            with service operation; or
          </li>
          <li>
            misrepresent a fork or modified build as an official DoodleNote
            product.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>
          Optional providers such as Microsoft, Google, Stripe, Twilio, external
          AI services, model hosts, and self-hosted infrastructure operate under
          their own terms. Onyx Dev Labs is not responsible for a third-party
          service you choose or operate.
        </p>
      </LegalSection>

      <LegalSection title="Service changes and termination">
        <p>
          We may change, suspend, or discontinue hosted features to maintain
          security, reliability, legal compliance, or product direction. We may
          restrict or terminate accounts used unlawfully or in material breach
          of these terms. You may stop using the service and cancel Sync at any
          time.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          To the fullest extent permitted by law, the hosted service and signed
          apps are provided without warranties of uninterrupted or error-free
          operation. Onyx Dev Labs is not liable for indirect, incidental,
          special, consequential, or lost-profit damages. Total liability for a
          hosted-service claim is limited to the amount you paid for that
          service during the 12 months before the claim.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          We may update these terms as the product changes. The effective date
          above identifies the current version. Questions can be sent to{" "}
          <a className="text-sage-deep underline" href="mailto:team@onyxdev.io">
            team@onyxdev.io
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
