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
 * Where one learner's record actually is.
 *
 * The cohort audit answers "is what is stored being counted correctly". This
 * answers the question somebody actually asks when a learner writes to say
 * their work has gone: is it there at all, and if so, under what.
 *
 * Typed rather than picked from a list, on purpose. The commonest reason a
 * record looks lost is that the learner now signs in as somebody the Lab has
 * never seen — and an account like that is not on the cohort list to pick.
 */
export default function LearnerRecordLookup() {
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  const [moduleId, setModuleId] = useState('');

  const { data, isFetching } = useGetLearnerRecord(
    { email: asked },
    { query: { enabled: !!asked, queryKey: getGetLearnerRecordQueryKey({ email: asked }) } },
  );

  const look = data?.verdict === 'all-present'
    ? { border: 'border-emerald-500/40 bg-emerald-500/5', Icon: CheckCircle2, tone: 'text-emerald-600' }
    : data?.verdict === 'nothing-here'
      ? { border: 'border-destructive/40 bg-destructive/5', Icon: AlertTriangle, tone: 'text-destructive' }
      : { border: 'border-amber-500/40 bg-amber-500/5', Icon: LifeBuoy, tone: 'text-amber-600' };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Find one learner&apos;s record</p>
        <p className="text-xs text-muted-foreground">
          For when somebody says their work has gone. Looks across the whole Lab, not just this
          programme, and reads nothing anybody wrote.
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
        <Button type="submit" disabled={!typed.trim() || isFetching}>
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : 'Look'}
        </Button>
      </form>

      {/* And, for the other question entirely: why can this one person not hand
          work in on this one module. Every gate the server asks, in the order
          it asks them, because from a desk they all look the same. */}
      {asked && <WhyBlocked email={asked} moduleId={moduleId} onPickModule={setModuleId} />}

      {data && (
        <div className={`rounded-lg border p-3 space-y-3 ${look.border}`}>
          <p className="flex items-start gap-2 text-sm leading-relaxed">
            <look.Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${look.tone}`} aria-hidden />
            <span>{data.note}</span>
          </p>

          {data.accounts.length > 0 && (
            <ul className="space-y-2">
              {data.accounts.map((a) => (
                <li key={a.userId} className="rounded border border-border bg-background p-3 text-xs">
                  <p className="font-medium">
                    Account #{a.userId} — {a.name} · made {a.createdAt}
                  </p>
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
      )}
    </div>
  );
}

/**
 * Why this learner cannot hand work in on this module.
 *
 * Built because guessing did not work. A learner who has done everything and
 * still cannot submit produces the same complaint whatever is refusing them,
 * and from here those are indistinguishable. This asks the server and reports
 * every gate, including the ones that are open — because "nothing here is
 * refusing them" is itself the answer sometimes, and it is the one that says
 * to go and look at their screen instead.
 */
function WhyBlocked({ email, moduleId, onPickModule }: {
  email: string;
  moduleId: string;
  onPickModule: (id: string) => void;
}) {
  const { data: programmes = [] } = useListPrograms();
  const [programId, setProgramId] = useState('');
  const { data: modules = [] } = useListProgramSessions(Number(programId), {
    query: {
      enabled: !!programId,
      queryKey: getListProgramSessionsQueryKey(Number(programId)),
    },
  });
  const { data, isFetching } = useGetSubmitBlocks(
    { email, sessionId: Number(moduleId) },
    {
      query: {
        enabled: !!moduleId,
        queryKey: getGetSubmitBlocksQueryKey({ email, sessionId: Number(moduleId) }),
      },
    },
  );

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
      <p className="text-xs font-medium">Why can they not hand work in?</p>
      <div className="flex flex-wrap gap-2">
        <select
          className="border border-border rounded-md px-2 py-1.5 text-xs bg-background"
          value={programId}
          onChange={(e) => { setProgramId(e.target.value); onPickModule(''); }}
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
          onChange={(e) => onPickModule(e.target.value)}
        >
          <option value="">Choose a module</option>
          {modules.map((m: { id: number; title: string }) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {data && (
        <div className="space-y-2 pt-1">
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
      )}
    </div>
  );
}
