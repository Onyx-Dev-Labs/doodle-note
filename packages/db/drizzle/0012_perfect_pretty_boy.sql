CREATE TABLE "billing_data_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "billing_data_deletions" ADD CONSTRAINT "billing_data_deletions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notifications" ADD CONSTRAINT "billing_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_data_deletions_due_idx" ON "billing_data_deletions" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_notifications_dedupe_key_uidx" ON "billing_notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "billing_notifications_pending_idx" ON "billing_notifications" USING btree ("sent_at","created_at");