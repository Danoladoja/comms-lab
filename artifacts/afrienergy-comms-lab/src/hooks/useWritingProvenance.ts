import { useCallback, useRef } from 'react';
import { SITTING_GAP_MINUTES } from '@workspace/domain';

/**
 * Watches how a piece of writing comes to exist, so the Lab can describe it
 * rather than guess at it.
 *
 * What this records: how long somebody was typing, over how many separate
 * stretches, and how much text arrived by paste. Counts and durations, nothing
 * else. It never sees a keystroke and never keeps a word — the whole point is
 * that the Lab can say that out loud to a cohort without flinching.
 *
 * What it is not: a detector. There is no score here and none anywhere else.
 *
 * The counters live in localStorage against the module, because people draft
 * across days and a tally that resets when the tab closes would describe the
 * last ten minutes rather than the work.
 */

type Counters = {
  activeSeconds: number;
  sittings: number;
  pasteCount: number;
  pastedChars: number;
  largestPaste: number;
  /** Epoch ms of the last keystroke, so the next one knows how long the pause was. */
  lastAt: number;
};

const EMPTY: Counters = {
  activeSeconds: 0, sittings: 0, pasteCount: 0, pastedChars: 0, largestPaste: 0, lastAt: 0,
};

/**
 * A pause longer than this is thinking time, not typing time, and only this much
 * of it counts. Without a cap, a tab left open over lunch would read as an hour
 * of careful work — which would be a lie in the flattering direction.
 */
const MAX_GAP_SECONDS = 120;

const SITTING_GAP_MS = SITTING_GAP_MINUTES * 60 * 1000;

function storageKey(sessionId: number) {
  return `ananse.writing.${sessionId}`;
}

function load(sessionId: number): Counters {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Counters>;
    return {
      activeSeconds: Number(parsed.activeSeconds) || 0,
      sittings: Number(parsed.sittings) || 0,
      pasteCount: Number(parsed.pasteCount) || 0,
      pastedChars: Number(parsed.pastedChars) || 0,
      largestPaste: Number(parsed.largestPaste) || 0,
      lastAt: Number(parsed.lastAt) || 0,
    };
  } catch {
    // A private window, cleared site data, a browser that refuses. The piece
    // still gets filed; it simply arrives without a record, which the Lab
    // already knows how to say honestly.
    return { ...EMPTY };
  }
}

function save(sessionId: number, counters: Counters) {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(counters));
  } catch { /* nothing to do */ }
}

export type WritingProvenance = {
  /** Call on every change to the editor. */
  onType: () => void;
  /** Call from the textarea's onPaste. */
  onPaste: (pasted: string) => void;
  /** The numbers to send with the submission. */
  read: () => Omit<Counters, 'lastAt'>;
  /** Call once the piece is filed, so a resubmit starts a fresh record. */
  clear: () => void;
};

export function useWritingProvenance(sessionId: number): WritingProvenance {
  const counters = useRef<Counters | null>(null);

  const current = useCallback(() => {
    if (!counters.current) counters.current = load(sessionId);
    return counters.current;
  }, [sessionId]);

  const onType = useCallback(() => {
    const c = current();
    const now = Date.now();
    if (c.lastAt === 0 || now - c.lastAt > SITTING_GAP_MS) {
      c.sittings += 1;
    } else {
      c.activeSeconds += Math.min(MAX_GAP_SECONDS, Math.round((now - c.lastAt) / 1000));
    }
    c.lastAt = now;
    save(sessionId, c);
  }, [current, sessionId]);

  const onPaste = useCallback((pasted: string) => {
    const size = pasted.length;
    if (size === 0) return;
    const c = current();
    c.pasteCount += 1;
    c.pastedChars += size;
    c.largestPaste = Math.max(c.largestPaste, size);
    save(sessionId, c);
  }, [current, sessionId]);

  const read = useCallback(() => {
    const { lastAt: _lastAt, ...rest } = current();
    return rest;
  }, [current]);

  const clear = useCallback(() => {
    counters.current = { ...EMPTY };
    try { localStorage.removeItem(storageKey(sessionId)); } catch { /* nothing to do */ }
  }, [sessionId]);

  return { onType, onPaste, read, clear };
}
