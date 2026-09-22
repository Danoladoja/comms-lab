CREATE TABLE "module_unlocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"granted_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module_unlocks" ADD CONSTRAINT "module_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_unlocks" ADD CONSTRAINT "module_unlocks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_unlocks" ADD CONSTRAINT "module_unlocks_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_unlocks_user_session_unique" ON "module_unlocks" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "module_unlocks_session_idx" ON "module_unlocks" USING btree ("session_id");