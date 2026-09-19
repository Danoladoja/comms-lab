import { useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import {
  useGetStudioCohort, getGetStudioCohortQueryKey, type StudioCohort as Cohort,
} from '@workspace/api-client-react';
import { needsChasing, cohortTally } from '@workspace/domain';
import { Users, Loader2, ArrowRight, ChevronDown, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The Studio, as the person who set the exercise needs to see it.
 *
 * What it replaces listed exercises, and an admin sees every exercise — which
 * includes the private copy the Studio generates for each learner each time
 * one begins. So the list grew by one per run, was mostly other people's
 * private scenarios, and its length meant nothing: two devices looking at two
 * different moments showed two different numbers, both correct and both
 * useless. That is the whole of the "my phone and my laptop disagree" bug.
 *
 * People, then — but not all of them at once. Naming every learner turned a
 * cohort of fifty into fifty rows running off the bottom of the screen, and
 * most of those rows said "this one is fine". So the counts come first, the
 * list under them is only what is left to do, and everybody who needs nothing
 * sits behind one line you can open.
 */
export default function StudioCohort({ programmes }: { programmes: { id: number; title: string }[] }) {
  const [programId, setProgramId] = useState<number | null>(programmes[0]?.id ?? null);
  const [showRest, setShowRest] = useState(false);

  const { data, isLoading } = useGetStudioCohort(programId ?? 0, {
    query: {
      enabled: !!programId,
      queryKey: getGetStudioCohortQueryKey(programId ?? 0),
      // Slow — a cohort's standing changes over hours, not seconds. But it does
      // refresh, so a page left open while people work does not quietly become
      // yesterday's picture.
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
    },
  });

  const learners: Learner[] = data?.learners ?? [];
  const outstanding = learners.filter((l) => needsChasing(l.standing));
  const settled = learners.filter((l) => !needsChasing(l.standing));

  return (
    <div className="flex-1 flex flex-col lg:min-h-0">
      <div className="h-16 border-b border-white/5 flex items-center gap-3 px-6 sm:px-8 shrink-0 bg-[#030811]/50 backdrop-blur-sm z-10">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2 shrink-0">
          <Users className="w-3.5 h-3.5" aria-hidden /> Who has done it
        </span>
        {programmes.length > 1 && (
          <select
            className="ml-auto bg-[#030811] border border-white/15 text-white/80 px-2 py-1 text-xs max-w-[55%]"
            value={programId ?? ''}
            onChange={(e) => { setProgramId(Number(e.target.value)); setShowRest(false); }}
            aria-label="Which programme"
          >
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      {/*
        Its own scrollbar on a wide screen, where this is one of two columns
        side by side and the page itself must not move. On a phone the columns
        are stacked and the page is the scroll — a panel with its own scrollbar
        inside a page that also scrolls is two scrollbars fighting, and the
        second one is usually unreachable.
      */}
      <div className="flex-1 lg:overflow-y-auto p-6 sm:p-8 lg:min-h-0">
        {isLoading ? (
          <div className="py-24 flex items-center justify-center text-[#f97316]">
            <Loader2 className="w-8 h-8 animate-spin" aria-hidden />
          </div>
        ) : learners.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-white/30 text-center">
            <Users className="w-12 h-12 mb-4 opacity-20" aria-hidden />
            <p className="text-sm font-mono uppercase tracking-widest mb-1">Nobody invited yet</p>
            <p className="text-xs">Send this cohort an exercise on the left.</p>
          </div>
        ) : (
          <>
            {/* The whole cohort in one glance, before a single name. Most of
                the time this is the only part anybody needs to read. */}
            <Tally learners={learners} note={data?.note ?? ''} />

            {outstanding.length === 0 ? (
              <div className="flex items-start gap-3 p-4 border border-emerald-400/25 bg-emerald-400/[0.04] mb-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
                <p className="text-xs text-white/70 leading-relaxed">
                  Nobody is waiting on you. Everyone has either finished or has not been let in yet.
                </p>
              </div>
            ) : (
              <>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35 mb-3">
                  Still to do · {outstanding.length}
                </p>
                <ul className="space-y-2 mb-4">
                  {outstanding.map((learner) => (
                    <motion.li
                      key={learner.userId}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <Row learner={learner} />
                    </motion.li>
                  ))}
                </ul>
              </>
            )}

            {/* Everybody who needs nothing. One click away, and not in the way
                until it is asked for. */}
            {settled.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRest((v) => !v)}
                  aria-expanded={showRest}
                  className="w-full flex items-center gap-2 py-3 border-t border-white/10 text-[11px] text-white/45 hover:text-white/80 transition-colors"
                >
                  <ChevronDown
                    className={cn('w-3.5 h-3.5 transition-transform', showRest && 'rotate-180')}
                    aria-hidden
                  />
                  {showRest ? 'Hide' : 'Show'} the {settled.length} who need nothing
                </button>
                {showRest && (
                  <ul className="space-y-2 pt-1">
                    {settled.map((learner) => (
                      <li key={learner.userId}><Row learner={learner} /></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type Learner = Cohort['learners'][number];

const LOOK: Record<Learner['standing'], { label: string; className: string; tile: string }> = {
  missed: {
    label: 'Ran out of time',
    className: 'text-red-400 border-red-400/30 bg-red-400/5',
    tile: 'text-red-400 border-red-400/25',
  },
  'not-started': {
    label: 'Not started',
    className: 'text-[#f97316] border-[#f97316]/30 bg-[#f97316]/5',
    tile: 'text-[#f97316] border-[#f97316]/25',
  },
  'in-progress': {
    label: 'Part-way',
    className: 'text-amber-300 border-amber-300/30 bg-amber-300/5',
    tile: 'text-amber-300 border-amber-300/25',
  },
  waiting: {
    label: 'Not open yet',
    className: 'text-white/40 border-white/15 bg-white/[0.02]',
    tile: 'text-white/45 border-white/15',
  },
  finished: {
    label: 'Finished',
    className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
    tile: 'text-emerald-400 border-emerald-400/25',
  },
};

/** The counts, and how many people they are counting. */
function Tally({ learners, note }: { learners: Learner[]; note: string }) {
  const tally = cohortTally(learners);
  return (
    <div className="mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {tally.map(({ standing, count }) => (
          <div
            key={standing}
            className={cn('border bg-white/[0.015] px-3 py-2.5', LOOK[standing].tile)}
          >
            <span className="block font-mono text-2xl leading-none tabular-nums">{count}</span>
            <span className="block text-[9px] uppercase tracking-[0.15em] mt-1.5 opacity-80">
              {LOOK[standing].label}
            </span>
          </div>
        ))}
      </div>
      {/* Written on the server, so the sentence cannot disagree with the
          counts above it or the list below. */}
      <p className="text-[11px] text-white/40">{note}</p>
    </div>
  );
}

function Row({ learner }: { learner: Learner }) {
  const look = LOOK[learner.standing];
  // Only a run can be opened. Somebody who has not begun has nothing to read.
  const openable = !!learner.runId;

  const body = (
    <div className={cn(
      'flex items-center gap-3 p-4 border border-white/5 bg-white/[0.01] transition-colors',
      openable && 'hover:bg-white/[0.04] hover:border-[#f97316]/30 cursor-pointer',
    )}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white/90 truncate">{learner.name}</span>
        <span className="block text-[11px] text-white/35 truncate">{learner.email}</span>
      </span>

      {learner.score !== null && learner.score !== undefined && (
        <span className="shrink-0 font-mono text-lg text-[#f97316] tabular-nums">{learner.score}</span>
      )}

      <span className={cn(
        'shrink-0 text-[9px] font-bold uppercase tracking-[0.15em] px-2 py-1 border',
        look.className,
      )}>
        {look.label}
      </span>

      {openable && <ArrowRight className="w-4 h-4 text-white/25 shrink-0" aria-hidden />}
    </div>
  );

  if (!openable) return body;
  return (
    <Link href={`/studio/run/${learner.runId}`} aria-label={`Open ${learner.name}'s exercise`}>
      {body}
    </Link>
  );
}
