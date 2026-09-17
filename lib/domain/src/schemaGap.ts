/**
 * What to say, and whether to start, when the database is behind the code.
 *
 * The app already turned a missing table into a helpful sentence at the moment
 * somebody hit it. That sentence was correct and it was not enough, for two
 * reasons that only became obvious on the day it mattered.
 *
 * It reached the wrong person. Forty-five learners opening their dashboards saw
 * it; the one person who could run the command was in a different screen
 * entirely, hearing second-hand that records had been "wiped" — because an
 * error where your completed work used to be reads as your work being gone.
 *
 * And it arrived too late to prevent anything. By the time the first learner
 * saw it, the deploy had already succeeded, gone green, and been walked away
 * from.
 *
 * So the check belongs at boot, where there is exactly one of it, nobody is
 * depending on the answer yet, and a failure shows up as a deploy that visibly
 * did not finish — which is the failure anybody would rather have.
 */

/** How the app should behave when the database is missing things. */
export type StartupVerdict = {
  /** True when the process should stop rather than serve requests. */
  refuseToStart: boolean;
  /** Printed as-is to the logs. Written for somebody reading a deploy log at speed. */
  message: string;
};

export function startupVerdict(gap: {
  missingTables: string[];
  missingColumns: string[];
}): StartupVerdict {
  const tables = gap.missingTables ?? [];
  const columns = gap.missingColumns ?? [];

  if (tables.length === 0 && columns.length === 0) {
    return { refuseToStart: false, message: "Database matches the code." };
  }

  const parts: string[] = [
    "",
    "  ┌─────────────────────────────────────────────────────────────┐",
    "  │  THE DATABASE IS BEHIND THE CODE — NOT STARTING             │",
    "  └─────────────────────────────────────────────────────────────┘",
    "",
    "  This deploy contains changes the database has not been given yet.",
    "  Starting anyway would serve learners errors where their work should be,",
    "  which is what happened once and is the reason this check exists.",
    "",
  ];

  if (tables.length > 0) {
    parts.push(`  Tables the code needs and the database does not have (${tables.length}):`);
    for (const t of tables) parts.push(`    · ${t}`);
    parts.push("");
  }

  if (columns.length > 0) {
    // Capped, because a first deploy against an empty database would otherwise
    // print several hundred lines and bury the instruction underneath them.
    const shown = columns.slice(0, 20);
    parts.push(`  Columns the code needs and the database does not have (${columns.length}):`);
    for (const c of shown) parts.push(`    · ${c}`);
    if (columns.length > shown.length) {
      parts.push(`    · …and ${columns.length - shown.length} more`);
    }
    parts.push("");
  }

  parts.push(
    "  To fix it, run this in the Railway console on the api-server service:",
    "",
    "    pnpm --filter @workspace/db run migrate",
    "",
    "  It only adds what is missing. It does not delete or alter existing data.",
    "  The app will start on its own once the database has caught up.",
    "",
  );

  return { refuseToStart: true, message: parts.join("\n") };
}

/**
 * The same problem, worded for whoever happens to hit it in a browser.
 *
 * Still needed: a deploy can be rolled forward while somebody is mid-request,
 * and the boot check cannot help them. What it must never do is send a person
 * to a command that can destroy data. It used to say
 * `db run push --force` — a command whose whole purpose is to make the database
 * match the code by any means, including dropping columns and tables. That is
 * genuinely dangerous advice to hand somebody who is panicking, and it sat in
 * production for weeks. `migrate` only applies the migration files, which only
 * ever add.
 */
export function schemaBehindMessage(postgresSaid: string | null | undefined): string {
  const said = (postgresSaid ?? "").trim();
  return "The app has been updated but the database has not caught up yet"
    + (said ? ` — ${said}` : "")
    + ". Nothing you did caused this and trying again will not help. "
    + "An administrator needs to run `pnpm --filter @workspace/db run migrate` "
    + "in the Railway console.";
}
