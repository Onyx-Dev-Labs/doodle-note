CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "kind" text DEFAULT 'meeting' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tokens_user_id_idx" ON "agent_tokens" USING btree ("user_id");