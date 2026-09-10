import { describe, expect, it } from "vitest";
import {
  readThemeChoice,
  resolveTheme,
  nextThemeChoice,
  themeToggleLabel,
  isThemeChoice,
} from "./theme";

describe("readThemeChoice", () => {
  it("takes a real choice back", () => {
    expect(readThemeChoice("dark")).toBe("dark");
    expect(readThemeChoice("light")).toBe("light");
    expect(readThemeChoice("system")).toBe("system");
  });

  it("treats anything unreadable as no choice made", () => {
    // A cleared browser, a private window, a value from an older version.
    for (const value of [null, undefined, "", "Dark", 1, {}, "auto"]) {
      expect(readThemeChoice(value)).toBe("system");
    }
  });
});

describe("resolveTheme", () => {
  it("gives somebody what they chose, whatever their computer thinks", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the computer when nothing has been chosen", () => {
    // The state that is usually collapsed into "light" by mistake, which is
    // what makes a dark-mode setting feel broken on a dark machine.
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("nextThemeChoice", () => {
  it("always sets an explicit choice, so one press always does something", () => {
    // Somebody on a light computer who presses the switch wants dark now.
    expect(nextThemeChoice("system", false)).toBe("dark");
    expect(nextThemeChoice("system", true)).toBe("light");
    expect(nextThemeChoice("light", false)).toBe("dark");
    expect(nextThemeChoice("dark", true)).toBe("light");
  });

  it("flips what is on screen, not what was stored", () => {
    // Stored "light" on a dark machine still shows light, so the next press
    // must be dark.
    expect(resolveTheme("light", true)).toBe("light");
    expect(nextThemeChoice("light", true)).toBe("dark");
  });

  it("returns to the same place after two presses", () => {
    for (const system of [true, false]) {
      const once = nextThemeChoice("system", system);
      const twice = nextThemeChoice(once, system);
      expect(resolveTheme(twice, system)).toBe(resolveTheme("system", system));
    }
  });
});

describe("themeToggleLabel", () => {
  it("says what pressing it will do, not what is on screen", () => {
    expect(themeToggleLabel("dark")).toMatch(/to light/i);
    expect(themeToggleLabel("light")).toMatch(/to dark/i);
  });
});

describe("isThemeChoice", () => {
  it("knows the three states", () => {
    expect(isThemeChoice("system")).toBe(true);
    expect(isThemeChoice("sepia")).toBe(false);
  });
});
