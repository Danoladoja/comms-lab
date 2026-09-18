import path from "node:path";
import app from "./app";
import { db, schemaGap } from "@workspace/db";
import {
  startupVerdict,
  shouldRunMigrations, migrationOutcomeMessage, shouldStopBooting,
  type MigrationOutcome,
} from "@workspace/domain";
import { applyPendingMigrations } from "./lib/migrateAtStartup";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminders";
import { startRecordingSync } from "./lib/recordingSync";
import { startMeetAttendanceSync } from "./lib/meetAttendanceSync";
import { startTranscriptSync } from "./lib/transcriptSync";
import { startGroupSessionTicker } from "./lib/groupSessions";
import { startSoloRunSweep } from "./routes/studioSimulations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Bring the database up to the code, before anything is served.
 *
 * The step that used to be a person's errand. Twice now the code has moved and
 * the database has not — once leaving forty-five learners looking at an error
 * where their completed work should have been, once leaving the app in a crash
 * loop — and both times the missing action was a single command somebody had
 * been told about in passing. A deploy should be one thing.
 */
async function migrateDatabase(): Promise<MigrationOutcome> {
  if (!shouldRunMigrations(process.env)) return { kind: "skipped" };

  // Beside the bundle, put there by the build. Resolved from the running
  // file's own directory rather than from the monorepo layout, which is not
  // guaranteed to survive a deploy.
  const folder = path.join(__dirname, "migrations");
  try {
    return await applyPendingMigrations(folder);
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Refuse to serve a database that is behind the code.
 *
 * Now a backstop rather than the only line of defence: migrations are applied
 * above, so in the ordinary case there is nothing here to catch. It still earns
 * its place for the cases where there would be — a skipped migration, a failed
 * one, a database restored from an older backup, a build that shipped without
 * its migration files.
 *
 * Checked once, here, where a failure is a deploy that visibly did not finish.
 *
 * It fails OPEN on an unexpected error, and that is deliberate. This guards one
 * known state — the database missing something the code needs. If the check
 * itself cannot run, refusing to start would take a working site down for a
 * reason nobody could act on, which is a worse failure than the one being
 * prevented. A database that is genuinely unreachable stops the app a moment
 * later anyway, with a clearer message than this could give.
 */
async function databaseIsReady(): Promise<boolean> {
  let gap;
  try {
    gap = await schemaGap(db);
  } catch (err) {
    logger.error({ err }, "Could not check whether the database matches the code — starting anyway");
    return true;
  }

  const verdict = startupVerdict(gap);
  if (!verdict.refuseToStart) {
    logger.info("Database matches the code");
    return true;
  }

  // Printed rather than logged as structured JSON: this is read by a person
  // scanning a deploy log, and a wall of escaped newlines inside a single log
  // line is how the instruction comes to be missed.
  console.error(verdict.message);
  logger.error(
    { missingTables: gap.missingTables, missingColumns: gap.missingColumns.slice(0, 20) },
    "Refusing to start: the database is behind the code",
  );
  return false;
}

async function main(): Promise<void> {
  const migration = await migrateDatabase();
  if (shouldStopBooting(migration)) {
    // Printed rather than logged as JSON, for the same reason as the schema
    // verdict below: this is read by a person scanning a red deploy log.
    console.error(migrationOutcomeMessage(migration));
    logger.error({ outcome: migration.kind }, "Refusing to start: a database migration failed");
    process.exit(1);
  }
  logger.info({ outcome: migration.kind }, migrationOutcomeMessage(migration));

  if (!await databaseIsReady()) {
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startReminderScheduler();
    startRecordingSync();
    startMeetAttendanceSync();
    startTranscriptSync();
    startGroupSessionTicker();
    // Solo exercises end themselves too, now — not only when somebody looks.
    startSoloRunSweep();
  });
}

void main();
