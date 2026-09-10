import { useState } from 'react';
import { useListTaughtCohort, getListTaughtCohortQueryKey } from '@workspace/api-client-react';
import { describeTaughtCohort } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Users, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Who is in the class you are teaching.
 *
 * A facilitator could see their modules and not the people sitting in them,
 * which is an odd thing to withhold from the person about to stand at the front
 * of the room. Somebody preparing a class wants to know whether they are
 * talking to nine people or thirty, and who they are.
 *
 * It is the register and nothing more. There is no status control and no way to
 * write to anybody in bulk: running the cohort is the admin's job, and mixing
 * the two here would put a fifty-person send button on a page nobody expects to
 * find one on.
 *
 * Shut until asked, and the list is only fetched when it is opened — a
 * facilitator teaching four programmes should not pull four registers to read
 * their own timetable.
 */
export default function TaughtCohort({ programId }: { programId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useListTaughtCohort(programId, {
    query: { queryKey: getListTaughtCohortQueryKey(programId), enabled: open, retry: false },
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-sm font-medium">
          {data ? describeTaughtCohort(data) : 'Who is in this class'}
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>

      {open && (
        <div className="border-t border-border p-4">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
          ) : !data || data.learners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody is on this programme yet. The team enrol learners before the first class.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.learners.map(learner => (
                <li key={learner.email || learner.name} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">{learner.name || learner.email}</span>
                  {learner.finished && (
                    <span className="shrink-0 text-xs text-muted-foreground">Finished</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
