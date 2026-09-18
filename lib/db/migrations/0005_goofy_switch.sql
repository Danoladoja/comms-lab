CREATE TABLE "studio_group_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"approved_by_user_id" integer,
	"approved_at" timestamp with time zone,
	"run_id" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"delivered_beat_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_group_sessions" ADD CONSTRAINT "studio_group_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_group_sessions" ADD CONSTRAINT "studio_group_sessions_definition_id_simulation_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."simulation_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_group_sessions" ADD CONSTRAINT "studio_group_sessions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_group_sessions" ADD CONSTRAINT "studio_group_sessions_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_group_sessions" ADD CONSTRAINT "studio_group_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_group_sessions_program_idx" ON "studio_group_sessions" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_group_sessions_run_unique" ON "studio_group_sessions" USING btree ("run_id");