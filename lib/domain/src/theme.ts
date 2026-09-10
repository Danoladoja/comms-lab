/**
 * Light or dark.
 *
 * The Lab's stylesheet has carried a complete dark palette from the beginning:
 * every colour redefined under a `.dark` class. Nothing anywhere ever put that
 * class on, so it has never once been seen. This is the missing switch, and it
 * is the rule rather than the button, because the rule is the part that is easy
 * to get subtly wrong.
 *
 * Three states, not two. A person who has chosen light or dark gets what they
 * chose, on any machine, whatever the machine thinks. A person who has chosen
 * nothing follows their computer, and keeps following it when they change it at
 * dusk. Collapsing that third state into a default of "light" is the common
 * mistake, and it is the one that makes a dark-mode setting feel broken.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/** Where the choice is kept. Named here so nothing has to retype the string. */
export const THEME_STORAGE_KEY = "ananse-theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/** Anything unreadable means "no choice made", which is the honest default. */
export function readThemeChoice(stored: unknown): ThemeChoice {
  return isThemeChoice(stored) ? stored : "system";
}

/** What to actually paint, given the choice and what the computer prefers. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  return systemPrefersDark ? "dark" : "light";
}

/**
 * What pressing the switch does.
 *
 * It sets an explicit choice, always: somebody on a light computer who presses
 * it wants dark now, not "follow the computer, which is light, so nothing
 * happens". A one-press control that appears to do nothing is worse than none.
 */
export function nextThemeChoice(choice: ThemeChoice, systemPrefersDark: boolean): ThemeChoice {
  return resolveTheme(choice, systemPrefersDark) === "dark" ? "light" : "dark";
}

/** What the button should say it will do. Never what it currently is. */
export function themeToggleLabel(current: Theme): string {
  return current === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
