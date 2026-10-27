CREATE TABLE "capstone_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"capstone_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"data" "bytea",
	"submitted_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"score" integer,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capstones" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"words_at_least" integer DEFAULT 0 NOT NULL,
	"words_at_most" integer DEFAULT 0 NOT NULL,
	"max_score" integer DEFAULT 100 NOT NULL,
	"due_at" timestamp with time zone,
	"draft" boolean DEFAULT true NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capstone_submissions" ADD CONSTRAINT "capstone_submissions_capstone_id_capstones_id_fk" FOREIGN KEY ("capstone_id") REFERENCES "public"."capstones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capstone_submissions" ADD CONSTRAINT "capstone_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capstone_submissions" ADD CONSTRAINT "capstone_submissions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capstones" ADD CONSTRAINT "capstones_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capstone_submissions_attempt_unique" ON "capstone_submissions" USING btree ("capstone_id","user_id","attempt");--> statement-breakpoint
CREATE INDEX "capstone_submissions_capstone_status_idx" ON "capstone_submissions" USING btree ("capstone_id","status");--> statement-breakpoint
CREATE INDEX "capstone_submissions_user_idx" ON "capstone_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capstones_program_unique" ON "capstones" USING btree ("program_id");