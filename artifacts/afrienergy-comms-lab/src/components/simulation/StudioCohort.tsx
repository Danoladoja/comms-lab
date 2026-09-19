import { useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetStudioCohort, getGetStudioCohortQueryKey, type StudioCohort as Cohort,
  useAttachStudioExercises, useResendStudioExercise,
} from '@workspace/api-client-react';
import { needsChasing, cohortTally, resendProblem, apiReason } from '@workspace/domain';
import { Users, Loader2, ArrowRight, ChevronDown, CheckCircle2, Link2, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: getGetStudioCohortQueryKey(programId ?? 0) });

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

  const resend = useResendStudioExercise({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: r.emailed ? 'Sent, and they have been emailed' : 'Sent',
          description: r.note,
        });
        refresh();
      },
      onError: (err) => toast({
        title: 'Could not send another',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

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

            {/* Exercises already sent, joined up to a module. Shown only while
                there are any left to join. */}
            <AttachToModule
              programId={programId}
              unattached={data?.unattached ?? 0}
              modules={data?.modules ?? []}
              onDone={refresh}
            />

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
                      <Row
                        learner={learner}
                        onResend={() => programId && resend.mutate({
                          programId, data: { userId: learner.userId },
                        })}
                        resending={resend.isPending}
                      />
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

function Row({ learner, onResend, resending = false }: {
  learner: Learner;
  onResend?: () => void;
  resending?: boolean;
}) {
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

  /*
    Sending another is the last resort and looks like one.

    It appears against one person, only when their window shut before they ran
    it, and it is a separate line rather than a button inside the row — a row
    that is a link to their exercise cannot also carry a button without one
    swallowing the other.
  */
  const mayResend = !!onResend && resendProblem(learner.standing) === null;

  const row = openable ? (
    <Link href={`/studio/run/${learner.runId}`} aria-label={`Open ${learner.name}'s exercise`}>
      {body}
    </Link>
  ) : body;

  if (!mayResend) return row;
  return (
    <div>
      {row}
      <button
        type="button"
        disabled={resending}
        onClick={onResend}
        className="w-full flex items-center justify-center gap-2 py-2 border border-t-0 border-white/5 text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-[#f97316] hover:border-[#f97316]/30 transition-colors disabled:opacity-50"
      >
        <RotateCcw className="w-3 h-3" aria-hidden />
        {resending ? 'Sending…' : 'Send them a fresh one'}
      </button>
    </div>
  );
}

/**
 * Joining a round of exercises already sent up to a module.
 *
 * Simulation modules arrived after the first cohort had already been sent
 * theirs, so that round counted towards nothing. This files them, and it is
 * the only thing here that changes what a learner can open — so it says what
 * it will do before it does it, and disappears once there is nothing left to
 * file.
 */
function AttachToModule({ programId, unattached, modules, onDone }: {
  programId: number | null;
  unattached: number;
  modules: Cohort['modules'];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState('');
  const attach = useAttachStudioExercises({
    mutation: {
      onSuccess: (r) => {
        toast({ title: 'Filed', description: r.note });
        setSessionId('');
        onDone();
      },
      onError: (err) => toast({
        title: 'Could not file them',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  if (unattached === 0 || modules.length === 0) return null;
  const chosen = modules.find((m) => String(m.id) === sessionId);

  return (
    <div className="mb-6 border border-[#f97316]/25 bg-[#f97316]/[0.04] p-4">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#f97316] mb-2">
        <Link2 className="w-3.5 h-3.5" aria-hidden />
        {unattached} {unattached === 1 ? 'exercise counts' : 'exercises count'} towards nothing
      </p>
      <p className="text-xs text-white/60 leading-relaxed mb-3">
        These went out before the programme had a module for them. Filing them against one makes the
        work count: whoever has finished is done the moment you press it, and whoever has not is what
        holds the next module shut. Nobody's exercise changes.
      </p>
      <select
        className="w-full bg-[#030811] border border-white/20 text-white px-3 py-2 text-sm mb-2"
        value={sessionId}
        onChange={(e) => setSessionId(e.target.value)}
        aria-label="Which module"
      >
        <option value="">Choose a module</option>
        {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
      {chosen && (
        <p className="text-[11px] text-white/50 leading-relaxed mb-3">
          {chosen.opensTitle
            ? `Whoever has not run it to the end will not be able to open ${chosen.opensTitle}.`
            : 'Nothing comes after that module, so it opens nothing — but it still counts towards a certificate.'}
        </p>
      )}
      <button
        type="button"
        disabled={!sessionId || !programId || attach.isPending}
        onClick={() => programId && attach.mutate({ programId, data: { sessionId: Number(sessionId) } })}
        className="bg-[#f97316] text-[#030811] px-4 py-2 text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
      >
        {attach.isPending ? 'Filing…' : 'Make it the work for this module'}
      </button>
    </div>
  );
}
