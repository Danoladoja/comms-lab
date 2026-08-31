/**
 * A small per-address budget for the endpoints anybody can reach.
 *
 * Deliberately in-memory and deliberately modest. This is one process, and a
 * restart clearing the counters costs nothing worth protecting: the job is to
 * stop a loop turning one form into thousands of emails, not to be a security
 * boundary. A real person sends one and never learns this exists.
 *
 * It lives here rather than in each route because the partnerships form and the
 * waitlist had grown identical copies, and a limiter that is fixed in one place
 * and not the other is worse than either.
 */

export type RateBudget = {
  /** Records an attempt and says whether this caller has had too many. */
  overBudget(key: string, now?: number): boolean;
  /** Forgets everything. For tests, and for nothing else. */
  reset(): void;
};

export function createBudget(options: {
  windowMs: number;
  max: number;
  /** Bounded, so a flood of distinct callers cannot grow the map without limit. */
  maxClients?: number;
}): RateBudget {
  const { windowMs, max, maxClients = 5000 } = options;
  const hits = new Map<string, number[]>();

  return {
    overBudget(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }

      recent.push(now);
      hits.set(key, recent);

      // Opportunistic sweep, so the map cannot grow forever on a busy day.
      if (hits.size > maxClients) {
        for (const [k, times] of hits) {
          if (times.every((t) => now - t >= windowMs)) hits.delete(k);
        }
      }

      return false;
    },
    reset() {
      hits.clear();
    },
  };
}
