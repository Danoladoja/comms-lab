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
 * The module's own words where there are any, the programme's otherwise. Not
 * invented here: an objective this file made up would be one more thing for a
 * facilitator to discover disagreeing with what they taught.
 */
export function objectiveFor(facts: {
  programmeTitle: string;
  programmeDescription: string;
  moduleTitle?: string | null;
  moduleDescription?: string | null;
}): string {
  const module = (facts.moduleDescription ?? "").trim();
  if (module) return module;

  const moduleTitle = (facts.moduleTitle ?? "").trim();
  if (moduleTitle) {
    return `Handle a live communications crisis using what ${moduleTitle} covered.`;
  }

  const programme = facts.programmeDescription.trim();
  if (programme) return programme;

  return `Handle a live communications crisis to the standard ${facts.programmeTitle.trim()} sets.`;
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
      + "Give the module a description first — it is what the exercise is built from.";
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
