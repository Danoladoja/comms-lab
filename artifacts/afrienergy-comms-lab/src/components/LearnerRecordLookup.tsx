import { useState } from 'react';
import {
  useGetLearnerRecord, getGetLearnerRecordQueryKey,
  useGetSubmitBlocks, getGetSubmitBlocksQueryKey,
  useListPrograms, useListProgramSessions, getListProgramSessionsQueryKey,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, AlertTriangle, CheckCircle2, LifeBuoy } from 'lucide-react';

/**
 * Two questions about one learner, both always on screen.
 *
 * They are different questions and they were not both reachable. "Where is
 * their record" and "why can they not hand work in" have different answers,
 * different causes and different fixes — and the second panel was drawn only
 * after somebody had already searched, so an admin opening this tab to find it
 * saw no sign it existed. It had been asked for by name and could not be
 * found, which is the same fault as building a screen with nothing to copy
 * from: a thing that exists only after an action nobody knew to take.
 *
 * So both are here from the moment the tab opens, each saying what it needs.
 */
export default function LearnerRecordLookup() {
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold">Look up one learner</p>
        <p className="text-xs text-muted-foreground">
          For when somebody says their work has gone, or that they cannot hand it in. Reads across
          the whole Lab, and reads nothing anybody wrote.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); setAsked(typed.trim().toLowerCase()); }}
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            type="email"
            placeholder="their email address"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!typed.trim()}>Look</Button>
      </form>

      <WhereIsTheirRecord email={asked} />
      <WhyBlocked email={asked} />
    </div>
  );
}

/** Question one: is their record there at all, and under what. */
function WhereIsTheirRecord({ email }: { email: string }) {
  const { data, isFetching } = useGetLearnerRecord(
    { email },
    { query: { enabled: !!email, queryKey: getGetLearnerRecordQueryKey({ email }) } },
  );

  const look = data?.verdict === 'all-present'
    ? { border: 'border-emerald-500/40 bg-emerald-500/5', Icon: CheckCircle2, tone: 'text-emerald-600' }
    : data?.verdict === 'nothing-here'
      ? { border: 'border-destructive/40 bg-destructive/5', Icon: AlertTriangle, tone: 'text-destructive' }
      : { border: 'border-amber-500/40 bg-amber-500/5', Icon: LifeBuoy, tone: 'text-amber-600' };

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Where is their record?
      </p>
      {!email ? (
        <p className="text-xs text-muted-foreground">Type an address above and press Look.</p>
      ) : isFetching ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />
      ) : data ? (
        <div className={`rounded-lg border p-3 space-y-3 ${look.border}`}>
          <p className="flex items-start gap-2 text-sm leading-relaxed">
            <look.Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${look.tone}`} aria-hidden />
            <span>{data.note}</span>
          </p>
          {data.accounts.length > 0 && (
            <ul className="space-y-2">
              {data.accounts.map((a) => (
                <li key={a.userId} className="rounded border border-border bg-background p-3 text-xs">
                  <p className="font-medium">Account #{a.userId} — {a.name} · made {a.createdAt}</p>
                  <p className="text-muted-foreground mt-1">
                    {a.minutesInClass} min in class · {a.minutesWatched} min of recordings ·{' '}
                    {a.tasksFiled} task{a.tasksFiled === 1 ? '' : 's'} filed
                    {a.withdrawnTasks > 0 ? ` (${a.withdrawnTasks} withdrawn)` : ''} ·{' '}
                    {a.critiquesWritten} critique{a.critiquesWritten === 1 ? '' : 's'} written ·{' '}
                    {a.critiquesReceived} received
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {a.enrolments.length === 0
                      ? 'Enrolled on nothing.'
                      : a.enrolments.map((e) => `${e.programmeTitle} (${e.status})`).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Question two: why can this learner not hand work in on this module.
 *
 * Every gate the submission route asks, in the order it asks them, including
 * the ones that are open — because "nothing here is refusing them" is itself
 * an answer, and it is the one that says to go and look at their screen.
 */
function WhyBlocked({ email }: { email: string }) {
  const [programId, setProgramId] = useState('');
  const [moduleId, setModuleId] = useState('');

  const { data: programmes = [] } = useListPrograms();
  const { data: modules = [] } = useListProgramSessions(Number(programId), {
    query: { enabled: !!programId, queryKey: getListProgramSessionsQueryKey(Number(programId)) },
  });
  const { data, isFetching } = useGetSubmitBlocks(
    { email, sessionId: Number(moduleId) },
    {
      query: {
        enabled: !!email && !!moduleId,
        queryKey: getGetSubmitBlocksQueryKey({ email, sessionId: Number(moduleId) }),
      },
    },
  );

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Why can they not hand work in?
      </p>

      <div className="flex flex-wrap gap-2">
        <select
          className="border border-border rounded-md px-2 py-1.5 text-xs bg-background"
          value={programId}
          onChange={(e) => { setProgramId(e.target.value); setModuleId(''); }}
          aria-label="Which programme"
        >
          <option value="">Choose a programme</option>
          {programmes.map((p: { id: number; title: string }) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <select
          className="border border-border rounded-md px-2 py-1.5 text-xs bg-background"
          value={moduleId}
          disabled={!programId}
          onChange={(e) => setModuleId(e.target.value)}
          aria-label="Which module"
        >
          <option value="">Choose a module</option>
          {modules.map((m: { id: number; title: string }) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {!email ? (
        <p className="text-xs text-muted-foreground">Type an address above, then pick the module.</p>
      ) : !moduleId ? (
        <p className="text-xs text-muted-foreground">Pick the module they are stuck on.</p>
      ) : data ? (
        <div className="space-y-2">
          <p className="text-sm leading-relaxed">{data.verdict}</p>
          <ul className="space-y-1">
            {data.gates.map((g) => (
              <li key={g.name} className="flex items-start gap-2 text-xs">
                {g.open
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden />
                  : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden />}
                <span className={g.open ? 'text-muted-foreground' : ''}>{g.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
