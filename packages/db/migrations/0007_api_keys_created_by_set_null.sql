ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_created_by_members_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;