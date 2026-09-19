import { useState } from 'react';
import { useGetLearnerRecord, getGetLearnerRecordQueryKey } from '@workspace/api-client-react';
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
