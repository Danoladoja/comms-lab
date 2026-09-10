import { useCallback, useEffect, useState } from 'react';
import {
  readThemeChoice,
  resolveTheme,
  nextThemeChoice,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeChoice,
} from '@workspace/domain';

/**
 * Turning the Lab dark.
 *
 * The stylesheet has always carried a full dark palette under a `.dark` class
 * and nothing has ever put that class on. This is the switch. The rules about
 * which theme wins live in the domain, tested; this is only the part that
 * touches the browser.
 *
 * Two things it has to get right. Somebody who has chosen nothing follows their
 * computer, and keeps following it when they change it at dusk, which is why
 * the media query is listened to rather than read once. And the class goes on
 * before the first paint, from the snippet in index.html, because a white flash
 * on the way to a dark page is worse than no dark mode at all.
 */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function storedChoice(): ThemeChoice {
  try {
    return readThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // A private window, or site data switched off. Following the computer is
    // the right answer when we cannot remember anything.
    return 'system';
  }
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(storedChoice);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Keep following the computer for as long as nothing has been chosen.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const listen = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', listen);
    return () => query.removeEventListener('change', listen);
  }, []);

  const theme = resolveTheme(choice, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    // Tells the browser to paint its own furniture — scrollbars, form controls,
    // the space beyond the page — to match, rather than leaving a white margin
    // around a dark page.
    root.style.colorScheme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setChoice((current) => {
      const next = nextThemeChoice(current, systemPrefersDark());
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* nothing to do */ }
      return next;
    });
  }, []);

  return { theme, toggle };
}
