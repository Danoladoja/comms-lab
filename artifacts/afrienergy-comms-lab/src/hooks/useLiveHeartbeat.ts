import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { recordHeartbeat, getListMyProgressQueryKey } from '@workspace/api-client-react';
import { HEARTBEAT_INTERVAL_MS, liveWindow } from '@workspace/domain';

/**
 * Reports in while the classroom is open during a live class.
 *
 * The class itself runs in Google Meet, so what this measures is the classroom
 * page being open while the class is scheduled — a proxy, not a measurement.
 * Two things keep it honest, both enforced server-side rather than here: each
 * beat credits at most the gap since the last one, and only time inside the
 * scheduled window counts at all.
 *
 * Beats pause when the tab is hidden. Someone who backgrounds the tab to watch
 * in Meet keeps their credit — the browser still fires timers in a hidden tab,
 * throttled — but a laptop that sleeps or a tab left open overnight banks
 * nothing beyond the per-beat cap.
 */
export function useLiveHeartbeat(session: {
  id: number;
  startsAt?: unknown;
  durationMins: number;
} | undefined) {
  const qc = useQueryClient();
  // Progress is refreshed sparingly: every beat would re-render the whole
  // classroom twice a minute for a number that moves slowly.
  const beatsSinceRefresh = useRef(0);

  useEffect(() => {
    if (!session) return;

    const isLiveNow = () =>
      liveWindow(
        { startsAt: session.startsAt as string | null, durationMins: session.durationMins },
        Date.now(),
      ).state === 'live';

    if (!isLiveNow()) return;

    let cancelled = false;

    const beat = async () => {
      if (cancelled || !isLiveNow()) return;
      try {
        await recordHeartbeat(session.id);
        beatsSinceRefresh.current += 1;
        // Roughly every five minutes.
        if (beatsSinceRefresh.current >= 10) {
          beatsSinceRefresh.current = 0;
          qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        }
      } catch {
        // A dropped beat is not worth telling the learner about — the next one
        // credits the gap, up to the server's cap.
      }
    };

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);

    // Beat once more when the class ends so the final stretch is credited
    // without waiting for the next interval.
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
    };
  }, [session?.id, session?.startsAt, session?.durationMins, qc]);
}
