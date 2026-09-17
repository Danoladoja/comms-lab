import app from "./app";
import { db, schemaGap } from "@workspace/db";
import { startupVerdict } from "@workspace/domain";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminders";
import { startRecordingSync } from "./lib/recordingSync";
import { startMeetAttendanceSync } from "./lib/meetAttendanceSync";
import { startTranscriptSync } from "./lib/transcriptSync";

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
 * Refuse to serve a database that is behind the code.
 *
 * Migrations here are applied by hand after a deploy — there is no release step
 * — so every schema change has a window where new code runs against the old
 * database. The app already explained that to whoever hit it, which turned out
 * to be the right sentence said to the wrong people at the wrong moment:
 * forty-five learners met an error where their completed work should have been,
 * while the one person who could run the command was elsewhere, hearing that
 * records had been wiped. Nothing had been wiped. The deploy had gone green an
 * hour earlier.
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
  });
}

void main();
