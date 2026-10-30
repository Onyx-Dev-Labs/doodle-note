-- Keep this as ONE statement: the Neon HTTP migrator autocommits each call and
-- journals only after every pending migration ran, so a retry must be safe.
DO $migration$
BEGIN
  CREATE TABLE IF NOT EXISTS "download_leads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL,
    "source" text DEFAULT 'website_download' NOT NULL,
    "first_platform" text NOT NULL,
    "latest_platform" text NOT NULL,
    "first_requested_at" timestamp with time zone NOT NULL,
    "latest_requested_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 1 NOT NULL,
    "marketing_consent" boolean DEFAULT false NOT NULL,
    "marketing_consent_at" timestamp with time zone,
    "marketing_consent_version" text,
    "marketing_consent_text" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "download_leads_email_uidx" ON "download_leads" USING btree ("email");

  CREATE TABLE IF NOT EXISTS "download_lead_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "dedupe_key" text NOT NULL,
    "lead_id" uuid NOT NULL,
    "event_type" text NOT NULL,
    "platform" text NOT NULL,
    "requested_at" timestamp with time zone NOT NULL,
    "sync_status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
    "claim_token" uuid,
    "claimed_at" timestamp with time zone,
    "synced_at" timestamp with time zone,
    "sync_outcome" text,
    "mailcheap_contact_id" text,
    "last_error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "download_lead_events_lead_id_download_leads_id_fk" FOREIGN KEY ("lead_id")
      REFERENCES "public"."download_leads"("id") ON DELETE cascade ON UPDATE no action
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "download_lead_events_dedupe_key_uidx" ON "download_lead_events" USING btree ("dedupe_key");
  CREATE INDEX IF NOT EXISTS "download_lead_events_pending_idx" ON "download_lead_events" USING btree ("sync_status","next_attempt_at");
  CREATE INDEX IF NOT EXISTS "download_lead_events_lead_idx" ON "download_lead_events" USING btree ("lead_id");
END
$migration$;
