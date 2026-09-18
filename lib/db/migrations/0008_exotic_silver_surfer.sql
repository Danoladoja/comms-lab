ALTER TABLE "studio_invitations" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_access_codes" ADD COLUMN "exercise" jsonb;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD COLUMN "steer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD COLUMN "subject" text DEFAULT '' NOT NULL;