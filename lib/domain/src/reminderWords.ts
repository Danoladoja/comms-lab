/**
 * What a reminder email actually says.
 *
 * A class and a simulation exercise are different enough that one wording
 * cannot serve both. "The classroom opens fifteen minutes before the start" is
 * true of a class and false of an exercise — there is no classroom and no
 * grace — and a sentence about unlocking the replay is a promise an exercise
 * cannot keep, because there is no replay and the whole point is that there is
 * not.
 *
 * These are the only words most of a cohort will ever read about a session,
 * and for a group exercise they are the difference between turning up and not,
 * because it cannot be rescheduled and is not run again. So they live here,
 * plainly, with a test on them, rather than being assembled from fragments at
 * the point of sending.
 */
export type ReminderKind = "24h" | "1h" | "open";

const MINUTE = 60 * 1000;

/**
 * When each reminder fires, as a window the module's start time must fall in.
 *
 * `fromMs` and `toMs` are offsets from now, and the window is half-open:
 * `from < startsAt <= to`. A negative offset is a start time that has already
 * passed, which is how the "it is open now" one works.
 *
 * `only` narrows a reminder to one sort of module. The third exists because a
 * live class has a fifteen-minute grace before it and a recording after it, so
 * being five minutes late costs a learner very little. A group exercise has
 * neither: the door opens exactly on the clock, the story starts moving
 * immediately, and there is no replay — composure in the minutes you are
 * actually in it is the thing being practised. So an exercise gets one more
 * email, at the moment it opens, and a class does not, where it would be a
 * third reminder nobody asked for.
 *
 * The windows must not overlap. Two that do means two emails for one class,
 * one of them saying "tomorrow" about something starting in ten minutes.
 */
export const REMINDER_WINDOWS: readonly {
  kind: ReminderKind;
  fromMs: number;
  toMs: number;
  lead: string;
  only: "simulation" | null;
}[] = [
  { kind: "24h", fromMs: 60 * MINUTE, toMs: 24 * 60 * MINUTE, lead: "tomorrow", only: null },
  { kind: "1h", fromMs: 0, toMs: 60 * MINUTE, lead: "in the next hour", only: null },
  { kind: "open", fromMs: -10 * MINUTE, toMs: 0, lead: "now", only: "simulation" },
];

/**
 * Which reminders a module of this kind would get, if its clock reached them.
 * Pure, so the disjointness can be held to by a test rather than by care.
 */
export function remindersFor(moduleKind: "class" | "simulation"): ReminderKind[] {
  return REMINDER_WINDOWS
    .filter((w) => w.only === null || w.only === moduleKind)
    .map((w) => w.kind);
}

/**
 * The one reminder due for a module starting at `startsAtMs`, or none.
 * Exactly one, or the windows are wrong.
 */
export function reminderDue(
  moduleKind: "class" | "simulation",
  startsAtMs: number,
  nowMs: number,
): ReminderKind | null {
  const hit = REMINDER_WINDOWS.filter((w) =>
    (w.only === null || w.only === moduleKind)
    && startsAtMs > nowMs + w.fromMs
    && startsAtMs <= nowMs + w.toMs);
  return hit.length === 1 ? hit[0].kind : null;
}

export type ReminderWords = {
  subject: string;
  paragraphs: string[];
  actionLabel: string;
};

export function reminderWords(f: {
  kind: ReminderKind;
  /** "tomorrow", "in the next hour", "now". */
  lead: string;
  isSimulation: boolean;
  title: string;
  programmeTitle: string;
  /** The date and time, already worded in the Lab's own clock. */
  when: string;
}): ReminderWords {
  if (!f.isSimulation) {
    return {
      subject: `Reminder: ${f.title} starts ${f.lead}`,
      paragraphs: [
        `${f.title}, part of ${f.programmeTitle}, starts ${f.lead}.`,
        f.when,
        "The classroom opens fifteen minutes before the start. Joining from the classroom checks you in, and attending live is what unlocks the replay afterwards.",
      ],
      actionLabel: "Open my classroom",
    };
  }

  // The one that only an exercise gets: sent at the moment the door opens,
  // because there is no grace period and the story starts moving immediately.
  if (f.kind === "open") {
    return {
      subject: `${f.title} is open now`,
      paragraphs: [
        `${f.title} has started. Go in now.`,
        "It runs on a clock nobody controls, including whoever set it. It will not wait, it cannot be paused, and it is not run again — so the minutes you are in it are the whole of it.",
        "You will not be told the situation in advance. That is the exercise.",
      ],
      actionLabel: "Go in",
    };
  }

  return {
    subject: `${f.title} runs ${f.lead}`,
    paragraphs: [
      `${f.title}, part of ${f.programmeTitle}, runs ${f.lead}.`,
      f.when,
      "This one is not a class. There is nothing to watch and nothing to read beforehand — you will not be told the situation in advance, because handling it cold is what is being practised.",
      "It starts on the clock whether or not everybody is there, it cannot be paused, and there is no recording of it afterwards. Be at a screen when it opens.",
    ],
    actionLabel: "Open the Studio",
  };
}
