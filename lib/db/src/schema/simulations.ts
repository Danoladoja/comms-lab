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
   * Which team this landed on, when it landed on only one.
   *
   * Absent on everything written before group sessions existed, and on every
   * beat that lands on the whole room — so absent means "everybody", which is
   * what every existing run means by it.
   */
  teamId?: string;
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
  /**
   * One debrief per team, for a run that had teams.
   *
   * A group session is one run carrying several teams' feeds, and each team
   * only ever saw its own side of the crisis. Judging them all against a single
   * debrief would mark most of them on evidence they never had. Empty on every
   * solo run and on every run written before group sessions existed, where
   * `debrief` above is the whole answer.
   */
  teamDebriefs: jsonb("team_debriefs")
    .$type<{ teamId: string; debrief: SimulationDebrief }[]>().notNull().default([]),
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
/**
 * One learner, invited once, to run one individual exercise.
 *
 * The Studio runs on API tokens, and until now nothing counted. Anybody the Lab
 * had ever invited could open it, fill in a form, and generate as many
 * scenarios as the daily cap allowed — each one a model call, none of them
 * connected to what that person is supposed to be learning.
 *
 * So an invitation is the unit. An admin sends one; it buys exactly one run of
 * exactly one exercise; and when it is spent it is spent. The objective is
 * frozen onto the row at the moment of sending, so an admin editing a
 * programme next week cannot change what somebody was asked to practise
 * yesterday.
 *
 * Access codes are untouched. They are how people who are not on a programme
 * get in, and that route is not the one that needed governing.
 */
export const studioInvitationsTable = pgTable("studio_invitations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
  /** The module this practises, when it was sent for one. */
  sessionId: integer("session_id").references(() => sessionsTable.id, { onDelete: "set null" }),

  /**
   * What they are practising, in the programme's own words.
   *
   * Copied here rather than read from the programme when the exercise is
   * built. A learner asked on Monday to practise one thing must not find on
   * Thursday that they were judged against something else because somebody
   * tidied up a module description in between.
   */
  objective: text("objective").notNull(),

  /**
   * What decides this learner's situation.
   *
   * Everyone on a cohort practises the same objective against a different
   * crisis — a different country, a different kind of organisation, a different
   * thing going wrong. The seed is stored rather than generated on the fly so
   * that reloading the page cannot reshuffle somebody's scenario, and so that
   * two people comparing notes find they were genuinely given different work.
   */
  situationSeed: text("situation_seed").notNull(),

  difficulty: text("difficulty").notNull().default("intermediate"),
  durationMinutes: integer("duration_minutes").notNull().default(30),

  invitedByUserId: integer("invited_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),

  /**
   * The exercise built for this invitation.
   *
   * Written the first time they press Begin and never again, so the model is
   * asked once per invitation rather than once per page load. A learner who
   * refreshes gets the scenario they already had.
   */
  definitionId: integer("definition_id").references(() => simulationDefinitionsTable.id, { onDelete: "set null" }),

  /** The one run this invitation buys. Null until they start. */
  runId: integer("run_id").references(() => simulationRunsTable.id, { onDelete: "set null" }),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** After this, it cannot be started. Null means it does not expire. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("studio_invitations_user_idx").on(t.userId),
  index("studio_invitations_program_idx").on(t.programId),
  // One run per invitation, enforced by the database rather than by care.
  uniqueIndex("studio_invitations_run_unique").on(t.runId),
]);

export type StudioInvitation = typeof studioInvitationsTable.$inferSelect;

export type GroupSessionObjective = { id: string; text: string; note: string; enabled: boolean };
export type GroupSessionBeat = {
  id: string; atMinute: number; scope: "all" | "team";
  title: string; content: string; responsePrompt: string; responseMinutes: number;
};

/**
 * A group simulation, scheduled, with nobody at the front of the room.
 *
 * The facilitated mode this replaces needed a person to press "what happens
 * next" at every beat — so a room without that person stalled after the opening
 * development, and the person pressing it was running the exercise rather than
 * watching it. This one runs on a clock.
 *
 * The row exists from the moment the Lab writes the scenario, in draft, so an
 * admin can read the objectives and the running order before a single learner
 * knows the session exists. Nothing about it reaches a cohort until `approvedAt`
 * is set, and after that nothing about it can be edited: the cohort has been
 * told what they are turning up to.
 */
export const studioGroupSessionsTable = pgTable("studio_group_sessions", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
  /** The scenario, written when the draft was created. */
  definitionId: integer("definition_id").notNull().references(() => simulationDefinitionsTable.id, { onDelete: "restrict" }),
  title: text("title").notNull().default(""),

  /**
   * What the debriefs will be written against, after the admin has edited and
   * switched off whatever this cohort has not covered.
   */
  objectives: jsonb("objectives").$type<GroupSessionObjective[]>().notNull().default([]),

  /**
   * The running order: what happens, to whom, at which minute.
   *
   * A beat with scope "all" is written here in full and approved word for word.
   * A beat with scope "team" holds its *intent* — its wording is written during
   * the session from what that team has just done, and cannot exist in advance
   * because it quotes a learner who has not answered yet.
   */
  beats: jsonb("beats").$type<GroupSessionBeat[]>().notNull().default([]),

  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(45),

  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  /** The one run every team shares. Written when it goes live. */
  runId: integer("run_id").references(() => simulationRunsTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),

  /** Beat ids already on the table, so the ticker never delivers one twice. */
  deliveredBeatIds: jsonb("delivered_beat_ids").$type<string[]>().notNull().default([]),

  /**
   * The debrief across the whole room, for whoever set the session up.
   *
   * Each team gets its own, written the way an individual's is. This is the
   * other one, and it is the genuinely new thing a group exercise produces:
   * every participant saw only their own side, so where two teams' versions of
   * events failed to line up is invisible to all of them.
   */
  sessionDebrief: jsonb("session_debrief").$type<{
    headline: string;
    whatHappened: string;
    contradictions: string[];
    byObjective: { objective: string; verdict: string }[];
    recommendations: string[];
  } | null>(),

  createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("studio_group_sessions_program_idx").on(t.programId),
  uniqueIndex("studio_group_sessions_run_unique").on(t.runId),
]);

export type StudioGroupSession = typeof studioGroupSessionsTable.$inferSelect;
