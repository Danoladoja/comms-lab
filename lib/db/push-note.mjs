/**
 * Said before every schema push, because the push can stop and wait.
 *
 * `drizzle-kit push --force` skips its "this may lose data" confirmations but
 * NOT the one it asks before adding a unique index to a table that already has
 * rows: it offers to truncate the table first. That question waits for an
 * answer rather than timing out, so a push left sitting at it applies nothing —
 * and afterwards looks exactly like a push that ran.
 *
 * An admin ran it twice, both times it stalled there, and the Lab spent a day
 * unable to save a module while every outward sign said the database had been
 * updated. Four lines before the command is a cheap way never to lose that day
 * again.
 */
const BOLD = "[1m";
const RED = "[31m";
const OFF = "[0m";

const lines = [
  "",
  `${BOLD}Before this runs — it may stop and ask you something.${OFF}`,
  "",
  `If it offers to ${BOLD}truncate a table${OFF} before adding a unique index, always`,
  `choose the option that does ${BOLD}NOT${OFF} truncate.`,
  `${RED}Truncating deletes every row in that table${OFF} — enrolments, attendance,`,
  "submitted work.",
  "",
  "It waits for an answer rather than timing out. A push left at that prompt",
  "applies nothing, and looks afterwards exactly like one that finished.",
  "",
  `Watch for "${BOLD}[checkmark] Changes applied${OFF}" at the end. If you do not see it,`,
  "it did not run.",
  "",
];

console.log(lines.join("\n"));
