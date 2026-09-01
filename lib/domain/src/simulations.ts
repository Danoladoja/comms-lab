/**
 * The Simulation Studio's rules.
 *
 * The Studio is its own thing: a signed-in person opens it, asks for an
 * exercise on a subject, and works through it. It is deliberately not attached
 * to a module, a cohort or a live class, because the version that was could
 * only be found by an admin who already knew where to look, and could not be
 * tried at all outside a running class.
 *
 * Two ways to run one. **Autonomous**: one person, alone, with Claude playing
 * everyone else and writing the debrief at the end. **Facilitated**: a room,
 * where the person who made it holds the controls and everybody else answers.
 */

export type StudioMode = "autonomous" | "facilitated";
export type StudioRunStatus = "active" | "completed";

export function mayEnterStudio(isAdmin: boolean, hasInvitation: boolean, hasRedeemedCode: boolean): boolean {
  return isAdmin || hasInvitation || hasRedeemedCode;
}

export function mayCreateStudioRun(mode: StudioMode, ownerId: number, participantId: number): boolean {
  return mode === "facilitated" || ownerId === participantId;
}

export function mayJoinFacilitatedRun(mode: StudioMode, status: StudioRunStatus, hasJoinCode: boolean): boolean {
  return mode === "facilitated" && status === "active" && hasJoinCode;
}

export function mayAdvanceStudioRun(status: StudioRunStatus, hasSubmittedResponse: boolean): boolean {
  return status === "active" && hasSubmittedResponse;
}

export function mayCompleteStudioRun(status: StudioRunStatus): boolean {
  return status === "active";
}

/**
 * Who may move a run forward, or end it.
 *
 * The owner, in both modes. In an autonomous run the owner is the only person
 * in it. In a facilitated room the owner is the facilitator standing at the
 * front, and the whole point is that participants cannot skip ahead of the
 * person running the class.
 */
export function mayControlStudioRun(_mode: StudioMode, ownerId: number, userId: number): boolean {
  return ownerId === userId;
}

/**
 * The alphabet a join code is drawn from.
 *
 * A facilitator reads this out to a room, and somebody at the back types what
 * they heard. So: no zero against O, no one against I or L, and upper case
 * only. The code arrived as thirty-two hexadecimal characters, which is
 * unimpeachable and unusable.
 */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

/**
 * What somebody typed, turned into what we stored.
 *
 * Spaces and dashes go, because people write codes out in pairs. So does any
 * character the alphabet does not contain, which quietly absorbs the stray
 * punctuation and leaves a genuinely wrong code wrong rather than guessing at
 * what the person meant.
 */
export function normaliseJoinCode(typed: string): string {
  const allowed = new Set(JOIN_CODE_ALPHABET);
  return [...typed.toUpperCase()].filter((c) => allowed.has(c)).join("").slice(0, JOIN_CODE_LENGTH);
}

export function hasSecureJoinCodeFormat(joinCode: string): boolean {
  return new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`).test(joinCode);
}

export function operationLeaseIsActive(startedAt: Date | null, now: Date, leaseMs: number): boolean {
  return startedAt !== null && startedAt.getTime() > now.getTime() - leaseMs;
}

export function responseVersionMatches(claimedVersion: number, currentVersion: number): boolean {
  return claimedVersion === currentVersion;
}

export function maySeeConfidentialBrief(viewerGroupId: string | null, briefGroupId: string): boolean {
  return viewerGroupId === briefGroupId;
}

/* ---------- Whose exercise is it ---------- */

/**
 * May this person open this exercise?
 *
 * Three ways in, and the third is the one that makes a programme exercise worth
 * writing:
 *
 * - You wrote it. Always, published or not, so a half-finished exercise is
 *   yours alone until you say otherwise.
 * - You are an administrator. You are responsible for what the Lab teaches.
 * - It was written for a programme, it has been published, and you are
 *   enrolled on that programme. Forty people then have an exercise about the
 *   thing they are actually studying, without anybody sending anything.
 *
 * An unpublished programme exercise stays with its author. That is the whole
 * difference between drafting one and putting it in front of a cohort.
 */
export function maySeeStudioSimulation(
  simulation: { ownerId: number; programId: number | null; published: boolean },
  viewer: { id: number; isAdmin: boolean; enrolledProgramIds: readonly number[] },
): boolean {
  if (viewer.id === simulation.ownerId) return true;
  if (viewer.isAdmin) return true;
  if (!simulation.published || simulation.programId === null) return false;
  return viewer.enrolledProgramIds.includes(simulation.programId);
}

/**
 * How many access codes to make in one press.
 *
 * Bounded because each one is a row and a line of text somebody has to
 * distribute by hand, and a mistyped 500 helps nobody.
 */
export const MAX_ACCESS_CODES_AT_ONCE = 50;

export function accessCodeCount(requested: unknown): number {
  const n = typeof requested === "number" ? Math.floor(requested) : Number.parseInt(String(requested ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_ACCESS_CODES_AT_ONCE);
}
