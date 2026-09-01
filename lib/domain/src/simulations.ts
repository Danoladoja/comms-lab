import { satisfiesRole } from "./staffRoles";

export type SimulationStatus = "draft" | "live" | "debrief" | "ended";

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