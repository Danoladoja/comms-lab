CREATE TABLE "studio_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"program_id" integer NOT NULL,
	"session_id" integer,
	"objective" text NOT NULL,
	"situation_seed" text NOT NULL,
	"difficulty" text DEFAULT 'intermediate' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"invited_by_user_id" integer NOT NULL,
	"definition_id" integer,
	"run_id" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_definition_id_simulation_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."simulation_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_invitations" ADD CONSTRAINT "studio_invitations_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_invitations_user_idx" ON "studio_invitations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "studio_invitations_program_idx" ON "studio_invitations" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_invitations_run_unique" ON "studio_invitations" USING btree ("run_id");