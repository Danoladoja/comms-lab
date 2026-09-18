import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPrograms,
  useListProgramSessions,
  useGetCohortProgress,
  useListModuleExtensions,
  useGrantDeadlineExtension,
  useRevokeDeadlineExtension,
  useCreditClassAttendance,
  useRevokeClassAttendance,
  getListProgramsQueryKey,
  getListProgramSessionsQueryKey,
  getGetCohortProgressQueryKey,
  getListModuleExtensionsQueryKey,
  getListAllEnrollmentsQueryKey,
  type CohortProgress,
  type CohortLearnerRow,
  type CohortModuleRollup,
  type CohortCell,
} from '@workspace/api-client-react';
import { apiReason, sessionDateTimeFromInput, SUGGESTED_REASON, takeBackWarning } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CouldNotLoad } from '@/components/CouldNotLoad';
import { CalendarClock, ChevronDown, ChevronUp, Users, AlertTriangle, Lock, UserCheck } from 'lucide-react';


/**
 * Extensions: extra time on a module, for one learner or the whole cohort.
 *
 * This began as a link beside each learner reading "Deadlines…", which was
 * wrong twice over. It did not look like something you could press, and it was
 * organised around the wrong noun: an admin thinks "module two caught people
 * out" far more often than "Kwame specifically", so finding everyone stuck on
 * one module meant opening forty-five people one at a time.
 *
 * So: module first. Choose one, and the whole cohort's standing on it is a
 * single table — who has submitted, who has not, who already has extra time. The
 * decision an admin is actually making is visible in one place, and giving the
 * whole cohort extra time is one button rather than forty-five.
 *
 * Note what the cohort-wide button does NOT do: it does not move the module's
 * own deadline. Every learner gets the new date individually, which is slower
 * in the database and correct in the way that matters — the module keeps the
 * rules it was taught under. Moving module one's deadline forward would quietly
 * impose the 500-word floor on a cohort that was never asked for it.
 */
function Extensions({ programId, focus }: {
  programId: number;
  /**
   * A module and learner the tracker above has sent down here.
   *
   * `at` is a timestamp rather than decoration: pressing the same person's
   * square twice has to open the panel twice, and without something that
   * changes on every press the second one would do nothing and read as a
   * broken button.
   */
  focus?: { sessionId: number; userId: number; at: number } | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  /** Who the next grant applies to. Empty means nobody has been picked yet. */
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  /** Why attendance is being credited. Goes on the record beside each name. */
  const [creditReason, setCreditReason] = useState(SUGGESTED_REASON);

  // Arriving from a square in the grid, or from the chase list: open on that
  // module with that learner already ticked, so the admin's next action is
  // choosing a date rather than finding the person again.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setSessionId(focus.sessionId);
    setChosen(new Set([focus.userId]));
    // The panel sits below the grid and the charts, so without this the square
    // an admin pressed appears to do nothing at all.
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus?.at]);

  const { data: sessions = [] } = useListProgramSessions(programId, {
    query: { queryKey: getListProgramSessionsQueryKey(programId), enabled: open },
  });
  const { data: module, isLoading } = useListModuleExtensions(sessionId as number, {
    query: {
      queryKey: getListModuleExtensionsQueryKey(sessionId as number),
      enabled: open && sessionId !== null,
    },
  });

  const refresh = () => {
    if (sessionId !== null) {
      qc.invalidateQueries({ queryKey: getListModuleExtensionsQueryKey(sessionId) });
    }
    qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() });
    // The tracker above is the reason anybody pressed these buttons. Leaving it
    // showing somebody as behind after their extra time has just been granted
    // would have an admin grant it twice.
    qc.invalidateQueries({ queryKey: getGetCohortProgressQueryKey(programId) });
  };

  const grant = useGrantDeadlineExtension({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: r.granted === 1 ? 'Extra time given' : `Extra time given to ${r.granted}`,
          description: r.emailed > 0 ? `${r.note} They have been emailed.` : r.note,
        });
        setChosen(new Set()); setWhen(''); setReason('');
        refresh();
      },
      // Every refusal here names something specific about the date that was
      // typed, so the server's sentence travels rather than a generic failure.
      onError: (err) => toast({
        title: 'Could not give extra time',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const credit = useCreditClassAttendance({
    mutation: {
      onSuccess: (r) => {
        toast({ title: r.changed > 0 ? 'Attendance credited' : 'Nothing to credit', description: r.note });
        setChosen(new Set());
        refresh();
      },
      onError: (err) => toast({
        title: 'Could not credit the class',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const uncredit = useRevokeClassAttendance({
    mutation: {
      onSuccess: (r) => { toast({ title: 'Credit removed', description: r.note }); refresh(); },
      onError: (err) => toast({
        title: 'Could not take it back',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const revoke = useRevokeDeadlineExtension({
    mutation: {
      onSuccess: () => { toast({ title: 'Extra time taken back' }); refresh(); },
      onError: (err) => toast({
        title: 'Could not take it back',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const learners = module?.learners ?? [];
  const withExtra = learners.filter(l => l.extendedTo);
  const notDone = learners.filter(l => !l.complete);
  /**
   * People a later deadline will not help.
   *
   * They have done everything that can be handed in and are still short of the
   * class itself. Extra time buys them nothing — the recording is what they
   * need, and the recording was never shut. Naming them stops an admin granting
   * extra time, watching nothing change, and concluding the feature is broken.
   */
  const onlyMissingTheClass = learners.filter(
    l => !l.complete && !l.attended
      && (!l.hasAssignment || l.submitted)
      && (!l.hasQuiz || l.quizPassed)
      && l.critiquesGiven >= l.critiquesRequired,
  );
  const anyCritiques = learners.some(l => l.critiquesRequired > 0);
  /** Nobody has any attendance for this module — the modules-one-and-two case. */
  const needCredit = learners.filter(l => !l.attended);
  /**
   * People extra time cannot reach.
   *
   * A lock is checked before any deadline, so granting them more time succeeds
   * and changes nothing. This is why extensions looked broken.
   */
  const lockedOut = learners.filter(l => l.locked);

  const give = (userIds: number[]) => {
    const iso = sessionDateTimeFromInput(when);
    if (!iso) { toast({ title: 'Pick a date and time first', variant: 'destructive' }); return; }
    if (sessionId === null || userIds.length === 0) return;
    grant.mutate({ id: sessionId, data: { userIds, dueAt: iso, reason, notify: true } });
  };

  const toggle = (userId: number) => {
    const next = new Set(chosen);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    setChosen(next);
  };

  return (
    <div ref={panelRef} className="scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between p-5 text-left"
      >
        <span>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-[#C2410C]" aria-hidden />Extensions
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Reopen a module's quiz, written task and critiques for a learner — or the whole cohort —
            after its deadline has passed.
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border p-5">
          <label className="block text-xs font-medium text-muted-foreground">
            Which module?
            <select
              className="mt-1 block w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={sessionId ?? ''}
              onChange={e => {
                setSessionId(e.target.value ? Number(e.target.value) : null);
                setChosen(new Set());
              }}
            >
              <option value="">Choose a module…</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>

          {sessionId === null ? null : isLoading ? (
            <div className="mt-4 h-32 animate-pulse rounded-lg bg-muted/40" />
          ) : !module?.hasCoursework ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Nothing on this module has a deadline, so there is nothing to extend — the work is already open.
            </p>
          ) : (
            <>
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                <p>
                  <span className="font-medium">The cohort's deadline:</span>{' '}
                  {describeModuleDeadline(module)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {notDone.length === 0
                    ? 'Everyone has finished this module.'
                    : `${notDone.length} of ${learners.length} have not finished this module.`}
                  {withExtra.length > 0 && ` ${withExtra.length} already have extra time.`}
                </p>
                {onlyMissingTheClass.length > 0 && (
                  <p className="mt-2 text-amber-800">
                    {onlyMissingTheClass.length === 1
                      ? 'One of them has handed in everything and is only short of the class itself.'
                      : `${onlyMissingTheClass.length} of them have handed in everything and are only short of the class itself.`}
                    {' '}Extra time will not change that — they need to watch the recording, which is open to
                    them already, locked module or not.
                  </p>
                )}
              </div>

              {lockedOut.length > 0 && (
                <div className="mt-4 flex gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">
                      Extra time will not reach {lockedOut.length === 1 ? '1 learner' : `${lockedOut.length} learners`} on
                      this module.
                    </p>
                    <p className="mt-0.5">
                      This module is still shut for them by an earlier one, and a lock is checked before any
                      deadline — so extra time is granted and nothing changes. Finish or credit the module
                      named against each of them below first.
                    </p>
                  </div>
                </div>
              )}

              {/*
                Attendance, above the date box, because it is the requirement a
                later deadline cannot move. For the weeks the Lab was not
                recording it is also the only thing standing between a cohort
                and every module after it.
              */}
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  <UserCheck className="h-4 w-4 text-[#C2410C]" aria-hidden />The class itself
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {needCredit.length === 0
                    ? 'Everyone has attended this class, live or on the replay.'
                    : `${needCredit.length} of ${learners.length} have neither attended nor watched it back.`}
                </p>

                {needCredit.length > 0 && (
                  <>
                    <label className="mt-3 block text-xs text-muted-foreground">
                      Why you are crediting it (goes on the record beside each name)
                      <input
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={creditReason}
                        onChange={e => setCreditReason(e.target.value)}
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={credit.isPending}
                        onClick={() => {
                          if (!confirm(
                            `Credit ${module.title} to the ${needCredit.length} who have no attendance for it? `
                            + 'This records that you judged them to have been there — it does not invent minutes '
                            + 'watched, and it does not complete the module on its own.',
                          )) return;
                          credit.mutate({ id: sessionId, data: { userIds: needCredit.map(l => l.userId), reason: creditReason } });
                        }}
                      >
                        <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Credit the class for the {needCredit.length} missing it
                      </Button>
                      {chosen.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={credit.isPending}
                          onClick={() => credit.mutate({
                            id: sessionId,
                            data: { userIds: [...chosen], reason: creditReason },
                          })}
                        >
                          Credit the {chosen.size} selected
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Anyone who attended, or watched the recording, is left untouched. Crediting records
                      that attendance could not be measured and that you judged them present — not a number
                      of minutes nobody observed.
                    </p>
                  </>
                )}
              </div>

              {/* The date first, because it is what every button below needs. */}
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  New date and time
                  <input
                    type="datetime-local"
                    className="mt-1 block rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                    value={when}
                    onChange={e => setWhen(e.target.value)}
                  />
                </label>
                <label className="min-w-[180px] flex-1 text-xs text-muted-foreground">
                  Why (staff only)
                  <input
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder="Power cuts across Lagos"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={grant.isPending || !when || chosen.size === 0}
                  onClick={() => give([...chosen])}
                >
                  {grant.isPending ? 'Saving…' : `Give ${chosen.size || 'the'} selected ${chosen.size === 1 ? 'learner' : 'learners'} extra time`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={grant.isPending || !when || learners.length === 0}
                  onClick={() => {
                    if (!confirm(`Give all ${learners.length} learners on this cohort extra time on ${module.title}? Each one is emailed.`)) return;
                    give(learners.map(l => l.userId));
                  }}
                >
                  <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden />Everyone ({learners.length})
                </Button>
                {notDone.length > 0 && notDone.length < learners.length && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={grant.isPending || !when}
                    onClick={() => {
                      if (!confirm(`Give extra time to the ${notDone.length} who have not finished this module? Each one is emailed.`)) return;
                      give(notDone.map(l => l.userId));
                    }}
                  >
                    Only those who have not finished it ({notDone.length})
                  </Button>
                )}
              </div>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 p-2">
                      <input
                        type="checkbox"
                        aria-label="Select everyone"
                        checked={chosen.size > 0 && chosen.size === learners.length}
                        onChange={e => setChosen(e.target.checked ? new Set(learners.map(l => l.userId)) : new Set())}
                      />
                    </th>
                    <th className="p-2">Learner</th>
                    {/* The class first. It is the requirement extra time cannot
                        move, so it is the one that decides whether extra time
                        is the right thing to give this person at all. */}
                    <th className="p-2">The class</th>
                    <th className="p-2">Quiz</th>
                    <th className="p-2">Written task</th>
                    {anyCritiques && <th className="p-2">Critiques</th>}
                    <th className="p-2">Extra time</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map(l => (
                    <tr key={l.userId} className="border-b border-border/60">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.name || l.email}`}
                          checked={chosen.has(l.userId)}
                          onChange={() => toggle(l.userId)}
                        />
                      </td>
                      <td className="p-2">
                        <p className="font-medium">{l.name || l.email}</p>
                        <p className="text-xs text-muted-foreground">{l.email}</p>
                        {l.lockedReason && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-rose-700">
                            <Lock className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
                            {l.lockedReason}
                          </p>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {l.attended ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-emerald-700">
                              {l.attendedVia === 'replay' ? 'On the replay'
                                : l.attendedVia === 'waived' ? 'Credited'
                                : 'In the class'}
                            </span>
                            {l.attendanceCredited && (
                              <button
                                type="button"
                                className="underline underline-offset-2 text-muted-foreground"
                                title={l.attendanceCreditReason ?? undefined}
                                disabled={uncredit.isPending}
                                onClick={() => {
                                  if (!confirm(takeBackWarning({
                                    learnerName: l.name || l.email,
                                    moduleTitle: module.title,
                                    hasOwnMeasurement: l.hasOwnMeasurement,
                                  }))) return;
                                  uncredit.mutate({ id: sessionId, data: { userIds: [l.userId] } });
                                }}
                              >
                                take back
                              </button>
                            )}
                          </span>
                        ) : (
                          // The percentage matters here in a way it does not
                          // elsewhere: somebody at 64% has watched most of the
                          // recording and needs a nudge, not a new deadline.
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-amber-800">
                              Not yet{l.attendedPct > 0 ? ` · ${l.attendedPct}%` : ''}
                            </span>
                            <button
                              type="button"
                              className="underline underline-offset-2 text-muted-foreground"
                              disabled={credit.isPending}
                              onClick={() => credit.mutate({
                                id: sessionId,
                                data: { userIds: [l.userId], reason: creditReason },
                              })}
                            >
                              credit
                            </button>
                          </span>
                        )}
                      </td>
                      {/* The app's own words everywhere else: a task is
                          Submitted, a quiz is Passed. "Filed" was invented here
                          and appears nowhere a learner ever sees. */}
                      <td className="p-2 text-xs">
                        {!l.hasQuiz ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={l.quizPassed ? 'text-emerald-700' : 'text-amber-800'}>
                            {l.quizPassed
                              ? 'Passed'
                              : l.quizBestScore != null ? `Best ${l.quizBestScore}%` : 'Not taken'}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {!l.hasAssignment ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={l.submitted ? 'text-emerald-700' : 'text-amber-800'}>
                            {l.submitted ? 'Submitted' : 'Not submitted'}
                          </span>
                        )}
                      </td>
                      {anyCritiques && (
                        <td className="p-2 text-xs">
                          {l.critiquesRequired === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={l.critiquesGiven >= l.critiquesRequired ? 'text-emerald-700' : 'text-amber-800'}>
                              {l.critiquesGiven} of {l.critiquesRequired}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="p-2 text-xs">
                        {l.extendedTo ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-emerald-700">
                              until {new Date(l.extendedTo as unknown as string).toLocaleString()}
                            </span>
                            <button
                              type="button"
                              className="underline underline-offset-2 text-muted-foreground"
                              disabled={revoke.isPending}
                              onClick={() => {
                                if (!confirm(`Take back ${l.name || l.email}'s extra time on ${module.title}? The cohort's own deadline applies to them again straight away.`)) return;
                                revoke.mutate({ id: sessionId, data: { userIds: [l.userId] } });
                              }}
                            >
                              take back
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p>
                  Extra time reopens everything on this module that is handed in — the quiz, the written
                  task, and the critiques that follow it — for the people chosen and nobody else. It costs
                  them no late passes, and it does not change the rules the module was set under.
                </p>
                <p>
                  It does not touch the recording, because the recording is never shut. Anyone on the
                  cohort can watch any class's replay at any time, including a class whose module is
                  locked — watching it in full is how somebody who missed the class earns their attendance.
                </p>
                <p>
                  It also cannot open a module that is locked. A lock decides whether a module is theirs
                  to open yet; a deadline decides when work is accepted. Anybody in that position is
                  marked above with what is blocking them.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A module's own deadlines, for the cohort, in one line. */
function describeModuleDeadline(m: {
  quizDueAt?: string | Date | null;
  assignmentDueAt?: string | Date | null;
  moduleClosed: boolean;
}): string {
  const dates = [m.quizDueAt, m.assignmentDueAt]
    .filter(Boolean)
    .map(d => new Date(d as unknown as string).toLocaleString());
  const unique = [...new Set(dates)];
  const when = unique.length === 0
    ? 'No deadline'
    : unique.length === 1
      ? `Cohort's deadline: ${unique[0]}`
      : `Quiz ${dates[0]} · Task ${dates[1]}`;
  return m.moduleClosed ? `${when} — shut` : when;
}


/* ------------------------------------------------------------------ *
 * Progress: how the cohort is actually doing
 * ------------------------------------------------------------------ */

/**
 * The six things a cell can say, and how each one looks.
 *
 * Colour alone never carries the meaning: every cell has a title and a label
 * under it in the key, and the grid can be read by someone who cannot tell
 * amber from emerald. That is not a nicety here — the two states that matter
 * most, "behind" and "on extra time", are the two an admin acts on.
 */
const CELL_LOOK: Record<CohortCell['state'], { chip: string; label: string; note: string }> = {
  complete: { chip: 'bg-emerald-500 text-white', label: 'Done', note: 'Attended, and the work is in.' },
  behind: { chip: 'bg-rose-500 text-white', label: 'Behind', note: 'The deadline has passed and the work is not in.' },
  extended: { chip: 'bg-sky-500 text-white', label: 'Extra time', note: 'Given longer by an admin, and still inside it.' },
  open: { chip: 'bg-muted text-muted-foreground', label: 'Not due', note: 'Still to come. Nothing is wrong.' },
  waived: { chip: 'bg-slate-300 text-slate-700', label: 'Before they joined', note: 'Ran before this learner was let in, so it was never theirs to do.' },
  notSet: { chip: 'border border-dashed border-border text-muted-foreground', label: 'Not set', note: 'No date and no work published yet.' },
};

const CELL_ORDER: CohortCell['state'][] = ['complete', 'behind', 'extended', 'open', 'waived', 'notSet'];

/** One proportional bar. Plain divs: four one-dimensional shares need no chart library. */
function StackedBar({ segments, total }: {
  segments: { value: number; className: string; label: string }[];
  total: number;
}) {
  if (total <= 0) return <div className="h-2.5 w-full rounded-full bg-muted" />;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      {segments.filter(s => s.value > 0).map(s => (
        <div
          key={s.label}
          className={s.className}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={`${s.label}: ${s.value} of ${total}`}
        />
      ))}
    </div>
  );
}

function Headline({ data }: { data: CohortProgress }) {
  const h = data.headline;
  const cards = [
    { n: h.learners, label: 'on the cohort', tone: 'text-foreground' },
    { n: h.behind, label: h.behind === 1 ? 'behind' : 'behind', tone: h.behind > 0 ? 'text-rose-600' : 'text-emerald-600' },
    { n: h.onExtraTime, label: 'on extra time', tone: 'text-sky-600' },
    { n: `${h.completionPct}%`, label: 'of what has been asked is in', tone: 'text-foreground' },
  ];
  return (
    <div>
      <p className="text-sm">{data.headlineText}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(c => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-3">
            <p className={`text-2xl font-semibold ${c.tone}`}>{c.n}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Learners down, modules across.
 *
 * The single most informative view of a cohort, and the reason this tab exists.
 * Forty-five rows by eight columns fits on one screen in a way that forty-five
 * separate dashboards never can, and the shape of the problem — a bad column is
 * a module that caught people out, a bad row is a person in trouble — is
 * visible before any number is read.
 */
function Grid({ data, onPick }: {
  data: CohortProgress;
  onPick: (sessionId: number, userId: number) => void;
}) {
  const modules = data.modules;
  return (
    <section>
      <h3 className="text-sm font-semibold">Everyone, module by module</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background p-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Learner
              </th>
              {modules.map((m, i) => (
                <th key={m.sessionId} className="p-2 text-center text-xs font-medium text-muted-foreground">
                  <span className="block" title={m.title}>{i + 1}</span>
                  {m.due && <span className="block text-[10px] font-normal text-muted-foreground/70">due</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.learners.map(row => (
              <tr key={row.userId}>
                <td className="sticky left-0 z-10 max-w-[200px] truncate bg-background p-2 text-xs">
                  <span className={row.behind > 0 ? 'font-medium text-rose-700' : ''}>
                    {row.name || row.email}
                  </span>
                </td>
                {modules.map(m => {
                  const cell = row.cells.find(c => c.sessionId === m.sessionId);
                  const look = CELL_LOOK[cell?.state ?? 'notSet'];
                  return (
                    <td key={m.sessionId} className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => onPick(m.sessionId, row.userId)}
                        title={`${row.name || row.email} — ${m.title}: ${look.label}${cell?.missing.length ? ` (${cell.missing.join(', ')})` : ''}`}
                        className={`h-6 w-8 rounded ${look.chip} text-[10px] leading-6`}
                      >
                        <span className="sr-only">{look.label}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {CELL_ORDER.map(state => (
          <li key={state} className="flex items-center gap-1.5" title={CELL_LOOK[state].note}>
            <span className={`h-3 w-4 rounded ${CELL_LOOK[state].chip}`} aria-hidden />
            {CELL_LOOK[state].label}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Columns are modules in the order they run — hover a square for the name and what is missing.
        Pressing one opens extra time for that module.
      </p>
    </section>
  );
}

/** Three charts per module, side by side, because they answer three questions. */
function ModuleCharts({ modules }: { modules: CohortModuleRollup[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">Each module, three ways</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Where the cohort stands, how they attended, and when the written work came in.
      </p>
      <div className="mt-3 space-y-4">
        {modules.map(m => (
          <div key={m.sessionId} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{m.title}</p>
              <p className="text-xs text-muted-foreground">
                {m.due ? 'Deadline passed' : m.dueAt ? 'Still open' : 'No deadline set'}
                {m.learners > 0 && ` · ${m.complete} of ${m.learners} done`}
              </p>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Standing</p>
                <div className="mt-1.5">
                  <StackedBar
                    total={m.learners}
                    segments={[
                      { value: m.complete, className: 'bg-emerald-500', label: 'Done' },
                      { value: m.onExtraTime, className: 'bg-sky-500', label: 'Extra time' },
                      { value: m.behind, className: 'bg-rose-500', label: 'Behind' },
                      { value: m.waived, className: 'bg-slate-300', label: 'Before they joined' },
                    ]}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {m.complete} done · {m.behind} behind · {m.onExtraTime} on extra time
                </p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Attendance</p>
                <div className="mt-1.5">
                  <StackedBar
                    total={m.learners}
                    segments={[
                      { value: m.viaLive, className: 'bg-emerald-500', label: 'In the class' },
                      { value: m.viaReplay, className: 'bg-teal-400', label: 'On the replay' },
                      { value: m.presenceWaived, className: 'bg-slate-300', label: 'Credited by staff' },
                      { value: m.notAttended, className: 'bg-rose-400', label: 'Neither' },
                    ]}
                  />
                </div>
                {/* The replay share is the number that changed how the Lab
                    thinks about attendance, so it is named rather than left
                    inside a colour. */}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {m.viaLive} live · {m.viaReplay} on the replay · {m.notAttended} neither
                </p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Written task</p>
                <div className="mt-1.5">
                  <StackedBar
                    total={m.learners}
                    segments={[
                      { value: m.filedBeforeDeadline, className: 'bg-emerald-500', label: 'Before the deadline' },
                      { value: m.filedAfterDeadline, className: 'bg-amber-400', label: 'After the deadline' },
                      { value: Math.max(0, m.learners - m.submitted), className: 'bg-muted-foreground/30', label: 'Not submitted' },
                    ]}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {m.hasAssignment
                    ? `${m.filedBeforeDeadline} on time · ${m.filedAfterDeadline} late · ${Math.max(0, m.learners - m.submitted)} not submitted`
                    : 'No written task on this module.'}
                </p>
              </div>
            </div>

            {m.critiquesAsked > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[11px] text-muted-foreground">
                  Peer critique: {m.critiquesGiven} of {m.critiquesAsked} written
                  {m.critiquesGiven < m.critiquesAsked && ' — the quietest requirement, and the one that most often holds a module open.'}
                </p>
                <div className="mt-1.5">
                  <StackedBar
                    total={m.critiquesAsked}
                    segments={[
                      { value: m.critiquesGiven, className: 'bg-violet-500', label: 'Written' },
                    ]}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The list an admin works down, in the order they should work down it. */
function NeedsAttention({ rows, onPick }: {
  rows: CohortLearnerRow[];
  onPick: (sessionId: number, userId: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-900">Nobody is overdue on anything.</p>
        <p className="mt-0.5 text-xs text-emerald-800">
          That counts people given extra time as fine, and does not count anybody for modules that ran
          before they joined.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h3 className="text-sm font-semibold">Who needs chasing, hardest first</h3>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map(row => {
          const firstLate = row.cells.find(c => c.state === 'behind');
          return (
            <li key={row.userId} className="flex flex-wrap items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.name || row.email}</p>
                <p className="text-xs text-muted-foreground">{row.email}</p>
                <p className="mt-1 text-xs text-rose-700">{row.why}</p>
              </div>
              {firstLate && (
                <Button size="sm" variant="outline" onClick={() => onPick(firstLate.sessionId, row.userId)}>
                  Give extra time
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The cohort tracker.
 *
 * Built after the extension controls rather than before them, which was the
 * wrong way round. The Lab could move a deadline before it could show anybody
 * who needed one moved — so an admin was acting on a situation the app was
 * unable to display. Extra time now lives at the bottom of the page that
 * explains why you would grant it.
 */
export default function ProgressTracker() {
  const { data: programmes = [], isLoading: loadingProgrammes } = useListPrograms({
    query: { queryKey: getListProgramsQueryKey() },
  });
  const [programId, setProgramId] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ sessionId: number; userId: number; at: number } | null>(null);

  // Whichever cohort is actually running. Opening on a draft programme from
  // last year would make the first thing an admin sees an empty grid.
  const chosen = useMemo(() => {
    if (programId !== null) return programId;
    const live = programmes.find(p => p.status === 'published') ?? programmes[0];
    return live?.id ?? null;
  }, [programId, programmes]);

  const { data, isLoading, isError, refetch } = useGetCohortProgress(chosen as number, {
    query: { queryKey: getGetCohortProgressQueryKey(chosen as number), enabled: chosen !== null },
  });

  if (loadingProgrammes) return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />;
  if (programmes.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no programmes yet.</p>;
  }

  return (
    <div className="space-y-8">
      <label className="block text-xs font-medium text-muted-foreground">
        Which programme?
        <select
          className="mt-1 block w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={chosen ?? ''}
          onChange={e => { setProgramId(Number(e.target.value)); setFocus(null); }}
        >
          {programmes.map(p => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </label>

      {isError ? (
        <CouldNotLoad what="this cohort's progress" onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="h-96 animate-pulse rounded-lg bg-muted/40" />
      ) : data.headline.learners === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is enrolled on this programme yet, so there is nothing to track.
        </p>
      ) : (
        <>
          <Headline data={data} />

          {data.undatedModulesThatHaveRun.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden />
              <div className="text-xs text-amber-900">
                <p className="font-medium">
                  {data.undatedModulesThatHaveRun.length === 1 ? 'One module has' : `${data.undatedModulesThatHaveRun.length} modules have`}
                  {' '}run with no deadline set.
                </p>
                <p className="mt-0.5">
                  {data.undatedModulesThatHaveRun.map(m => m.title).join(', ')} — nobody can ever be counted
                  behind on {data.undatedModulesThatHaveRun.length === 1 ? 'it' : 'them'}, so
                  {data.undatedModulesThatHaveRun.length === 1 ? ' its column' : ' those columns'} will read
                  clean whatever happens. Set a deadline on the module to start measuring it.
                </p>
              </div>
            </div>
          )}

          <NeedsAttention
            rows={data.needsAttention}
            onPick={(sessionId, userId) => setFocus({ sessionId, userId, at: Date.now() })}
          />

          <Grid
            data={data}
            onPick={(sessionId, userId) => setFocus({ sessionId, userId, at: Date.now() })}
          />

          <ModuleCharts modules={data.modules} />

          <div className="rounded-lg border border-border bg-card">
            <Extensions programId={chosen as number} focus={focus} />
          </div>
        </>
      )}
    </div>
  );
}
