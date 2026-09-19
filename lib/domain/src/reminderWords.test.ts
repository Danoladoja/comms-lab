import { describe, expect, it } from "vitest";
import { reminderWords, remindersFor, reminderDue, REMINDER_WINDOWS } from "./reminderWords";

const base = {
  lead: "tomorrow",
  title: "Crisis exercise",
  programmeTitle: "Pipeline communications",
  when: "Friday 5 September, 15:00 WAT (45 min)",
};

describe("what a reminder says", () => {
  it("promises a class its classroom and its replay", () => {
    const words = reminderWords({ ...base, kind: "24h", isSimulation: false, title: "Explaining a tariff" });
    expect(words.subject).toBe("Reminder: Explaining a tariff starts tomorrow");
    expect(words.paragraphs.join(" ")).toContain("classroom opens fifteen minutes");
    expect(words.actionLabel).toBe("Open my classroom");
  });

  it("promises an exercise neither, because it has neither", () => {
    // A learner told there is a replay will treat missing it as recoverable.
    // It is not, and that is the exercise.
    const words = reminderWords({ ...base, kind: "24h", isSimulation: true });
    const body = words.paragraphs.join(" ");
    expect(body).not.toContain("classroom");
    expect(body).not.toContain("replay");
    expect(body).toContain("no recording");
    expect(body).toContain("cannot be paused");
    expect(words.actionLabel).toBe("Open the Studio");
  });

  it("never names the situation in advance", () => {
    for (const kind of ["24h", "1h", "open"] as const) {
      const body = reminderWords({ ...base, kind, isSimulation: true }).paragraphs.join(" ");
      expect(body).toContain("not be told the situation in advance");
    }
  });

  it("says go in now, at the moment the door opens", () => {
    const words = reminderWords({ ...base, kind: "open", lead: "now", isSimulation: true });
    expect(words.subject).toBe("Crisis exercise is open now");
    expect(words.paragraphs[0]).toBe("Crisis exercise has started. Go in now.");
    expect(words.actionLabel).toBe("Go in");
  });

  it("does not repeat the date in the one sent after it has started", () => {
    // "Starts at 15:00" arriving at 15:02 reads as a mistake and invites the
    // reader to check their calendar rather than open the exercise.
    const words = reminderWords({ ...base, kind: "open", lead: "now", isSimulation: true });
    expect(words.paragraphs.join(" ")).not.toContain(base.when);
  });

  it("names the programme in the ones sent beforehand", () => {
    for (const kind of ["24h", "1h"] as const) {
      expect(reminderWords({ ...base, kind, isSimulation: true }).paragraphs[0])
        .toContain("Pipeline communications");
    }
  });
});

describe("when a reminder fires", () => {
  const NOW = new Date("2026-09-10T12:00:00Z").getTime();
  const MINUTE = 60 * 1000;
  const at = (minutesFromNow: number) => NOW + minutesFromNow * MINUTE;

  it("sends a class two and an exercise three", () => {
    // The third is the one that says "go in now", and a class does not need it:
    // it has a fifteen-minute grace and a recording afterwards.
    expect(remindersFor("class")).toEqual(["24h", "1h"]);
    expect(remindersFor("simulation")).toEqual(["24h", "1h", "open"]);
  });

  it("never sends two for the same moment", () => {
    // Two overlapping windows is two emails for one class, one of them saying
    // "tomorrow" about something starting in ten minutes.
    for (const kind of ["class", "simulation"] as const) {
      for (let m = -30; m <= 26 * 60; m += 1) {
        const due = reminderDue(kind, at(m), NOW);
        const hits = REMINDER_WINDOWS.filter((w) =>
          (w.only === null || w.only === kind)
          && at(m) > NOW + w.fromMs && at(m) <= NOW + w.toMs);
        expect(hits.length).toBeLessThanOrEqual(1);
        expect(due).toBe(hits[0]?.kind ?? null);
      }
    }
  });

  it("puts each moment in the window a reader would expect", () => {
    expect(reminderDue("class", at(23 * 60), NOW)).toBe("24h");
    expect(reminderDue("class", at(90), NOW)).toBe("24h");
    expect(reminderDue("class", at(59), NOW)).toBe("1h");
    expect(reminderDue("class", at(1), NOW)).toBe("1h");
    // Beyond a day, and long past: nothing.
    expect(reminderDue("class", at(25 * 60), NOW)).toBeNull();
    expect(reminderDue("class", at(-30), NOW)).toBeNull();
  });

  it("only tells an exercise it is open, and only just after it opened", () => {
    expect(reminderDue("simulation", at(-1), NOW)).toBe("open");
    expect(reminderDue("simulation", at(-9), NOW)).toBe("open");
    expect(reminderDue("simulation", at(-11), NOW)).toBeNull();
    // A class that started two minutes ago gets nothing at all, as before.
    expect(reminderDue("class", at(-1), NOW)).toBeNull();
  });
});
