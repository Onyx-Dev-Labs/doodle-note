ALTER TABLE "meetings" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_share_token_unique" UNIQUE("share_token");