CREATE TABLE "meeting_stars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_tag_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "meeting_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "share_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "share_include_transcript" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD COLUMN "platform" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_stars" ADD CONSTRAINT "meeting_stars_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_stars" ADD CONSTRAINT "meeting_stars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_tag_links" ADD CONSTRAINT "meeting_tag_links_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_tag_links" ADD CONSTRAINT "meeting_tag_links_tag_id_meeting_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."meeting_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_tags" ADD CONSTRAINT "meeting_tags_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_stars_meeting_user_uidx" ON "meeting_stars" USING btree ("meeting_id","user_id");--> statement-breakpoint
CREATE INDEX "meeting_stars_user_id_idx" ON "meeting_stars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_tag_links_meeting_tag_uidx" ON "meeting_tag_links" USING btree ("meeting_id","tag_id");--> statement-breakpoint
CREATE INDEX "meeting_tag_links_meeting_id_idx" ON "meeting_tag_links" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_tags_organization_name_uidx" ON "meeting_tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "meeting_tags_organization_id_idx" ON "meeting_tags" USING btree ("organization_id");
