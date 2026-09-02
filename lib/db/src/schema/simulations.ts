import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export type SimulationGroup = { id: string; name: string; roleName: string; confidentialBrief: string };
export type SimulationInject = {
  id: string; title: string; content: string; responsePrompt: string; responseMinutes: number;
  source?: string; channel?: string;
  /** The deadline the scenario set for this one, in seconds. */
  responseSeconds?: number;
};
/**
 * One thing that happens during a run.
 *
 * `source` and `channel` are optional because rows written before the Studio
 * showed developments as messages do not have them, and a run in progress must
 * not start throwing when the code around it changes.
 */
export type SimulationDevelopment = {
  id: string; title: string; content: string; responsePrompt: string;
  source?: string; channel?: string;
  /**
   * How long they get to answer, and when that runs out.
   *
   * `dueAt` is written when the development is put on the table, so the
   * deadline is a fact on the server rather than a countdown in a browser that
   * a sleeping laptop can quietly stretch. Optional, because developments
   * written before there were deadlines have neither.
   */
  responseSeconds?: number;
  dueAt?: string;
  /** When it landed, so the feed can show a real time rather than an order. */
  at?: string;
  /** What it looks like where it came from. All optional; rendered when present. */
  handle?: string;
  outlet?: string;
  audience?: string;
  reference?: string;
  subjectLine?: string;
  reposts?: number;
  likes?: number;
  replies?: number;
  figures?: { label: string; value: number; unit?: string }[];
};
export type SimulationEvaluationDimension = { name: string; description: string };
export type SimulationRating = { name: string; score: number; note?: string };
export type SimulationDebrief = {
  score: number; headline?: string;
  /** One per thing the scenario judged. Absent on runs finished before this existed. */
  ratings?: SimulationRating[];
  strengths: string[]; risks: string[]; stakeholderImpact: string; recommendations: string[];
};

export const simulationDefinitionsTable = pgTable("simulation_definitions", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Optional legacy/module reuse link; Studio access never relies on this. */
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  /**
   * The programme this exercise was written for, when it was written for one.
   *
   * This is what makes an exercise the cohort's rather than its author's: a
   * published exercise with a programme is visible to everybody enrolled on
   * that programme. Null means it belongs to whoever made it and nobody else.
   *
   * "set null" rather than "cascade" on purpose. Deleting a programme should
   * not silently destroy the exercises written for it, and an orphaned one
   * simply goes back to being private to its author.
   */
  programId: integer("program_id").references(() => programsTable.id, { onDelete: "set null" }),
  mode: text("mode").notNull().default("autonomous"),
  title: text("title").notNull(),
  difficulty: text("difficulty").notNull().default("intermediate"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  participantPerspective: text("participant_perspective").notNull().default("participant"),
  context: text("context").notNull().default(""),
  learningObjective: text("learning_objective").notNull().default(""),
  openingBrief: text("opening_brief").notNull().default(""),
  groups: jsonb("groups").$type<SimulationGroup[]>().notNull().default([]),
  injects: jsonb("injects").$type<SimulationInject[]>().notNull().default([]),
  debriefQuestions: jsonb("debrief_questions").$type<string[]>().notNull().default([]),
  evaluationDimensions: jsonb("evaluation_dimensions").$type<SimulationEvaluationDimension[]>().notNull().default([]),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("simulation_definitions_owner_idx").on(t.ownerId),
  index("simulation_definitions_program_idx").on(t.programId),
  uniqueIndex("simulation_definitions_session_unique").on(t.sessionId),
]);

export const simulationRunsTable = pgTable("simulation_runs", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),
  definitionId: integer("definition_id").notNull().references(() => simulationDefinitionsTable.id, { onDelete: "restrict" }),
  mode: text("mode").notNull().default("autonomous"),
  status: text("status").notNull().default("active"),
  joinCode: text("join_code"),
  operationToken: text("operation_token"),
  operationStartedAt: timestamp("operation_started_at", { withTimezone: true }),
  responseVersion: integer("response_version").notNull().default(0),
  currentDevelopment: jsonb("current_development").$type<SimulationDevelopment | null>(),
  developments: jsonb("developments").$type<SimulationDevelopment[]>().notNull().default([]),
  debrief: jsonb("debrief").$type<SimulationDebrief | null>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  debriefAt: timestamp("debrief_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex("simulation_runs_session_unique").on(t.sessionId), uniqueIndex("simulation_runs_join_code_unique").on(t.joinCode), index("simulation_runs_owner_idx").on(t.ownerId)]);

export const simulationGroupAssignmentsTable = pgTable("simulation_group_assignments", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => simulationRunsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("simulation_group_assignments_run_user_unique").on(t.runId, t.userId),
  index("simulation_group_assignments_run_group_idx").on(t.runId, t.groupId),
]);

export const simulationResponsesTable = pgTable("simulation_responses", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => simulationRunsTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),
  injectId: text("inject_id").notNull(),
  body: text("body").notNull(),
  authorId: integer("author_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex("simulation_responses_run_group_inject_unique").on(t.runId, t.groupId, t.injectId)]);

/**
 * One-time admission codes for the standalone Studio.
 *
 * Only a digest is stored. The clear code is shown once to the admin who
 * creates it, then a successful redemption binds it permanently to one user.
 * Facilitated-room join codes remain separate because they grant access to one
 * run, not to the Studio product.
 */
export const studioAccessCodesTable = pgTable("studio_access_codes", {
  id: serial("id").primaryKey(),
  /**
   * How this person got in: a code somebody typed, or a whole cohort let in at
   * once by an admin. A cohort grant is stored here, already redeemed, so that
   * the one question "may this person use the Studio" still has one answer in
   * one place.
   */
  source: text("source").notNull().default("code"),
  codeHash: text("code_hash").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  redeemedByUserId: integer("redeemed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("studio_access_codes_hash_unique").on(t.codeHash),
  index("studio_access_codes_redeemed_by_idx").on(t.redeemedByUserId),
]);

export const insertSimulationDefinitionSchema = createInsertSchema(simulationDefinitionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSimulationDefinition = z.infer<typeof insertSimulationDefinitionSchema>;
export type SimulationDefinition = typeof simulationDefinitionsTable.$inferSelect;