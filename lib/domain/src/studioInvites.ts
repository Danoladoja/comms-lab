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
  expiresAt: string | null;
};

export type InviteState =
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
 * An expiry date, or a reason it is not one.
 *
 * A date in the past would send an invitation that is dead on arrival, which
 * looks to a learner exactly like the Studio being broken.
 */
export function expiryProblem(expiresAt: string | null | undefined, nowMs: number): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return "That is not a date.";
  if (at <= nowMs) return "That date has gone. An invitation that expires before it arrives cannot be used.";
  if (at - nowMs > MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
    return `That is more than ${MAX_EXPIRY_DAYS} days away, which is not really a deadline. `
      + "Leave it empty if you do not want one.";
  }
  return null;
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
export function lengthNote(minutes: number): string {
  if (minutes <= 15) {
    return "Short. One or two things happen — enough to test a first response and not much after it.";
  }
  if (minutes >= 60) {
    return "Long. The story has room to turn against an early answer, which is where most of the "
      + "learning is — but it is an hour of somebody's day.";
  }
  return "Enough for the situation to develop two or three times and for an early mistake to come back.";
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
