import { satisfiesRole } from "./staffRoles";

export type SimulationStatus = "draft" | "live" | "debrief" | "ended";
export type StudioMode = "autonomous" | "facilitated";
export type StudioRunStatus = "active" | "completed";

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

export function mayControlStudioRun(mode: StudioMode, ownerId: number, userId: number): boolean {
  return mode === "autonomous" ? ownerId === userId : ownerId === userId;
}

export function hasSecureJoinCodeFormat(joinCode: string): boolean {
  return /^[A-F0-9]{32}$/.test(joinCode);
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

export function canTransitionSimulation(from: SimulationStatus, to: SimulationStatus): boolean {
  return (from === "draft" && to === "live")
    || (from === "live" && (to === "debrief" || to === "ended"))
    || (from === "debrief" && to === "ended");
}

export function nextInjectId(injectIds: string[], releasedInjectIds: string[]): string | null {
  const released = new Set(releasedInjectIds);
  return injectIds.find((id) => !released.has(id)) ?? null;
}

export function mayReleaseNextInject(status: SimulationStatus, injectIds: string[], releasedInjectIds: string[]): boolean {
  return status === "live" && nextInjectId(injectIds, releasedInjectIds) !== null;
}

export function learnerCanRespond(status: SimulationStatus, assignedGroupId: string | null, releasedInjectIds: string[], injectId: string): boolean {
  return status === "live" && assignedGroupId !== null && releasedInjectIds.includes(injectId);
}

export function learnerMaySeeDebrief(status: SimulationStatus): boolean {
  return status === "debrief" || status === "ended";
}

export function hasDistinctStableIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function canAssignSimulationGroups(status: SimulationStatus): boolean {
  return status === "draft";
}

export function canStartSimulation(
  status: SimulationStatus,
  published: boolean,
  participantIds: number[],
  assignments: { userId: number; groupId: string }[],
  configuredGroupIds: string[],
): boolean {
  if (status !== "draft" || !published || participantIds.length === 0) return false;
  const participants = new Set(participantIds);
  if (participants.size !== participantIds.length || assignments.length !== participants.size) return false;
  const assignedUsers = new Set(assignments.map((assignment) => assignment.userId));
  return assignedUsers.size === assignments.length
    && assignments.every((assignment) => participants.has(assignment.userId) && configuredGroupIds.includes(assignment.groupId));
}

/** Administrators run any module; facilitators run only their assigned module. */
export function isSimulationStaff(effectiveRole: string | null, userId: number, instructorId: number | null): boolean {
  return satisfiesRole(effectiveRole, ["admin"])
    || (effectiveRole === "instructor" && instructorId === userId);
}