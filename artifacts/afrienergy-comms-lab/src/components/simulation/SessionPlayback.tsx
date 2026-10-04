import { useEffect, useMemo, useState } from 'react';
import { useGetSessionPlayback, getGetSessionPlaybackQueryKey } from '@workspace/api-client-react';
import { apiReason } from '@workspace/domain';
import { cn } from '@/lib/utils';
import {
  Loader2, Play, Pause, DoorOpen, Radio, Send, MessageSquare,
  Crown, PencilLine, ThumbsUp, Flag, EyeOff,
} from 'lucide-react';

/**
 * The session, read back.
 *
 * An admin who planned a session watched a list of names go green and read four
 * debriefs afterwards — the outcome, with none of the behaviour, and the
 * behaviour is what is being taught. This is the forty-five minutes in the
 * order they happened.
 *
 * Two decisions shape it. It opens showing everything, because the first
 * question is always "what happened" rather than "what happened at minute
 * twelve" — the clock is there to move through a session you have already
 * skimmed, not a gate you have to open first. And filtering by team is the main
 * control rather than a secondary one, because four rooms interleaved is four
 * conversations nobody can follow at once.
 */
export default function SessionPlayback({ sessionId }: { sessionId: number }) {
  const { data, error, isLoading } = useGetSessionPlayback(sessionId, {
    query: { queryKey: getGetSessionPlaybackQueryKey(sessionId) },
  });

  const [team, setTeam] = useState<string | null>(null);
  const [upTo, setUpTo] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const minutes = data?.minutes ?? 0;
  const cursor = upTo ?? minutes;

  /*
    One minute of the session per tick.

    Fast enough to watch a session in under a minute, slow enough that the
    entries arriving mean something. Stops itself at the end rather than
    looping, because a timeline that starts again is a timeline you lose your
    place in.
  */
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setUpTo((at) => {
        const next = (at ?? 0) + 1;
        if (next >= minutes) { setPlaying(false); return minutes; }
        return next;
      });
    }, 900);
    return () => clearInterval(timer);
  }, [playing, minutes]);

  const shown = useMemo(() => {
    const all = data?.entries ?? [];
    return all.filter((e) => {
      if (team !== null && e.teamId !== null && e.teamId !== team) return false;
      // Entries with no known minute always show: hiding them behind a clock
      // they do not have would hide them for ever.
      if (e.minute !== null && e.minute > cursor) return false;
      return true;
    });
  }, [data?.entries, team, cursor]);

  if (isLoading) {
    return <p className="mt-5 text-xs text-white/40 flex items-center gap-2">
      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading the session back…
    </p>;
  }
  if (error || !data) {
    return <p className="mt-5 text-xs text-white/60">{apiReason(error, 'This session could not be read back.')}</p>;
  }

  return (
    <div className="mt-5 border border-white/10">
      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { if (cursor >= minutes) setUpTo(0); setPlaying(!playing); }}
          className="bg-[#f97316] text-[#030811] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5"
        >
          {playing ? <Pause className="w-3 h-3" aria-hidden /> : <Play className="w-3 h-3" aria-hidden />}
          {playing ? 'Pause' : 'Play it back'}
        </button>

        <label className="flex-1 min-w-[160px] flex items-center gap-2">
          <span className="sr-only">Minute</span>
          <input
            type="range"
            min={0}
            max={Math.max(minutes, 1)}
            value={cursor}
            onChange={(e) => { setPlaying(false); setUpTo(Number(e.target.value)); }}
            className="flex-1 accent-[#f97316]"
          />
        </label>
        <span className="text-[11px] font-mono text-white/50 tabular-nums w-20 text-right">
          min {cursor} / {minutes}
        </span>
      </div>

      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap gap-1.5">
        <Chip on={team === null} onClick={() => setTeam(null)}>Everything</Chip>
        {data.teams.map((t) => (
          <Chip key={t.id} on={team === t.id} onClick={() => setTeam(t.id)} title={t.summary}>
            {t.name}
          </Chip>
        ))}
      </div>

      {team !== null && (
        <p className="px-4 py-2 text-[11px] text-white/45 border-b border-white/10">
          {data.teams.find((t) => t.id === team)?.summary}
        </p>
      )}

      {data.roomsWithheldNote && (
        <p className="px-4 py-3 text-[11px] text-white/50 border-b border-white/10 flex items-start gap-2">
          <EyeOff className="w-3.5 h-3.5 mt-0.5 shrink-0 text-white/30" aria-hidden />
          {data.roomsWithheldNote}
        </p>
      )}

      <ol className="max-h-[460px] overflow-y-auto divide-y divide-white/[0.06]">
        {shown.map((entry, i) => <Entry key={i} entry={entry} teams={data.teams} />)}
        {shown.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-white/30">
            Nothing had happened by this point.
          </li>
        )}
      </ol>
    </div>
  );
}

function Chip({ on, onClick, title, children }: {
  on: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        'px-2.5 py-1 text-[11px] border',
        on ? 'border-[#f97316] bg-[#f97316]/15 text-white' : 'border-white/15 text-white/55 hover:border-white/30',
      )}
    >
      {children}
    </button>
  );
}

/* Each kind of thing gets its own mark, so the shape of a session is readable
   before a word of it is: a wall of chat with one answer at the end looks
   different from four answers and no talk at all. */
const LOOK: Record<string, { icon: typeof Radio; tint: string }> = {
  started: { icon: Flag, tint: 'text-white/40' },
  ended: { icon: Flag, tint: 'text-white/40' },
  arrived: { icon: DoorOpen, tint: 'text-emerald-300/70' },
  beat: { icon: Radio, tint: 'text-[#f97316]' },
  answer: { icon: Send, tint: 'text-emerald-300' },
  message: { icon: MessageSquare, tint: 'text-white/35' },
  vote: { icon: Crown, tint: 'text-amber-300/70' },
  draft: { icon: PencilLine, tint: 'text-sky-300/70' },
  nod: { icon: ThumbsUp, tint: 'text-emerald-300/60' },
};

function Entry({ entry, teams }: {
  entry: { kind: string; minute: number | null; teamId: string | null; who: string | null; title: string; body: string | null };
  teams: { id: string; name: string }[];
}) {
  const look = LOOK[entry.kind] ?? { icon: Radio, tint: 'text-white/40' };
  const Icon = look.icon;
  const teamName = entry.teamId ? teams.find((t) => t.id === entry.teamId)?.name : null;
  const major = entry.kind === 'beat' || entry.kind === 'answer';

  return (
    <li className="px-4 py-2.5 flex gap-3">
      {/* The minute, or a dash. Never a guess: a wrong minute on a timeline
          reads as a fact. */}
      <span className="w-10 shrink-0 text-[11px] font-mono text-white/30 tabular-nums pt-0.5">
        {entry.minute === null ? '—' : `${entry.minute}′`}
      </span>
      <Icon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', look.tint)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[13px] leading-snug', major ? 'text-white font-medium' : 'text-white/75')}>
          {entry.title}
          {teamName && entry.kind !== 'answer' && (
            <span className="text-white/30"> · {teamName}</span>
          )}
        </p>
        {entry.body && (
          <p className={cn(
            'mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words',
            major ? 'text-white/70 font-mono' : 'text-white/45',
          )}>
            {entry.body}
          </p>
        )}
      </div>
    </li>
  );
}
