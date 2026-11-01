CREATE TABLE "beta_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"team_size" text NOT NULL,
	"chat" text NOT NULL,
	"tracker" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "beta_requests_email_idx" ON "beta_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "beta_requests_created_at_idx" ON "beta_requests" USING btree ("created_at");