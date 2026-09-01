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
