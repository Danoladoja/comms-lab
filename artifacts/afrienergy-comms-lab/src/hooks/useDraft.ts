import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a piece of writing safe from everything that is not pressing Submit.
 *
 * The assignment box kept its text in memory only. Tapping "Quiz" to check the
 * pass mark and tapping back, closing the dialog, or a phone deciding to
 * reclaim a background tab all destroyed it — six hundred words, no warning, no
 * recovery. The bitter part is that the app was already saving *statistics
 * about* the essay to survive exactly those events, and never the essay.
 *
 * So the draft is written to the browser's own storage as it is typed, keyed to
 * the module, and restored when the box comes back. It is cleared once the work
 * is filed, because a stale draft reappearing over a submitted piece would be
 * its own kind of loss.
 *
 * Storage can refuse — a private window, blocked site data — so every read and
 * write is guarded and the box simply behaves as it did before if it fails.
 * That is a worse day than a saved draft, but no worse than today.
 */

const PREFIX = 'ananse.draft.';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* Nothing to be done, and nothing worth interrupting the writer for. */
  }
}

export type Draft = {
  /** What to show in the box: the restored draft, or what was filed before. */
  text: string;
  setText: (next: string) => void;
  /** Call once the work is safely filed. */
  clear: () => void;
  /** True when the box is showing something rescued rather than something filed. */
  restored: boolean;
};

export function useDraft(key: string, filed: string): Draft {
  // Read once, on the way in, so the box never flashes empty before restoring.
  const [text, setTextState] = useState(() => read(key) ?? filed);
  const [restored, setRestored] = useState(() => {
    const saved = read(key);
    return saved !== null && saved !== filed;
  });
  const lastFiled = useRef(filed);

  // When a submission arrives from the server after the box has mounted — the
  // first load of a module already filed — show it, unless the learner has a
  // rescued draft that differs from it.
  useEffect(() => {
    if (filed === lastFiled.current) return;
    lastFiled.current = filed;
    if (read(key) === null) setTextState(filed);
  }, [filed, key]);

  const setText = useCallback((next: string) => {
    setTextState(next);
    setRestored(false);
    write(key, next);
  }, [key]);

  const clear = useCallback(() => {
    setRestored(false);
    write(key, '');
  }, [key]);

  return { text, setText, clear, restored };
}
