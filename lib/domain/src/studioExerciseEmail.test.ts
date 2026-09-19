import { describe, expect, it } from "vitest";
import {
  exerciseInviteLetter,
  exerciseInviteParagraphs,
  exerciseInviteSubject,
  letterMoment,
} from "./studioExerciseEmail";

const base = {
  name: "Ada Mensah",
  programmeTitle: "Energy Comms",
  objective: "Explaining a price rise without hiding the number.",
  durationMinutes: 40,
  difficulty: "advanced",
  url: "https://energycommslab.africa/studio",
};

const body = (over = {}) => exerciseInviteParagraphs({ ...base, ...over }).join(" ");

describe("the letter that says an exercise is waiting", () => {
  it("names what they are practising", () => {
    expect(body()).toContain("Explaining a price rise without hiding the number.");
    expect(exerciseInviteSubject(base)).toContain("Energy Comms");
  });

  it("says how long it runs and at what level, before they commit", () => {
    // They get one attempt and the clock does not care what else turns up.
    const text = body();
    expect(text).toContain("40 minutes");
    expect(text).toContain("advanced");
    expect(text).toMatch(/cannot be paused, restarted or left/);
  });

  it("never says what the crisis is, because that is the exercise", () => {
    // Nothing in this letter comes from the scenario, and the wording says so
    // out loud rather than leaving them to wonder whether it was an oversight.
    expect(body()).toMatch(/will not be told the situation in advance/);
  });

  it("gives the deadline, with a timezone on it", () => {
    // Read on a phone in Lagos, Nairobi or London. "17:00" meaning somebody
    // else's 17:00 is how people miss things.
    const text = body({ expiresAt: "2026-09-23T17:00:00Z" });
    expect(text).toMatch(/Use it by Wednesday 23 September at 17:00 UTC/);
  });

  it("says when it opens, when it is not open yet", () => {
    const text = body({ opensAt: "2026-09-22T09:30:00Z" });
    expect(text).toMatch(/opens on Tuesday 22 September at 09:30 UTC/);
    expect(text).toMatch(/nothing to do until then/i);
  });

  it("puts both ends in one sentence when there are two", () => {
    const text = body({ opensAt: "2026-09-22T09:30:00Z", expiresAt: "2026-09-23T17:00:00Z" });
    expect(text).toMatch(/opens on Tuesday 22 September at 09:30 UTC and closes on Wednesday 23 September at 17:00 UTC/);
  });

  it("says nothing about dates when there are none", () => {
    const text = body();
    expect(text).not.toMatch(/opens on|Use it by|closes on/);
  });

  it("refuses a date that is not one rather than printing rubbish", () => {
    expect(letterMoment("whenever")).toBeNull();
    expect(letterMoment(null)).toBeNull();
  });

  it("sends them to the door rather than through it", () => {
    // The letter does not start anything. Only the button inside does, and a
    // link that reads "Begin" would make an email click feel like a commitment.
    const letter = exerciseInviteLetter(base);
    expect(letter.html).toContain("Open the Studio");
    expect(letter.html).not.toMatch(/>\s*Begin\s*</);
    expect(letter.text).toContain("https://energycommslab.africa/studio");
  });

  it("greets somebody with no name on file without an empty gap", () => {
    const letter = exerciseInviteLetter({ ...base, name: null });
    expect(letter.text).toMatch(/^Hello there,/);
  });
});
