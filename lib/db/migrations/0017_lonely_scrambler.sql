CREATE TABLE "team_room_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"group_id" text NOT NULL,
	"inject_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"author_id" integer NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_room_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"group_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_room_nods" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_room_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"group_id" text NOT NULL,
	"voter_id" integer NOT NULL,
	"for_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_room_drafts" ADD CONSTRAINT "team_room_drafts_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_drafts" ADD CONSTRAINT "team_room_drafts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_messages" ADD CONSTRAINT "team_room_messages_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_messages" ADD CONSTRAINT "team_room_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_nods" ADD CONSTRAINT "team_room_nods_draft_id_team_room_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."team_room_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_nods" ADD CONSTRAINT "team_room_nods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_votes" ADD CONSTRAINT "team_room_votes_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_votes" ADD CONSTRAINT "team_room_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_room_votes" ADD CONSTRAINT "team_room_votes_for_user_id_users_id_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_room_drafts_run_group_inject_unique" ON "team_room_drafts" USING btree ("run_id","group_id","inject_id");--> statement-breakpoint
CREATE INDEX "team_room_messages_run_group_idx" ON "team_room_messages" USING btree ("run_id","group_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_room_nods_draft_user_version_unique" ON "team_room_nods" USING btree ("draft_id","user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "team_room_votes_run_group_voter_unique" ON "team_room_votes" USING btree ("run_id","group_id","voter_id");