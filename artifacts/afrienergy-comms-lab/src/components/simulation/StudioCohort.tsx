import { useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import {
  useGetStudioCohort, getGetStudioCohortQueryKey, type StudioCohort as Cohort,
} from '@workspace/api-client-react';
import { Users, Loader2, ArrowRight } from 'lucide-react';
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
 * People, ordered by who needs something first. An admin opens this to find
 * out who to chase, not to admire the ones who have finished.
 */
export default function StudioCohort({ programmes }: { programmes: { id: number; title: string }[] }) {
  const [programId, setProgramId] = useState<number | null>(programmes[0]?.id ?? null);

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-16 border-b border-white/5 flex items-center gap-3 px-8 shrink-0 bg-[#030811]/50 backdrop-blur-sm z-10">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2 shrink-0">
          <Users className="w-3.5 h-3.5" aria-hidden /> Who has done it
        </span>
        {programmes.length > 1 && (
          <select
            className="ml-auto bg-[#030811] border border-white/15 text-white/80 px-2 py-1 text-xs max-w-[55%]"
            value={programId ?? ''}
            onChange={(e) => setProgramId(Number(e.target.value))}
            aria-label="Which programme"
          >
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-8 min-h-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-[#f97316]">
            <Loader2 className="w-8 h-8 animate-spin" aria-hidden />
          </div>
        ) : !data || data.learners.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 text-center px-8">
            <Users className="w-12 h-12 mb-4 opacity-20" aria-hidden />
            <p className="text-sm font-mono uppercase tracking-widest mb-1">Nobody invited yet</p>
            <p className="text-xs">Send this cohort an exercise on the left.</p>
          </div>
        ) : (
          <>
            {/* The shape of the cohort in one line, written on the server so it
                cannot disagree with the list under it. */}
            <p className="text-xs text-white/60 mb-5 font-mono">{data.note}</p>

            <ul className="space-y-2">
              {data.learners.map((learner) => (
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
      </div>
    </div>
  );
}

type Learner = Cohort['learners'][number];

const LOOK: Record<Learner['standing'], { label: string; className: string }> = {
  missed: { label: 'Ran out of time', className: 'text-red-400 border-red-400/30 bg-red-400/5' },
  'not-started': { label: 'Not started', className: 'text-[#f97316] border-[#f97316]/30 bg-[#f97316]/5' },
  'in-progress': { label: 'Part-way', className: 'text-amber-300 border-amber-300/30 bg-amber-300/5' },
  waiting: { label: 'Not open yet', className: 'text-white/40 border-white/15 bg-white/[0.02]' },
  finished: { label: 'Finished', className: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' },
};

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
