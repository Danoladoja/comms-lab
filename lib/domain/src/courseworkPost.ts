import { dueAtMs } from "./dueDate";

/**
 * Posting a module's coursework to the cohort.
 *
 * Until now, saving a quiz *was* publishing it: the questions appeared on every
 * learner's dashboard the instant they were saved, half-written and unchecked.
 * The two are now separate. Saving is private. Posting is the moment the work
 * becomes the cohort's, and it is the only moment anybody is emailed.
 *
 * Posting is deliberately one-way. An email cannot be recalled, so "unpost"
 * would be a button that lies: it would hide the page from people already
 * holding a letter about it. Coursework that went out too early is fixed by
 * editing it, not by pretending it never went.
 */

/** Where the Lab words its deadlines when it cannot know the reader's clock. */
export const LAB_TIME_ZONE = "Africa/Lagos";
export const LAB_TIME_ZONE_LABEL = "WAT";

export type CourseworkPiece = {
  kind: "quiz" | "assignment";
  /** Present for a task; a quiz has no title of its own. */
  title?: string | null;
  dueAt?: string | null;
  /** Saved but not yet seen by anybody. */
  draft: boolean;
  /** Whether there is anything here at all. */
  exists: boolean;
};

const theName = (piece: CourseworkPiece) => (piece.kind === "quiz" ? "quiz" : "task");

/** What a press of Post would actually publish. */
export function readyToPost(pieces: CourseworkPiece[]): CourseworkPiece[] {
  return pieces.filter((p) => p.exists && p.draft);
}

/** Joining names the way a person would say them aloud. */
function listOut(words: string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What the admin is told before they press Post, and after.
 *
 * The number of people is in the sentence because that is the fact that makes
 * this irreversible, and it should be read rather than assumed.
 */
export function describePost(pieces: CourseworkPiece[], learners: number): string {
  const going = readyToPost(pieces);
  if (going.length === 0) {
    const live = pieces.filter((p) => p.exists && !p.draft);
    if (live.length === 0) return "Nothing is written yet, so there is nothing to post.";
    return `The ${listOut(live.map(theName))} ${live.length === 1 ? "is" : "are"} already live. There is nothing new to post.`;
  }
  if (learners === 0) {
    return `The ${listOut(going.map(theName))} will go live, but nobody is enrolled yet, so no email will be sent.`;
  }
  const who = `${learners} ${learners === 1 ? "learner" : "learners"}`;
  return `The ${listOut(going.map(theName))} will go live and ${who} will be emailed. This cannot be undone.`;
}

/** A deadline in words, in the Lab's own clock, for a reader whose clock is unknown. */
export function formatDeadlineInZone(dueAt: string | null | undefined, timeZone = LAB_TIME_ZONE): string {
  const ms = dueAtMs(dueAt);
  if (ms === null) return "";
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
  // "Friday 12 September at 5:00 pm WAT" — the zone is named because half a
  // cohort is not in it, and a deadline nobody can place is not a deadline.
  return `${when.replace(/,\s*(?=\d{1,2}:\d{2})/, " at ")} ${LAB_TIME_ZONE_LABEL}`;
}

export type Announcement = { subject: string; paragraphs: string[] };

/**
 * The letter that goes out when coursework is posted.
 *
 * One letter for the module, not one per piece. A learner who gets two emails a
 * minute apart about the same class learns to ignore both.
 */
export function postAnnouncement(args: {
  moduleTitle: string;
  programmeTitle: string;
  pieces: CourseworkPiece[];
}): Announcement {
  const going = readyToPost(args.pieces);
  const names = listOut(going.map(theName));
  const module = args.moduleTitle.trim() || "your latest module";

  const paragraphs: string[] = [
    going.length === 1
      ? `The ${names} for ${module} is now open.`
      : `The ${names} for ${module} are now open.`,
  ];

  for (const piece of going) {
    const when = formatDeadlineInZone(piece.dueAt);
    const what = piece.kind === "assignment" && piece.title?.trim()
      ? `the task, ${piece.title.trim()},`
      : `the ${theName(piece)}`;
    paragraphs.push(
      when
        ? `You have until ${when} to complete ${what.replace(/,$/, "")}. After that it closes and cannot be submitted.`
        : `There is no closing date on ${what.replace(/,$/, "")} — take the time you need.`,
    );
  }

  paragraphs.push("Everything is in the classroom, alongside the class recording and the reading.");

  return {
    subject: going.length === 1
      ? `${module}: the ${names} is open`
      : `${module}: the ${names} are open`,
    paragraphs,
  };
}
