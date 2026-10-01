CREATE TABLE "form_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"number" integer,
	"text" text DEFAULT '' NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"help" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pair_key" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"program_id" integer NOT NULL,
	"stage" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"draft" boolean DEFAULT true NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_question_id_form_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_form_id_program_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."program_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_id_program_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."program_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_forms" ADD CONSTRAINT "program_forms_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_answers_response_question_unique" ON "form_answers" USING btree ("response_id","question_id");--> statement-breakpoint
CREATE INDEX "form_answers_question_idx" ON "form_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "form_questions_form_idx" ON "form_questions" USING btree ("form_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_form_user_unique" ON "form_responses" USING btree ("form_id","user_id");--> statement-breakpoint
CREATE INDEX "form_responses_form_idx" ON "form_responses" USING btree ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_forms_program_stage_unique" ON "program_forms" USING btree ("program_id","stage");