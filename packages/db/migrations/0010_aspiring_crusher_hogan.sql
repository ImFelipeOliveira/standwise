CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" bigint NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "suggestions_installation_id_member_id_fingerprint_unique" UNIQUE("installation_id","member_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;