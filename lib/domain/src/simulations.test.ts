import { describe, expect, it } from "vitest";
import { canAssignSimulationGroups, canStartSimulation, canTransitionSimulation, hasDistinctStableIds, isSimulationStaff, learnerCanRespond, learnerMaySeeDebrief, mayReleaseNextInject, nextInjectId } from "./simulations";

describe("simulation rules", () => {
  it("permits only forward facilitator transitions", () => {
    expect(canTransitionSimulation("draft", "live")).toBe(true);
    expect(canTransitionSimulation("live", "debrief")).toBe(true);
    expect(canTransitionSimulation("debrief", "ended")).toBe(true);
    expect(canTransitionSimulation("ended", "live")).toBe(false);
    expect(canTransitionSimulation("draft", "ended")).toBe(false);
  });
  it("releases injects only in configured order", () => {
    expect(nextInjectId(["one", "two"], ["one"])).toBe("two");
    expect(mayReleaseNextInject("live", ["one"], ["one"])).toBe(false);
    expect(mayReleaseNextInject("draft", ["one"], [])).toBe(false);
    expect(hasDistinctStableIds([{ id: "one" }, { id: "one" }])).toBe(false);
  });
  it("limits learner responses and debrief visibility", () => {
    expect(learnerCanRespond("live", "group-a", ["one"], "one")).toBe(true);
    expect(learnerCanRespond("live", null, ["one"], "one")).toBe(false);
    expect(learnerCanRespond("debrief", "group-a", ["one"], "one")).toBe(false);
    expect(learnerMaySeeDebrief("live")).toBe(false);
    expect(learnerMaySeeDebrief("ended")).toBe(true);
  });
  it("only starts a published draft with every active participant assigned once", () => {
    expect(canAssignSimulationGroups("draft")).toBe(true);
    expect(canAssignSimulationGroups("live")).toBe(false);
    expect(canStartSimulation("draft", true, [1, 2], [{ userId: 1, groupId: "a" }, { userId: 2, groupId: "b" }], ["a", "b"])).toBe(true);
    expect(canStartSimulation("draft", true, [1, 2], [{ userId: 1, groupId: "a" }], ["a", "b"])).toBe(false);
    expect(canStartSimulation("live", true, [1], [{ userId: 1, groupId: "a" }], ["a"])).toBe(false);
  });
  it("allows effective administrators and only the assigned facilitator", () => {
    expect(isSimulationStaff("admin", 1, null)).toBe(true);
    expect(isSimulationStaff("superadmin", 1, null)).toBe(true);
    expect(isSimulationStaff("instructor", 3, 3)).toBe(true);
    expect(isSimulationStaff("instructor", 3, 4)).toBe(false);
    expect(isSimulationStaff("learner", 3, 3)).toBe(false);
  });
});