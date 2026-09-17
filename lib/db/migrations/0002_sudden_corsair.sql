CREATE TABLE "deadline_extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"program_id" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"granted_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_extensions_user_session_unique" ON "deadline_extensions" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "deadline_extensions_user_program_idx" ON "deadline_extensions" USING btree ("user_id","program_id");