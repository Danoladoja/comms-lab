import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMyEnrollments, useListMySessions, useListMyProgress, useJoinSession,
  getListMyProgressQueryKey, getListMySessionsQueryKey,
} from '@workspace/api-client-react';
import { liveWindow } from '@workspace/domain';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Calendar, Video, PlayCircle, GraduationCap, CheckCircle2, Circle, Lock,
  Radio, MessageSquare, ClipboardList, FileQuestion, ArrowRight, Clock,
} from 'lucide-react';
import { useState } from 'react';
import { QuizDialog, AssignmentDialog } from '@/components/CourseworkDialogs';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });
}

const statusLabel: Record<string, string> = {
  enrolled: 'Enrolled', waitlisted: 'Waitlisted', completed: 'Completed', cancelled: 'Cancelled',
};
const statusClass: Record<string, string> = {
  enrolled: 'bg-primary/10 text-primary',
  waitlisted: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-muted text-muted-foreground',
};

import type { SessionDetail } from '@workspace/api-client-react';
import { ProgramForum } from '@/components/CohortForum';
type SessionRow = SessionDetail;

/**
 * Read the join window from @workspace/domain — the same function the API uses.
 * The dashboard used to hard-code 15 minutes while the server accepted joins
 * from 5, so the button failed for ten minutes before every class.
 */
function moduleState(s: { startsAt?: unknown; durationMins: number }, now: number) {
  const win = liveWindow({ startsAt: s.startsAt as string | null, durationMins: s.durationMins }, now);
  if (win.state === 'unscheduled') return 'upcoming';
  if (win.canJoin) return 'live';
  return win.state === 'ended' ? 'done' : 'upcoming';
}

export default function LearnerDashboard() {
  const { user } = useCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: enrollments = [], isLoading: loadingEnrollments } = useListMyEnrollments();
  const { data: sessions = [] } = useListMySessions();
  const { data: progress = [] } = useListMyProgress();
  const progressBySession = new Map(progress.map(p => [p.sessionId, p]));

  const joinSession = useJoinSession({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
        if (result.joinUrl) {
          window.open(result.joinUrl, '_blank', 'noreferrer');
          toast({
            title: 'Keep the classroom open',
            description: 'Your time in class is counted from the classroom tab while the session runs.',
          });
        } else {
          toast({
            title: 'You are checked in',
            description: 'The video link has not been added yet. Your facilitator will share it shortly.',
          });
        }
      },
      onError: () => {
        toast({
          title: 'Cannot join yet',
          description: 'Either the room is not open, or the previous module is unfinished.',
          variant: 'destructive',
        });
      },
    },
  });

  const [quizFor, setQuizFor] = useState<SessionRow | null>(null);
  const [assignmentFor, setAssignmentFor] = useState<SessionRow | null>(null);

  const now = Date.now();
  const active = enrollments.filter(e => e.status !== 'cancelled');
  const sessionsByProgram = new Map<number, SessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByProgram.get(s.programId) ?? [];
    list.push(s as SessionRow);
    sessionsByProgram.set(s.programId, list);
  }

  const upcoming = sessions
    .filter(s => s.startsAt && new Date(s.startsAt as unknown as string).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => new Date(a.startsAt as unknown as string).getTime() - new Date(b.startsAt as unknown as string).getTime())
    .slice(0, 3);

  const firstName = (user?.name || '').split(' ')[0];

  const openModule = (s: SessionRow) => {
    const entry = progressBySession.get(s.id);
    if (entry?.locked) {
      toast({
        title: 'Module locked',
        description: 'Complete the previous module to unlock this one.',
        variant: 'destructive',
      });
      return;
    }
    // The classroom houses the video, quiz, and assignment for the module.
    setLocation(`/classroom/${s.id}`);
  };

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
          {firstName ? `Welcome, ${firstName}` : 'My Learning'}
        </h1>
        <p className="text-muted-foreground">Track your progress, join classes, and keep up with your cohort.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          {loadingEnrollments ? (
            <div className="h-40 bg-card border border-border rounded-2xl animate-pulse" />
          ) : active.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-10 text-center">
              <GraduationCap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold mb-1">No programs yet</h3>
              <p className="text-sm text-muted-foreground mb-5">Reserve a place on a program to get started.</p>
              <Button asChild><Link href="/courses">Browse Programs</Link></Button>
            </div>
          ) : (
            <Tabs defaultValue="modules">
              <TabsList className="mb-6 flex-wrap h-auto">
                <TabsTrigger value="modules"><Video className="w-4 h-4 mr-1.5" />Modules</TabsTrigger>
                <TabsTrigger value="quizzes"><FileQuestion className="w-4 h-4 mr-1.5" />Quizzes</TabsTrigger>
                <TabsTrigger value="discussions"><MessageSquare className="w-4 h-4 mr-1.5" />Discussions</TabsTrigger>
                <TabsTrigger value="assignments"><ClipboardList className="w-4 h-4 mr-1.5" />Assignments</TabsTrigger>
              </TabsList>

              {/* MODULES + PROGRESS */}
              <TabsContent value="modules" className="space-y-8">
                {active.map(e => {
                  const mods = (sessionsByProgram.get(e.programId) ?? [])
                    .sort((a, b) => new Date(a.startsAt as unknown as string || 0).getTime() - new Date(b.startsAt as unknown as string || 0).getTime());
                  const doneCount = mods.filter(m => progressBySession.get(m.id)?.completed).length;
                  return (
                    <section key={e.id} className="bg-card border border-border rounded-2xl p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                        <h2 className="font-display font-bold text-lg">{e.programTitle}</h2>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass[e.status] ?? 'bg-muted'}`}>
                          {statusLabel[e.status] ?? e.status}
                        </span>
                      </div>
                      {e.programStartDate && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-4">
                          <Calendar className="w-3.5 h-3.5" />Starts {e.programStartDate}
                        </p>
                      )}
                      <p className="text-xs font-semibold text-muted-foreground mb-4">
                        {doneCount} of {mods.length} modules completed
                      </p>

                      {mods.length === 0 ? (
                        <p className="text-sm text-muted-foreground">The module schedule will be published soon.</p>
                      ) : (
                        <ol className="space-y-2">
                          {mods.map((m) => {
                            const state = moduleState(m, now);
                            const entry = progressBySession.get(m.id);
                            const locked = entry?.locked ?? false;
                            const pct = entry?.completed ? 100 : entry?.progressPct ?? 0;
                            const owed = Math.max(0, (entry?.reviewsRequired ?? 0) - (entry?.reviewsGiven ?? 0));
                            // The class itself is outstanding once it has ended and
                            // the presence bar has not been reached by either route.
                            const needsClass = state === 'done' && entry?.presence?.met === false;
                            return (
                              <li key={m.id} className={`rounded-xl border border-border transition-colors ${
                                locked ? 'opacity-55 bg-muted/30' : 'hover:border-primary/40'
                              }`}>
                                <button
                                  onClick={() => openModule(m)}
                                  disabled={locked}
                                  className={`w-full text-left flex items-center gap-3 px-4 py-3 ${locked ? 'cursor-not-allowed' : ''}`}
                                >
                                  {locked
                                    ? <Lock className="w-5 h-5 text-muted-foreground/60 flex-shrink-0" />
                                    : entry?.completed
                                      ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                                      : state === 'live'
                                        ? <Radio className="w-5 h-5 text-[#C2410C] flex-shrink-0 animate-pulse" />
                                        : <Circle className="w-5 h-5 text-muted-foreground/40 flex-shrink-0" />}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{m.title}</p>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1.5">
                                      <Clock className="w-3 h-3" />
                                      {formatSessionDate(m.startsAt as unknown as string)} · {m.durationMins} min
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <Progress value={pct} className="h-1.5 flex-1 max-w-[220px]" />
                                      <span className="text-[11px] font-semibold text-muted-foreground">{pct}%</span>
                                    </div>
                                  </div>
                                  <span className="text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 text-primary">
                                    {locked
                                      ? <span className="text-muted-foreground">Locked</span>
                                      : state === 'live'
                                        ? <><Video className="w-4 h-4" aria-hidden />Join live</>
                                        : entry?.completed
                                          ? 'Completed'
                                          : needsClass
                                            ? <><PlayCircle className="w-4 h-4" aria-hidden />Watch the class</>
                                            : owed > 0
                                              ? <>{owed} critique{owed === 1 ? '' : 's'} to write<ArrowRight className="w-3.5 h-3.5" aria-hidden /></>
                                              : <>Open classroom<ArrowRight className="w-3.5 h-3.5" aria-hidden /></>}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </section>
                  );
                })}
              </TabsContent>

              {/* QUIZZES */}
              <TabsContent value="quizzes">
                <CourseworkList
                  kind="quiz"
                  sessions={sessions as SessionRow[]}
                  progressBySession={progressBySession}
                  onOpen={setQuizFor}
                />
              </TabsContent>

              {/* DISCUSSIONS: the cohort forum */}
              <TabsContent value="discussions" className="space-y-6">
                {active.map(e => (
                  <ProgramForum key={e.programId} programId={e.programId} programTitle={e.programTitle} />
                ))}
              </TabsContent>

              {/* ASSIGNMENTS */}
              <TabsContent value="assignments">
                <CourseworkList
                  kind="assignment"
                  sessions={sessions as SessionRow[]}
                  progressBySession={progressBySession}
                  onOpen={setAssignmentFor}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* Upcoming sessions */}
        <aside>
          <h2 className="text-xl font-display font-bold mb-4">Upcoming Sessions</h2>
          {upcoming.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
              No upcoming sessions yet. When your program schedule is live, sessions appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.map(s => (
                <div key={s.id} className="bg-card border border-border rounded-xl p-5">
                  <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-1">{s.programTitle}</p>
                  <h3 className="font-semibold mb-1">{s.title}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {formatSessionDate(s.startsAt as unknown as string)} · {s.durationMins} min
                  </p>
                  {moduleState(s, now) === 'live' ? (
                    <Button
                      size="sm"
                      className="w-full font-bold"
                      disabled={joinSession.isPending}
                      onClick={() => joinSession.mutate({ id: s.id })}
                    >
                      <Video className="w-4 h-4 mr-1.5" />Join Session
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href={`/classroom/${s.id}`}><Video className="w-4 h-4 mr-1.5" />Open Classroom</Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {quizFor && (
        <QuizDialog
          sessionId={quizFor.id}
          moduleTitle={quizFor.title}
          open={!!quizFor}
          onOpenChange={(v) => { if (!v) setQuizFor(null); }}
        />
      )}
      {assignmentFor && (
        <AssignmentDialog
          sessionId={assignmentFor.id}
          moduleTitle={assignmentFor.title}
          open={!!assignmentFor}
          onOpenChange={(v) => { if (!v) setAssignmentFor(null); }}
        />
      )}
    </div>
  );
}

type ProgressEntryRow = import('@workspace/api-client-react').SessionProgress;

function CourseworkList({ kind, sessions, progressBySession, onOpen }: {
  kind: 'quiz' | 'assignment';
  sessions: SessionRow[];
  progressBySession: Map<number, ProgressEntryRow>;
  onOpen: (s: SessionRow) => void;
}) {
  const items = sessions.filter(s => {
    const e = progressBySession.get(s.id);
    return kind === 'quiz' ? e?.hasQuiz : e?.hasAssignment;
  });
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-6">
        {kind === 'quiz' ? 'No quizzes have been published for your modules yet.' : 'No assignments have been published for your modules yet.'}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground bg-[#F4F0E8] border border-border rounded-lg px-3 py-2">
        {kind === 'quiz'
          ? 'Each module has a short quiz. Score 70% or more to pass — you can retake it as many times as you need.'
          : 'Each module ends in a make. File it, then critique two peers — that pair is what completes the module.'}
      </p>
      {items.map(s => {
        const e = progressBySession.get(s.id)!;
        const done = kind === 'quiz' ? e.quizPassed : e.assignmentSubmitted;
        return (
          <div key={s.id} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-0.5">{s.programTitle}</p>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="text-xs text-muted-foreground">
                {done
                  ? kind === 'quiz' ? `Passed with ${e.quizBestScore}%` : 'Submitted'
                  : e.locked
                    ? 'Unlocks after the previous module'
                    : kind === 'quiz' && e.quizBestScore != null
                      ? `Best score so far ${e.quizBestScore}% — 70% needed`
                      : 'Not started'}
              </p>
            </div>
            {done ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />{kind === 'quiz' ? 'Passed' : 'Submitted'}
              </span>
            ) : e.locked ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" />Locked
              </span>
            ) : (
              <Button size="sm" onClick={() => onOpen(s)}>
                {kind === 'quiz'
                  ? e.quizBestScore != null ? 'Retake Quiz' : 'Start Quiz'
                  : 'Open Assignment'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
