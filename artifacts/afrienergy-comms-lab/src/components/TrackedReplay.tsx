import { useEffect, useRef, useState } from 'react';
import {
  recordReplayProgress,
  getListMyProgressQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  replayBucketFor,
  REPLAY_REPORT_INTERVAL_MS,
} from '@workspace/domain';
import { toEmbedUrl, isMeasurableRecording } from '@/lib/embed';
import { AlertTriangle } from 'lucide-react';

/**
 * The recording, with watched time measured.
 *
 * Playback position is sampled while the video is actually playing and turned
 * into fifteen-second buckets. Only buckets the learner has genuinely passed
 * through are reported, which is what makes dragging the scrubber to the end
 * worth exactly one bucket.
 *
 * Two player kinds can be measured: YouTube, via its iframe API, and direct
 * video files. Vimeo and Loom embeds expose no position without their own SDKs,
 * so a recording hosted there cannot be counted — the learner is told plainly
 * rather than left wondering why their progress never moves.
 */

const SAMPLE_INTERVAL_MS = 2000;

type YouTubePlayer = {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YouTubePlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youTubeApiPromise) return youTubeApiPromise;

  youTubeApiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youTubeApiPromise;
}

/** Collects buckets locally and flushes them to the server on a timer. */
function useBucketReporter(sessionId: number) {
  const qc = useQueryClient();
  const pending = useRef(new Set<number>());
  const duration = useRef<number | null>(null);
  const [watchedPct, setWatchedPct] = useState<number | null>(null);

  const flush = useRef(async () => {
    if (pending.current.size === 0) return;
    const buckets = [...pending.current];
    pending.current.clear();
    try {
      const result = await recordReplayProgress(sessionId, {
        buckets,
        ...(duration.current ? { durationSeconds: Math.round(duration.current) } : {}),
      });
      setWatchedPct(result.presence.replayPct);
      qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
    } catch {
      // Put them back so the next flush retries rather than losing the watch.
      for (const b of buckets) pending.current.add(b);
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => void flush.current(), REPLAY_REPORT_INTERVAL_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') void flush.current(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      void flush.current();
    };
  }, []);

  return {
    mark(positionSeconds: number, durationSeconds: number | null) {
      if (durationSeconds && durationSeconds > 0) duration.current = durationSeconds;
      pending.current.add(replayBucketFor(positionSeconds));
    },
    watchedPct,
  };
}

function YouTubeReplay({ sessionId, src, title }: { sessionId: number; src: string; title: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const { mark } = useBucketReporter(sessionId);

  useEffect(() => {
    let player: YouTubePlayer | null = null;
    let sampler: number | undefined;
    let cancelled = false;

    const videoId = src.split('/embed/')[1]?.split('?')[0];
    if (!videoId || !mountRef.current) return;

    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT) return;
      player = new window.YT.Player(mountRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            sampler = window.setInterval(() => {
              if (!player || !window.YT) return;
              // Only sample while actually playing — a paused video parked at
              // 40 minutes should not accrue anything.
              if (player.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
              mark(player.getCurrentTime(), player.getDuration());
            }, SAMPLE_INTERVAL_MS);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (sampler) window.clearInterval(sampler);
      try { player?.destroy(); } catch { /* already gone */ }
    };
  }, [src, sessionId]);

  return (
    <div className="w-full aspect-video">
      <div ref={mountRef} className="w-full h-full" title={title} />
    </div>
  );
}

function FileReplay({ sessionId, src }: { sessionId: number; src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { mark } = useBucketReporter(sessionId);

  return (
    <video
      ref={ref}
      src={src}
      controls
      className="w-full aspect-video bg-black"
      onTimeUpdate={() => {
        const el = ref.current;
        if (!el || el.paused || el.seeking) return;
        mark(el.currentTime, Number.isFinite(el.duration) ? el.duration : null);
      }}
    />
  );
}

export default function TrackedReplay({
  sessionId, recordingUrl, title,
}: {
  sessionId: number;
  recordingUrl: string;
  title: string;
}) {
  const embed = toEmbedUrl(recordingUrl);
  const measurable = isMeasurableRecording(recordingUrl);

  if (measurable && embed?.kind === 'iframe') {
    return <YouTubeReplay sessionId={sessionId} src={embed.src} title={title} />;
  }

  if (measurable && embed?.kind === 'video') {
    return <FileReplay sessionId={sessionId} src={embed.src} />;
  }

  // Vimeo, Loom, or an unrecognised link: playable, but position is not
  // readable, so watching it cannot be credited.
  return (
    <div className="w-full">
      {embed?.kind === 'iframe' ? (
        <iframe
          src={embed.src}
          title={title}
          className="w-full aspect-video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <div className="aspect-video flex items-center justify-center px-6 text-center">
          <a className="underline" href={recordingUrl} target="_blank" rel="noreferrer">
            Open the recording
          </a>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-amber-300 mt-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
        <span>
          Watch time can't be measured for this recording, so it won't count towards completing the module.
          Ask your facilitator to re-upload it to YouTube.
        </span>
      </p>
    </div>
  );
}
