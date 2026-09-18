/**
 * Who may run an individual exercise, and what they are given.
 *
 * ## What changed, and why
 *
 * The Studio used to admit anybody the Lab had ever invited, hand them a form,
 * and let them generate scenarios until a daily counter stopped them. Every one
 * of those is a model call, and none of them was connected to what the person
 * was supposed to be learning. So there were two problems wearing one coat:
 * spending nobody had agreed to, and practice aimed at nothing in particular.
 *
 * An invitation solves both. It is sent by an admin, it names the objective,
 * and it buys exactly one run. Nothing is generated until the learner presses
 * Begin, and then only once.
 *
 * ## Same objective, different crisis
 *
 * Everyone on a cohort is practising the same thing — the programme says what
 * that is. What differs is the situation it is practised in: a different
 * country, a different kind of organisation, a different thing going wrong.
 *
 * That is not decoration. A cohort handed the same scenario compares notes, and
 * the second person through learns less than the first. It also makes an
 * admin's read of the results meaningless, because the scores measure who spoke
 * to whom beforehand. Varying the situation while holding the objective fixed
 * is what keeps forty-five runs comparable and forty-five learners honest.
 *
 * The variation is drawn from a stored seed rather than made up fresh each
 * time, so that reloading the page cannot reshuffle somebody's scenario
 * mid-thought, and so the same invitation always means the same exercise.
 */

export type StudioInviteFacts = {
  /** Set once they press Begin. */
  runId: number | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * The window the invitation is good for.
   *
   * `opensAt` was added because "use it by" only ever answered half the
   * question. An admin preparing next week's exercise on a Friday had no way to
   * stop the keen half of the cohort doing it that afternoon, which is not the
   * same exercise: everybody was supposed to arrive at it having sat through
   * Tuesday's module. Both ends are optional, and both empty is the old
   * behaviour — open from the moment it is sent until it is used.
   */
  opensAt: string | null;
  expiresAt: string | null;
};

export type InviteState =
  /** Sent, but its window has not opened yet. */
  | "not-yet-open"
  /** Sent, not yet started. The one state in which a run may begin. */
  | "ready"
  /** Started and not finished. They go back to the run they left. */
  | "in-progress"
  /** Finished. The invitation is spent. */
  | "spent"
  /** Its window closed before it was started. */
  | "expired";

export function inviteState(invite: StudioInviteFacts, nowMs: number): InviteState {
  if (invite.completedAt) return "spent";
  // Started beats expired on purpose. Somebody who began in time and is still
  // working must not be thrown out mid-exercise by a date passing, and the
  // session's own clock ends the run soon enough anyway.
  if (invite.runId || invite.startedAt) return "in-progress";
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < nowMs) return "expired";
  // Asked after expiry on purpose. A window whose two ends have been set the
  // wrong way round should read as closed rather than as forever pending —
  // "come back later" for something that can never open is the worse lie.
  if (invite.opensAt && new Date(invite.opensAt).getTime() > nowMs) return "not-yet-open";
  return "ready";
}

/**
 * Why this invitation cannot start a run, if it cannot.
 *
 * Each says what happened rather than refusing flatly, because every one of
 * these reaches a learner who thinks they are about to start and needs to know
 * whether to wait, ask, or go back to what they were already doing.
 */
export function beginProblem(invite: StudioInviteFacts, nowMs: number): string | null {
  switch (inviteState(invite, nowMs)) {
    case "ready":
      return null;
    case "not-yet-open":
      // Deliberately does not name the hour. Only the browser knows what time
      // it is where the learner is sitting, and it puts the moment on screen
      // beside this.
      return "This exercise has not opened yet.";
    case "in-progress":
      // Not an error the learner should be stopped by — the caller sends them
      // to the run instead. It is here so that a second press of Begin can
      // never mint a second run.
      return "You have already started this exercise. Carry on where you left off.";
    case "spent":
      return "You have finished this exercise. Your debrief is in your practice record. "
        + "The team will send another invitation when there is one.";
    case "expired":
      return "This invitation has passed its date. Ask the team for a new one.";
  }
}

/** Whether pressing Begin should resume rather than start. */
export function shouldResume(invite: StudioInviteFacts, nowMs: number): boolean {
  return inviteState(invite, nowMs) === "in-progress";
}

/* ------------------------------------------------------------------ *
 * The situation each learner is dropped into
 * ------------------------------------------------------------------ */

/**
 * Where it happens.
 *
 * Real places, because the Lab teaches African energy communications and a
 * scenario set in a nameless country teaches the wrong instincts. The
 * organisations and the people in them are invented — that rule lives in the
 * scenario prompt and is not relaxed here.
 */
const SETTINGS = [
  "Nigeria's Niger Delta",
  "coastal Ghana",
  "Kenya's Rift Valley",
  "the Zambian Copperbelt",
  "Senegal's offshore blocks",
  "Mozambique's Cabo Delgado gas corridor",
  "South Africa's Mpumalanga coal belt",
  "Egypt's Western Desert",
  "Côte d'Ivoire's Abidjan grid",
  "Tanzania's central transmission corridor",
  "Morocco's Atlantic wind coast",
  "Uganda's Albertine region",
];

/** Who the learner speaks for. */
const ORGANISATIONS = [
  "a state-owned electricity utility",
  "an independent power producer",
  "a national oil company",
  "a regional transmission operator",
  "a mini-grid developer working across three districts",
  "an energy ministry's communications unit",
  "a pan-African renewables investor",
  "a gas distribution company",
  "an off-grid solar retailer",
  "a sector regulator",
];

/** What has gone wrong. */
const FLASHPOINTS = [
  "a tariff rise announced without warning",
  "a blackout during a national broadcast",
  "a leaked internal memo contradicting a public statement",
  "a community protest blocking a site access road",
  "an environmental incident reported first by a local journalist",
  "a contract award questioned by an opposition MP",
  "a fatal accident at a contractor's yard",
  "a data error in published generation figures",
  "a foreign investor withdrawing mid-project",
  "an outage map that shows the wrong districts restored",
  "a viral video of a company vehicle at an unauthorised site",
  "a regulator opening an inquiry announced by press release",
];

/** Where it breaks first — which decides who you are answering. */
const FIRST_BREAKS = [
  "on a wire service",
  "on social media",
  "on live radio",
  "inside the organisation, in a staff group",
  "in a regulator's letter",
  "at a community meeting",
];

export type Situation = {
  setting: string;
  organisation: string;
  flashpoint: string;
  firstBreak: string;
};

/**
 * A small, stable hash.
 *
 * FNV-1a: a few lines, no dependency, and — the part that matters — the same
 * answer every time for the same string, in every runtime. `Math.random` here
 * would reshuffle a learner's scenario on every page load, and a hash that
 * varied between Node versions would do the same thing more rarely and more
 * confusingly.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One of a list, chosen by the seed and a salt, so the four vary independently. */
function pick<T>(list: T[], seed: string, salt: string): T {
  return list[hash(`${salt}:${seed}`) % list.length] as T;
}

export function situationFor(seed: string): Situation {
  return {
    setting: pick(SETTINGS, seed, "where"),
    organisation: pick(ORGANISATIONS, seed, "who"),
    flashpoint: pick(FLASHPOINTS, seed, "what"),
    firstBreak: pick(FIRST_BREAKS, seed, "how"),
  };
}

/**
 * How many genuinely different exercises this can produce.
 *
 * Named so it can be asserted. Forty-five learners drawing from eight and a
 * half thousand combinations will occasionally share a setting; two sharing all
 * four is the thing that would matter, and at this size it is vanishingly rare.
 */
export const SITUATION_COMBINATIONS =
  SETTINGS.length * ORGANISATIONS.length * FLASHPOINTS.length * FIRST_BREAKS.length;

/** The situation as the scenario generator wants it: one line of subject matter. */
export function situationBrief(situation: Situation): string {
  return `${situation.organisation} in ${situation.setting}, facing ${situation.flashpoint}, `
    + `breaking ${situation.firstBreak}`;
}

/** The same thing said to the learner, before they begin. */
export function situationSummary(situation: Situation): string {
  return `You speak for ${situation.organisation} in ${situation.setting}. `
    + `It begins with ${situation.flashpoint}, ${situation.firstBreak}.`;
}

/**
 * What this learner is being asked to get better at.
 *
 * The programme's, not a module's. The first version of this preferred the
 * module description, which made every exercise about one week — and a
 * communicator's job is not divided into weeks. Somebody handling a tariff
 * announcement needs what module two taught about explaining a price, what
 * module four taught about the regulator, and whatever module one said about
 * saying the thing plainly. An exercise that only tests the most recent module
 * rehearses the timetable rather than the work.
 *
 * So it is the programme's own description, and the modules are handed to the
 * scenario generator separately as the ground it may draw on. Not invented
 * here: an objective this file made up would be one more thing for a
 * facilitator to find disagreeing with what they actually taught.
 */
export function objectiveFor(facts: {
  programmeTitle: string;
  programmeDescription: string;
  /** Every module on the programme, in order. Used only as a fallback. */
  moduleTitles?: readonly string[];
}): string {
  const programme = facts.programmeDescription.trim();
  if (programme) return programme;

  // Nothing written on the programme. Say what it is called and what ground it
  // covers, which is still true and still useful, rather than inventing an aim.
  const modules = (facts.moduleTitles ?? []).map((m) => m.trim()).filter(Boolean);
  const title = facts.programmeTitle.trim() || "this programme";
  if (modules.length > 0) {
    return `Handle a live communications crisis using the whole of ${title} — `
      + `${modules.join(", ")}.`;
  }
  return `Handle a live communications crisis to the standard ${title} sets.`;
}

/**
 * Why an admin cannot send this invitation.
 *
 * The duplicate check is the one that earns its place: an admin pressing
 * "invite the cohort" twice in a week should not hand anybody two runs, and the
 * quiet version of that bug is a token bill nobody can explain.
 */
export function invitationProblem(facts: {
  objective: string;
  hasOpenInvitation: boolean;
  enrolled: boolean;
}): string | null {
  if (!facts.enrolled) return "That learner is not on this programme.";
  if (facts.hasOpenInvitation) return "They already have an invitation they have not used.";
  if (facts.objective.trim().length < 10) {
    return "This programme has nothing written down for the learner to practise. "
      + "Give the programme a description first — it is what the exercise is built from.";
  }
  return null;
}

/** What the admin reads back after inviting a group. */
export function invitationNote(facts: {
  invited: number;
  alreadyHad: number;
  moduleTitle: string;
}): string {
  if (facts.invited === 0) {
    return facts.alreadyHad > 0
      ? `Nobody new to invite for ${facts.moduleTitle} — all of them already have an unused invitation.`
      : `Nobody to invite for ${facts.moduleTitle}.`;
  }
  const who = facts.invited === 1 ? "1 learner" : `${facts.invited} learners`;
  const tail = facts.alreadyHad > 0
    ? ` ${facts.alreadyHad} already had one and were left alone.`
    : "";
  return `${who} can now run ${facts.moduleTitle} in the Studio, once each.${tail}`;
}

/* ------------------------------------------------------------------ *
 * The dials an admin turns
 * ------------------------------------------------------------------ */

/**
 * Everything below exists because the first version of this decided too much.
 *
 * The invitation took the five-field form away from learners, which was right,
 * and then quietly answered all five itself: intermediate, thirty minutes, no
 * expiry, whatever the programme description happened to say. Nobody chose
 * those. They were fallbacks that became policy because no screen ever sent
 * anything else.
 *
 * So the dials come back, but to the person who should have had them. The
 * learner still chooses nothing. The admin chooses how hard, how long, how long
 * the invitation lives, and — in one sentence — what to lean on.
 */

/** Long enough to steer a crisis, too short to write one. */
export const MAX_STEER_CHARS = 240;
/** What a standalone exercise is about, when there is no programme to ask. */
export const MAX_EXERCISE_SUBJECT_CHARS = 200;
/** Beyond this an invitation is not a deadline, it is a filing cabinet. */
export const MAX_EXPIRY_DAYS = 180;

export type StudioLevel = "foundation" | "intermediate" | "advanced";

/**
 * A line of steer, or a reason it will not do.
 *
 * The length cap is the whole rule, and it is deliberate rather than arbitrary.
 * A sentence tilts the crisis; three paragraphs are an admin writing the brief
 * by hand, which is the thing the Studio exists to stop them having to do — and
 * a brief written by hand drifts from the programme the moment somebody is in a
 * hurry.
 */
export function steerProblem(steer: string | null | undefined): string | null {
  const text = (steer ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_STEER_CHARS) {
    return `That is ${text.length} characters. Keep the steer under ${MAX_STEER_CHARS} — a sentence `
      + "tilts the crisis, a paragraph writes it for the model and drifts from the programme.";
  }
  return null;
}

/** What an exercise with no programme behind it needs before it can be sent. */
export function standaloneProblem(facts: {
  subject: string;
  objective: string;
}): string | null {
  const subject = facts.subject.trim();
  const objective = facts.objective.trim();
  if (subject.length < 5) {
    return "Say what the exercise is about. There is no programme behind this one to say it for you.";
  }
  if (subject.length > MAX_EXERCISE_SUBJECT_CHARS) {
    return `Keep the subject under ${MAX_EXERCISE_SUBJECT_CHARS} characters.`;
  }
  if (objective.length < 10) {
    return "Say what they should get better at. Without a programme, nothing else can answer that.";
  }
  return null;
}

/**
 * The validity window, or the reason it is not one.
 *
 * Replaces a lone expiry check, which could only catch one of the three ways a
 * window goes wrong. The other two are the interesting ones: an admin who fills
 * the boxes in the order they think of them ends up with a window that closes
 * before it opens, and one who mistypes a year ends up with an exercise that
 * opens in 2027. Neither refuses at the door — they both just quietly produce a
 * cohort that can never start.
 */
export function validityProblem(
  window: { opensAt: string | null | undefined; expiresAt: string | null | undefined },
  nowMs: number,
): string | null {
  const opens = moment(window.opensAt);
  const closes = moment(window.expiresAt);

  if (window.opensAt && opens === null) return "The opening date is not a date.";
  if (window.expiresAt && closes === null) return "The closing date is not a date.";

  if (closes !== null && closes <= nowMs) {
    return "That closing time has gone. An invitation that expires before it arrives cannot be used.";
  }
  if (opens !== null && closes !== null && closes <= opens) {
    return "It closes before it opens. Give it a closing time after the opening one, "
      + "or clear one of them.";
  }
  if (opens !== null && opens - nowMs > MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
    return `That opens more than ${MAX_EXPIRY_DAYS} days from now. Check the year.`;
  }
  if (closes !== null && closes - nowMs > MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
    return `That is more than ${MAX_EXPIRY_DAYS} days away, which is not really a deadline. `
      + "Leave it empty if you do not want one.";
  }
  return null;
}

function moment(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * When the door opens, said the way somebody would say it.
 *
 * The absolute moment goes on screen beside this, formatted by the browser in
 * the learner's own clock. This is the part that tells them whether to wait or
 * to go and do something else.
 */
export function opensInNote(opensAt: string | null | undefined, nowMs: number): string | null {
  const at = moment(opensAt);
  if (at === null) return null;

  const until = at - nowMs;
  if (until <= 0) return null;

  const hours = Math.floor(until / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(until / 60_000));
    return `Opens in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  if (hours < 24) return `Opens in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Opens tomorrow." : `Opens in ${days} days.`;
}

/**
 * What each level actually changes, said on the screen where it is chosen.
 *
 * The honest version of "leave room for human moderation": a dial nobody can
 * predict the effect of is not control, it is a guess with extra steps.
 */
export function levelNote(level: StudioLevel): string {
  if (level === "foundation") {
    return "One thing going wrong at a time, and the right answer is usually reachable. "
      + "For a cohort still finding their feet.";
  }
  if (level === "advanced") {
    return "Competing pressures with no clean answer, and the situation punishes hedging. "
      + "For people who have handled one of these before.";
  }
  return "A real situation with a defensible answer and several wrong ones. The usual choice.";
}

/** What the length buys, in turns rather than in minutes. */
/**
 * How long an exercise may be set to run.
 *
 * Both ends are load-bearing, and both were found by working the arithmetic
 * through rather than by picking round numbers.
 *
 * The floor is the one that matters. An exercise is never planned for fewer
 * than three turns, and a turn is a development to read and a considered answer
 * to write — call it four minutes, and the scenario itself may ask for up to
 * fifteen. Below a quarter of an hour the wall stops the exercise before those
 * three turns can happen, so the learner is cut off part-way and then handed a
 * debrief judging them on turns they never saw. That is worse than no exercise.
 *
 * The ceiling is honesty rather than safety. Turns are capped at six, so beyond
 * about an hour and a half the extra time buys nothing at all: the exercise
 * still ends after six turns, and an admin who set four hours would be told a
 * number that never happens.
 */
export const STUDIO_MIN_MINUTES = 15;
export const STUDIO_MAX_MINUTES = 90;

export function durationProblem(minutes: unknown): string | null {
  const n = typeof minutes === "number" ? minutes : Number.parseInt(String(minutes ?? ""), 10);
  if (!Number.isFinite(n)) return "That is not a number of minutes.";
  if (n < STUDIO_MIN_MINUTES) {
    return `${n} minutes is too short. An exercise runs at least three turns, and below `
      + `${STUDIO_MIN_MINUTES} minutes the clock stops it part-way — the learner is cut off and `
      + "then judged on turns they never saw.";
  }
  if (n > STUDIO_MAX_MINUTES) {
    return `${n} minutes is longer than an exercise can use. It ends after six turns whatever the `
      + `clock says, so anything past ${STUDIO_MAX_MINUTES} minutes is a number that never happens.`;
  }
  return null;
}

/**
 * What the length buys, in turns rather than in minutes.
 *
 * Says the turn count out loud because that is the thing the number actually
 * changes, and it is not guessable from the minutes: the same three turns come
 * out of fifteen minutes and of twenty-four.
 */
export function lengthNote(minutes: number, turns: number): string {
  const shape = turns <= 3
    ? "Enough to test a first response and one consequence of it."
    : turns >= 6
      ? "Room for the story to turn against an early answer twice over, which is where most of the "
        + "learning is."
      : "Enough for the situation to develop a few times and for an early mistake to come back.";
  return `About ${turns} turns. ${shape}`;
}

/**
 * What the exercise is about: the admin's words when they gave any, otherwise
 * the situation drawn for this learner.
 *
 * A standalone exercise has no programme and no cohort, so the subject is the
 * only thing that says what it is. On a programme the drawn situation is what
 * makes forty-five learners' crises different from one another, so an admin's
 * subject would flatten all of them into the same one — which is why on a
 * programme it steers rather than replaces.
 */
export function exerciseSubject(facts: {
  subject: string | null | undefined;
  drawn: string;
  hasProgramme: boolean;
}): string {
  const subject = (facts.subject ?? "").trim();
  if (!subject) return facts.drawn;
  if (!facts.hasProgramme) return subject;
  return `${facts.drawn} The exercise should concern ${subject}.`;
}

/**
 * How long a learner has left, said the way somebody would say it.
 *
 * Shown to the learner, because a deadline nobody is told about is not a
 * deadline: it is an invitation that stops working for no visible reason.
 */
export function timeLeftNote(expiresAt: string | null | undefined, nowMs: number): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return null;

  const left = at - nowMs;
  if (left <= 0) return "This one has expired.";

  const hours = Math.floor(left / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(left / 60_000));
    return `Less than an hour left — ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} left to start it.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "One day left to start it.";
  return `${days} days left to start it.`;
}
