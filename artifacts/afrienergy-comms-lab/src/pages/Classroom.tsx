import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMySessions, useListMyProgress, useJoinSession, useGetSessionSlides, useGetSessionReadings,
  getListMyProgressQueryKey, getListMySessionsQueryKey, getGetSessionSlidesQueryKey,
  getGetSessionReadingsQueryKey,
} from '@workspace/api-client-react';
import { liveWindow } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useLiveHeartbeat } from '@/hooks/useLiveHeartbeat';
import { QuizPanel, AssignmentPanel } from '@/components/CourseworkDialogs';
import { CritiqueQueue, MyFeedbackPanel } from '@/components/CritiquePanel';
import { CohortDiscussion } from '@/components/CohortDiscussion';
import TrackedReplay from '@/components/TrackedReplay';
import { ReadingListView } from '@/components/ReadingListEditor';
import { openJoinLink } from '@/lib/openJoinLink';
import { CouldNotLoad } from '@/components/CouldNotLoad';
import {
  ArrowLeft, Video, PlayCircle, CheckCircle2, Lock, Radio, Clock,
  FileQuestion, ClipboardList, CalendarClock, MessagesSquare, FileText, BookOpen,
  MonitorPlay, Users,
} from 'lucide-react';

type Tab = '' | 'assignment' | 'critique' | 'feedback' | 'discussion' | 'quiz' | 'reading';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function minutesFrom(ms: number) {
  return Math.max(1, Math.round(ms / 60000));
}

export default function Classroom() {
  const params = useParams<{ id: string }>();
  const sessionId = Number(params.id);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('');
  const { data: sessions = [], isLoading: loadingSessions, isError: sessionsFailed, refetch: retrySessions } =
    useListMySessions();
  const { data: progress = [] } = useListMyProgress();
  const session = sessions.find(s => s.id === sessionId);
  const entry = progress.find(p => p.sessionId === sessionId);

  // Counts time in the room while the class is running.
  useLiveHeartbeat(session);

  // The facilitator's deck, when they have shared it. Useful for revision, and
  // for anyone who would rather read than stream an hour of video.
  const { data: slides } = useGetSessionSlides(sessionId, {
    query: { queryKey: getGetSessionSlidesQueryKey(sessionId), retry: false },
  });

  // Further reading. Ungraded, so it sits outside the completion checklist.
  const { data: readings = [] } = useGetSessionReadings(sessionId, {
    query: { queryKey: getGetSessionReadingsQueryKey(sessionId), retry: false },
  });

  const joinSession = useJoinSession({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
        if (result.joinUrl) {
          openJoinLink(result.joinUrl);
          toast({
            title: 'Keep this tab open',
            description: 'Your time in class is counted from here while the session runs.',
          });
        } else {
          toast({
            title: 'You are checked in',
            description: 'The video link has not been added yet. Your facilitator will share it shortly.',
          });
        }
      },
      onError: () => toast({
        title: 'Cannot join yet',
        description: 'This module is not open for joining right now.',
        variant: 'destructive',
      }),
    },
  });

  if (loadingSessions) {
    return <div className="container mx-auto px-4 py-12"><div className="h-72 bg-card border border-border rounded-2xl animate-pulse" /></div>;
  }

  // "Not part of your enrolled programmes" is a strong claim to make on the
  // strength of a request that may simply not have arrived.
  if (sessionsFailed) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <CouldNotLoad what="this classroom" onRetry={() => void retrySessions()} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-display font-bold mb-2">Classroom not found</h1>
        <p className="text-muted-foreground mb-6">This module is not part of your enrolled programs.</p>
        <Button asChild><Link href="/dashboard">Back to dashboard</Link></Button>
      </div>
    );
  }

  // Both the button and the server read the same window, so the UI can never
  // offer a join the API will refuse.
  const win = liveWindow({
    startsAt: session.startsAt as unknown as string | null,
    durationMins: session.durationMins,
  });
  const locked = entry?.locked ?? false;
  const presence = entry?.presence;
  const hasReplay = win.state === 'ended' && !!session.recordingUrl;
  const owedCritiques = Math.max(0, (entry?.reviewsRequired ?? 0) - (entry?.reviewsGiven ?? 0));
  // The coursework is genuinely shut while the module is locked, so none of its
  // panels open — the recording above is the only thing a locked module offers,
  // and it is the thing that unlocks the rest.
  const activeTab = locked ? '' : tab;

  return (
    <div className="container mx-auto px-4 md:px-6 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded mb-5">
        <ArrowLeft className="w-4 h-4" aria-hidden />Back to dashboard
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-display font-bold">{session.title}</h1>
          {win.state === 'live' && (
            <span className="flex items-center gap-1.5 bg-[#C2410C] text-white text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />Live
            </span>
          )}
          {entry?.completed && (
            <span className="flex items-center gap-1 bg-emerald-100 text-emerald-900 text-xs font-semibold px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />Completed
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1.5">
          <Clock className="w-4 h-4" aria-hidden />
          {formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min
        </p>
      </div>

      {/*
        A locked module used to replace this whole page with a padlock — the
        recording included. That gated the ladder on already being out of the
        hole: watching the replay in full IS how somebody who missed a class
        earns their attendance, and attendance is one of the things standing
        between them and the module that is locked. The server never blocked it
        (see the note on the replay route); only this screen did.

        So the padlock becomes a notice, and the recording stays on the page.
        The coursework really is shut, and stays shut.
      */}
      {locked && (
        <div className="mb-6 flex max-w-3xl gap-3 rounded-2xl border border-border bg-card p-5">
          <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-sm font-bold">The coursework on this module is locked</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {entry?.lockedReason ?? 'Finish the module before this one to open it.'}
            </p>
            {hasReplay && (
              <p className="mt-2 text-sm">
                The recording is not locked. Watching it all the way through counts as attending this
                class, and attending is one of the things that opens what comes next.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Video stage */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl overflow-hidden border border-border bg-[#07111E] text-[#F4F0E8]">
              {hasReplay ? (
                <TrackedReplay
                  sessionId={session.id}
                  recordingUrl={session.recordingUrl!}
                  title={`${session.title} recording`}
                />
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center text-center px-6">
                  {/* Joining stays open on a locked module, deliberately: the server
                      allows it for the same reason the replay is open. A lock
                      governs the coursework, and gating attendance on it closes
                      a circle nobody can climb out of — miss one measurement,
                      the next module locks, and you can then neither attend it
                      nor watch it back. Banking attendance moves nobody past
                      anything. */}
                  {win.canJoin ? (
                    <>
                      <Radio className="w-12 h-12 text-[#F97316] mb-4 animate-pulse" aria-hidden />
                      <h2 className="font-display font-bold text-xl mb-1">
                        {win.state === 'open' ? 'The room is open' : 'Class is in session'}
                      </h2>
                      <p className="text-sm text-[#F4F0E8]/80 mb-6 max-w-md">
                        Joining opens the video room. Keep this tab open — your time in class is counted here.
                      </p>
                      <Button
                        size="lg"
                        className="font-bold"
                        disabled={joinSession.isPending}
                        onClick={() => joinSession.mutate({ id: session.id })}
                      >
                        <Video className="w-5 h-5 mr-2" aria-hidden />
                        {joinSession.isPending ? 'Opening...' : 'Join live class'}
                      </Button>
                    </>
                  ) : win.state === 'ended' ? (
                    <>
                      <PlayCircle className="w-12 h-12 text-[#F4F0E8]/50 mb-4" aria-hidden />
                      <h2 className="font-display font-bold text-xl mb-1">Recording coming soon</h2>
                      <p className="text-sm text-[#F4F0E8]/80 max-w-md">
                        This class has ended. The recording appears here once your facilitator uploads it.
                      </p>
                    </>
                  ) : (
                    <>
                      <CalendarClock className="w-12 h-12 text-[#F97316] mb-4" aria-hidden />
                      <h2 className="font-display font-bold text-xl mb-1">
                        {win.state === 'unscheduled' ? 'Not scheduled yet' : 'Starts soon'}
                      </h2>
                      <p className="text-sm text-[#F4F0E8]/80 max-w-md">
                        {win.state === 'unscheduled'
                          ? 'The date will be announced. Check back here to join live.'
                          : `The room opens ${minutesFrom(win.msUntilOpen)} min from now, ahead of ${formatSessionDate(session.startsAt as unknown as string)}.`}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            {slides && (
              <a
                href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${slides.downloadPath}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              >
                <FileText className="w-5 h-5 text-primary flex-shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Class slides</span>
                  <span className="block text-xs text-muted-foreground truncate">{slides.filename}</span>
                </span>
              </a>
            )}
            <section className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-display font-bold mb-3 text-sm uppercase tracking-wider text-muted-foreground">
                To complete this module
              </h2>

              {win.state !== 'unscheduled' && presence && (
                <div className="mb-4 pb-4 border-b border-border">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Video className="w-4 h-4" aria-hidden />The class
                    </span>
                    {presence.met
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Done</span>
                      : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{presence.bestPct}%</span>}
                  </div>
                  <Progress value={presence.bestPct} className="h-1.5 mb-1.5" />
                  <p className="text-xs text-muted-foreground">
                    {presence.met
                      ? presence.via === 'live'
                        ? 'Attended live.'
                        : 'Watched the recording.'
                      : `${presence.thresholdPct}% of the class needed. Attend live or watch the recording.`}
                  </p>
                </div>
              )}

              <ul className="space-y-2.5 text-sm">
                {entry?.hasAssignment !== false && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground"><ClipboardList className="w-4 h-4" aria-hidden />File the make</span>
                    {entry?.assignmentSubmitted
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Submitted</span>
                      : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not submitted</span>}
                  </li>
                )}
                {(entry?.reviewsRequired ?? 0) > 0 && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground"><MessagesSquare className="w-4 h-4" aria-hidden />Critique peers</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      owedCritiques === 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'
                    }`}>
                      {entry?.reviewsGiven ?? 0} of {entry?.reviewsRequired}
                    </span>
                  </li>
                )}
                {entry?.hasQuiz !== false && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground"><FileQuestion className="w-4 h-4" aria-hidden />Pass the quiz</span>
                    {entry?.quizPassed
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Passed · {entry.quizBestScore}%</span>
                      : entry?.quizBestScore != null
                        ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Best · {entry.quizBestScore}%</span>
                        : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not taken</span>}
                  </li>
                )}
              </ul>
            </section>

            {!locked && (
          <nav className="grid grid-cols-2 gap-2" aria-label="Module coursework">
              <Button
                variant={activeTab === 'assignment' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'assignment' ? '' : 'assignment'))}
                aria-pressed={activeTab === 'assignment'}
              >
                <ClipboardList className="w-4 h-4 mr-1.5" aria-hidden />The make
                {entry?.assignmentSubmitted && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
              <Button
                variant={activeTab === 'critique' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'critique' ? '' : 'critique'))}
                aria-pressed={activeTab === 'critique'}
              >
                <MessagesSquare className="w-4 h-4 mr-1.5" aria-hidden />Critique
                {owedCritiques > 0
                  ? <span className="ml-1.5 text-xs font-bold">{owedCritiques}</span>
                  : (entry?.reviewsRequired ?? 0) > 0 && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
              <Button
                variant={activeTab === 'feedback' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'feedback' ? '' : 'feedback'))}
                aria-pressed={activeTab === 'feedback'}
              >
                <MessagesSquare className="w-4 h-4 mr-1.5" aria-hidden />My feedback
                {(entry?.reviewsReceived ?? 0) > 0 && entry?.feedbackUnlocked && (
                  <span className="ml-1.5 text-xs font-bold">{entry.reviewsReceived}</span>
                )}
              </Button>
              <Button
                variant={activeTab === 'discussion' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'discussion' ? '' : 'discussion'))}
                aria-pressed={activeTab === 'discussion'}
              >
                <Users className="w-4 h-4 mr-1.5" aria-hidden />Cohort room
              </Button>
              <Button
                variant={activeTab === 'quiz' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'quiz' ? '' : 'quiz'))}
                aria-pressed={activeTab === 'quiz'}
              >
                <FileQuestion className="w-4 h-4 mr-1.5" aria-hidden />Quiz
                {entry?.quizPassed && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
              <Button
                variant={activeTab === 'reading' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'reading' ? '' : 'reading'))}
                aria-pressed={activeTab === 'reading'}
              >
                <BookOpen className="w-4 h-4 mr-1.5" aria-hidden />Reading list
                {readings.length > 0 && <span className="ml-1.5 text-xs font-bold">{readings.length}</span>}
              </Button>
            </nav>
          )}
          </aside>

          {activeTab === 'assignment' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="font-display font-bold">The make</h2>
                {entry?.assignmentSubmitted && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Submitted</span>
                )}
              </div>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <AssignmentPanel sessionId={session.id} onSubmitted={() => setTab('critique')} />}
            </section>
          )}

          {activeTab === 'critique' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="mb-4">
                <h2 className="font-display font-bold">Critique your cohort</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  You learn structure fastest by editing someone else's. Blind both ways — you do not see the author,
                  they do not see you.
                </p>
              </div>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <CritiqueQueue sessionId={session.id} />}
            </section>
          )}

          {activeTab === 'feedback' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <h2 className="font-display font-bold mb-4">What your peers said</h2>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <MyFeedbackPanel sessionId={session.id} />}
            </section>
          )}

          {activeTab === 'discussion' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="mb-4">
                <h2 className="font-display font-bold">The cohort room</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Once you have filed your piece and written the critiques you owe, everyone's work opens up. The
                  most useful hour in any workshop is the one where everybody reads everybody.
                </p>
              </div>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <CohortDiscussion sessionId={session.id} />}
            </section>
          )}

          {activeTab === 'reading' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="mb-4">
                <h2 className="font-display font-bold">Reading list</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Chosen by your facilitator. None of it is graded and none of it is needed to finish the module —
                  it is here because it is worth your time.
                </p>
              </div>
              <ReadingListView items={readings} />
            </section>
          )}

          {activeTab === 'quiz' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="font-display font-bold">Module quiz</h2>
                {entry?.quizPassed && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">
                    Passed · {entry.quizBestScore}%
                  </span>
                )}
              </div>
              {entry?.hasQuiz === false
                ? <p className="text-sm text-muted-foreground">No quiz has been published for this module.</p>
                : <QuizPanel sessionId={session.id} />}
            </section>
          )}

      </div>
    </div>
  );
}
