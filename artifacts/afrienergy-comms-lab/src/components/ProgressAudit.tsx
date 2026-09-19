import { useState } from 'react';
import {
  useGetProgressAudit, getGetProgressAuditQueryKey, type ProgressAudit as Audit,
} from '@workspace/api-client-react';
import { Loader2, AlertTriangle, CheckCircle2, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * What is recorded against each learner, beside what the Lab says about it.
 *
 * Every number a learner sees is worked out from stored rows at the moment
 * they ask for it, so a fault in the working shows up as a wrong verdict with
 * no trace of how it got there. Learners reported replay and critiques not
 * counting, and progress disappearing, and there was no way to answer them
 * except "it should be working".
 *
 * Two columns, then: what is stored, and what the Lab concluded. Where those
 * cannot both be right, it says so in a sentence. It reads only — an audit
 * that repaired as it went could not be run twice, and the point of it is to
 * be run again after a fix.
 *
 * Opens on the people with something to answer for, because nobody opens an
 * audit to read the clean rows.
 */
export default function ProgressAudit({ programmes }: { programmes: { id: number; title: string }[] }) {
  const [programId, setProgramId] = useState<number | null>(programmes[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [showClean, setShowClean] = useState(false);

  const { data, isLoading, isFetching } = useGetProgressAudit(programId ?? 0, {
    query: {
      enabled: !!programId,
      queryKey: getGetProgressAuditQueryKey(programId ?? 0),
      // Never on a timer. It reads the whole cohort's record and is opened
      // deliberately, to answer a question somebody asked.
      staleTime: 60_000,
    },
  });

  const moduleTitle = new Map((data?.modules ?? []).map((m) => [m.id, m.title]));
  const all = data?.learners ?? [];
  const matching = all.filter((l) =>
    !query.trim() || `${l.name} ${l.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const flagged = matching.filter((l) => l.flagged > 0);
  const clean = matching.filter((l) => l.flagged === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {programmes.length > 1 && (
          <select
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={programId ?? ''}
            onChange={(e) => { setProgramId(Number(e.target.value)); setOpenId(null); }}
            aria-label="Which programme"
          >
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Find a learner by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" aria-hidden /></div>
      ) : !data ? null : (
        <>
          <p className="text-sm text-muted-foreground">{data.note}</p>

          {flagged.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden />
              <p className="text-sm">
                Nothing here contradicts itself. Every learner's stored record and the Lab's verdict
                about it agree.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {flagged.map((learner) => (
                <LearnerCard
                  key={learner.userId}
                  learner={learner}
                  moduleTitle={moduleTitle}
                  open={openId === learner.userId}
                  onToggle={() => setOpenId(openId === learner.userId ? null : learner.userId)}
                />
              ))}
            </ul>
          )}

          {clean.length > 0 && (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setShowClean((v) => !v)}>
                <ChevronDown className={`w-4 h-4 mr-1.5 transition-transform ${showClean ? 'rotate-180' : ''}`} aria-hidden />
                {showClean ? 'Hide' : 'Show'} the {clean.length} whose record adds up
              </Button>
              {showClean && (
                <ul className="space-y-2 mt-2">
                  {clean.map((learner) => (
                    <LearnerCard
                      key={learner.userId}
                      learner={learner}
                      moduleTitle={moduleTitle}
                      open={openId === learner.userId}
                      onToggle={() => setOpenId(openId === learner.userId ? null : learner.userId)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Learner = Audit['learners'][number];

function LearnerCard({ learner, moduleTitle, open, onToggle }: {
  learner: Learner;
  moduleTitle: Map<number, string>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-sm truncate">{learner.name}</span>
          <span className="block text-xs text-muted-foreground truncate">{learner.email}</span>
        </span>
        {learner.flagged > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 flex-shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            {learner.flagged} to look at
          </span>
        ) : (
          <span className="text-xs text-muted-foreground flex-shrink-0">Adds up</span>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {learner.rows.map((row) => (
            <div key={row.sessionId} className="text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <span className="font-medium">{moduleTitle.get(row.sessionId) ?? `Module ${row.sessionId}`}</span>
                <span className="text-muted-foreground">
                  {row.locked ? 'Locked' : row.completed ? 'Complete' : `${row.progressPct}%`}
                </span>
              </div>
              {/* What is stored, in the order somebody would ask about it. */}
              <p className="text-muted-foreground">
                {row.liveMinutes} min in class
                {' · '}{row.watchedMinutes} min of the recording
                {row.learnerRecordingMinutes !== null && row.learnerRecordingMinutes !== undefined
                  ? ` (of ${row.learnerRecordingMinutes} min)` : ''}
                {' · '}task {row.hasSubmission ? 'in' : 'not in'}
                {' · '}{row.critiquesGiven} of {row.reviewsRequired} critique{row.reviewsRequired === 1 ? '' : 's'} written
                {' · '}{row.critiquesReceived} received
                {row.quizBestScore !== null && row.quizBestScore !== undefined
                  ? ` · quiz ${row.quizBestScore}%` : ''}
              </p>
              {row.flags.map((flag) => (
                <p
                  key={flag.code}
                  className="mt-1.5 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-amber-800 dark:text-amber-300 leading-relaxed"
                >
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
                  <span>{flag.note}</span>
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
