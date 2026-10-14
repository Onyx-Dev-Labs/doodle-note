-- DEV-485: per-person meeting shares. Adds a new table only; it never writes to the
-- trigger-guarded meetings/notes/transcript_segments tables and never changes
-- meetings.organization_id. Meeting deletion cascades share rows away.
CREATE TABLE "meeting_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_user_id" text,
	"shared_by_user_id" text NOT NULL,
	"include_transcript" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_shares_recipient_email_normalized" CHECK ("meeting_shares"."recipient_email" = lower(btrim("meeting_shares"."recipient_email")))
);
--> statement-breakpoint
ALTER TABLE "meeting_shares" ADD CONSTRAINT "meeting_shares_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_shares" ADD CONSTRAINT "meeting_shares_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_shares" ADD CONSTRAINT "meeting_shares_shared_by_user_id_user_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_shares_meeting_email_uidx" ON "meeting_shares" USING btree ("meeting_id","recipient_email");--> statement-breakpoint
CREATE INDEX "meeting_shares_recipient_email_idx" ON "meeting_shares" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "meeting_shares_recipient_user_id_idx" ON "meeting_shares" USING btree ("recipient_user_id");