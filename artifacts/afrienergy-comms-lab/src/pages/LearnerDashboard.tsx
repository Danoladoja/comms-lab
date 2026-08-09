import { Link, useLocation } from 'wouter';
import { useListMyEnrollments, useListMySessions } from '@workspace/api-client-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Calendar, Video, PlayCircle, GraduationCap, CheckCircle2, Circle,
  Radio, MessageSquare, ClipboardList, FileQuestion, ArrowRight, Clock,
} from 'lucide-react';

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

// Preview content until quizzes, discussions, and assignments go live.
const previewQuizzes = [
  { id: 1, title: 'Framing Energy Stories: Module 1 Check', questions: 5, duration: '10 min', status: 'Ready' },
  { id: 2, title: 'Audience Mapping Essentials', questions: 8, duration: '15 min', status: 'Ready' },
  { id: 3, title: 'Policy Briefing Structures', questions: 6, duration: '12 min', status: 'Locked until Module 3' },
];
const previewThreads = [
  { title: 'How do you explain tariffs to a general audience?', author: 'Zanele M.', replies: 12, last: '2h ago' },
  { title: 'Share your one-line energy story from Module 1', author: 'Ngozi E. (Facilitator)', replies: 23, last: '5h ago', pinned: true },
  { title: 'Examples of great transition storytelling from Senegal', author: 'Fatima D.', replies: 7, last: '1d ago' },
];
const previewAssignments = [
  { title: 'Draft a 200-word narrative brief for a minister', due: 'Due in 3 days', status: 'In progress' },
  { title: 'Rewrite a technical press release for radio', due: 'Due in 8 days', status: 'Not started' },
  { title: 'Peer review: two story spines from your cohort', due: 'Opens after Module 3', status: 'Locked' },
];

import type { SessionDetail } from '@workspace/api-client-react';
type SessionRow = SessionDetail;

function moduleState(s: { startsAt?: unknown; durationMins: number }, now: number) {
  const start = s.startsAt ? new Date(s.startsAt as string).getTime() : null;
  if (start === null) return 'upcoming';
  const end = start + s.durationMins * 60 * 1000;
  if (now >= start - 15 * 60 * 1000 && now <= end) return 'live';
  return now > end ? 'done' : 'upcoming';
}

export default function LearnerDashboard() {
  const { user } = useCurrentUser();
  const [, setLocation] = useLocation();
  const { data: enrollments = [], isLoading: loadingEnrollments } = useListMyEnrollments();
  const { data: sessions = [] } = useListMySessions();

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
    const state = moduleState(s, now);
    if (state === 'done' && s.recordingUrl) {
      window.open(s.recordingUrl, '_blank', 'noreferrer');
    } else if (state === 'live' && s.meetUrl) {
      window.open(s.meetUrl, '_blank', 'noreferrer');
    } else {
      setLocation('/classroom-preview');
    }
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
                  const doneCount = mods.filter(m => moduleState(m, now) === 'done').length;
                  const pct = mods.length ? Math.round((doneCount / mods.length) * 100) : 0;
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
                      <div className="flex items-center gap-3 mb-5">
                        <Progress value={pct} className="h-2 flex-1" />
                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                          {doneCount}/{mods.length} modules · {pct}%
                        </span>
                      </div>

                      {mods.length === 0 ? (
                        <p className="text-sm text-muted-foreground">The module schedule will be published soon.</p>
                      ) : (
                        <ol className="space-y-2">
                          {mods.map((m, i) => {
                            const state = moduleState(m, now);
                            return (
                              <li key={m.id}>
                                <button
                                  onClick={() => openModule(m)}
                                  className="w-full text-left flex items-center gap-3 rounded-xl border border-border px-4 py-3 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                                >
                                  {state === 'done'
                                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                                    : state === 'live'
                                      ? <Radio className="w-5 h-5 text-[#C2410C] flex-shrink-0 animate-pulse" />
                                      : <Circle className="w-5 h-5 text-muted-foreground/40 flex-shrink-0" />}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">Module {i + 1}: {m.title}</p>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      <Clock className="w-3 h-3" />
                                      {formatSessionDate(m.startsAt as unknown as string)} · {m.durationMins} min
                                    </p>
                                  </div>
                                  <span className="text-xs font-semibold flex items-center gap-1.5 flex-shrink-0 text-primary">
                                    {state === 'done'
                                      ? (m.recordingUrl ? <><PlayCircle className="w-4 h-4" />Recording</> : 'Completed')
                                      : state === 'live'
                                        ? <><Video className="w-4 h-4" />Join live</>
                                        : <>Open classroom<ArrowRight className="w-3.5 h-3.5" /></>}
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

              {/* QUIZZES (preview) */}
              <TabsContent value="quizzes">
                <PreviewNote label="Quizzes" />
                <div className="space-y-3">
                  {previewQuizzes.map(q => (
                    <div key={q.id} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{q.title}</h3>
                        <p className="text-xs text-muted-foreground">{q.questions} questions · {q.duration}</p>
                      </div>
                      {q.status === 'Ready' ? (
                        <Button asChild size="sm"><Link href={`/quiz/${q.id}`}>Start Quiz</Link></Button>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">{q.status}</span>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* DISCUSSIONS (preview) */}
              <TabsContent value="discussions">
                <PreviewNote label="Forum discussions" />
                <div className="space-y-3">
                  {previewThreads.map((t, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold">
                            {t.pinned && <span className="text-[#C2410C] text-xs font-bold uppercase tracking-wider mr-2">Pinned</span>}
                            {t.title}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">Started by {t.author} · last reply {t.last}</p>
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1 flex-shrink-0">
                          <MessageSquare className="w-3.5 h-3.5" />{t.replies}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* ASSIGNMENTS (preview) */}
              <TabsContent value="assignments">
                <PreviewNote label="Assignments" />
                <div className="space-y-3">
                  {previewAssignments.map((a, i) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold">{a.title}</h3>
                        <p className="text-xs text-muted-foreground">{a.due}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        a.status === 'In progress' ? 'bg-primary/10 text-primary'
                        : a.status === 'Locked' ? 'bg-muted text-muted-foreground'
                        : 'bg-amber-100 text-amber-800'
                      }`}>{a.status}</span>
                    </div>
                  ))}
                </div>
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
                  {s.meetUrl ? (
                    <Button asChild size="sm" className="w-full font-bold">
                      <a href={s.meetUrl} target="_blank" rel="noreferrer"><Video className="w-4 h-4 mr-1.5" />Join Session</a>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href="/classroom-preview"><Video className="w-4 h-4 mr-1.5" />Open Classroom</Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PreviewNote({ label }: { label: string }) {
  return (
    <p className="text-xs text-muted-foreground bg-[#F4F0E8] border border-border rounded-lg px-3 py-2 mb-4">
      {label} are shown as a preview with sample content. They will go live with your real course material.
    </p>
  );
}
