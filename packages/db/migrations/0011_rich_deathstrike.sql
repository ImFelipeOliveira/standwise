ALTER TABLE "connections" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "invalidated_at" timestamp with time zone;