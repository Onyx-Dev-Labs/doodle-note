-- Keep this as ONE statement: the Neon HTTP migrator autocommits each call and
-- journals only after every pending migration ran, so a retry must be safe.
DO $migration$
BEGIN
  CREATE TABLE IF NOT EXISTS "download_lead_links" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "lead_id" uuid NOT NULL,
    "user_id" text NOT NULL,
    "method" text NOT NULL,
    "verified_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "download_lead_links_lead_id_download_leads_id_fk" FOREIGN KEY ("lead_id")
      REFERENCES "public"."download_leads"("id") ON DELETE cascade ON UPDATE no action,
    CONSTRAINT "download_lead_links_user_id_user_id_fk" FOREIGN KEY ("user_id")
      REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "download_lead_links_lead_uidx" ON "download_lead_links" USING btree ("lead_id");
  CREATE INDEX IF NOT EXISTS "download_lead_links_user_idx" ON "download_lead_links" USING btree ("user_id");

  -- download_lead_linked events carry no platform or download time.
  ALTER TABLE "download_lead_events" ALTER COLUMN "platform" DROP NOT NULL;
  ALTER TABLE "download_lead_events" ALTER COLUMN "requested_at" DROP NOT NULL;
END
$migration$;
