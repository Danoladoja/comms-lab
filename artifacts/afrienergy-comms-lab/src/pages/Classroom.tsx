import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMySessions, useListMyProgress, useJoinSession,
  getListMyProgressQueryKey, getListMySessionsQueryKey,
} from '@workspace/api-client-react';
import { liveWindow } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { QuizPanel, AssignmentPanel } from '@/components/CourseworkDialogs';
import { CritiqueQueue, MyFeedbackPanel } from '@/components/CritiquePanel';
import {
  ArrowLeft, Video, PlayCircle, CheckCircle2, Lock, Radio, Clock,
  FileQuestion, ClipboardList, ExternalLink, CalendarClock, MessagesSquare,
  Flame, AlertTriangle,
} from 'lucide-react';

import { toEmbedUrl } from '@/lib/embed';

type Tab = '' | 'assignment' | 'critique' | 'feedback' | 'quiz';

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
  const { data: sessions = [], isLoading: loadingSessions } = useListMySessions();
  const { data: progress = [] } = useListMyProgress();
  const session = sessions.find(s => s.id === sessionId);
  const entry = progress.find(p => p.sessionId === sessionId);

  const joinSession = useJoinSession({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
        // Late joins used to fail silently: attendance was recorded but never
        // counted, and nobody said so. Now it is said out loud.
        if (!result.countedAsOnTime) {
          toast({
            title: 'Checked in — but not counted as on time',
            description: 'You joined after the grace window, so this one does not add to your streak. It does not affect completing the module.',
          });
        }
        if (result.joinUrl) {
          window.open(result.joinUrl, '_blank', 'noreferrer');
        } else {
          toast({
            title: 'You are checked in',
            description: 'The video link has not been added yet. Your facilitator will share it shortly.',
          });
        }
      },
      onError: () => toast({
        title: 'Cannot join yet',
        description: 'This session is not open for joining right now.',
        variant: 'destructive',
      }),
    },
  });

  if (loadingSessions) {
    return <div className="container mx-auto px-4 py-12"><div className="h-72 bg-card border border-border rounded-2xl animate-pulse" /></div>;
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

  // Both the button and the server read the same function, so the UI can no
  // longer offer a join the API will refuse.
  const win = liveWindow({
    startsAt: session.startsAt as unknown as string | null,
    durationMins: session.durationMins,
  });
  const locked = entry?.locked ?? false;
  const embed = session.recordingUrl ? toEmbedUrl(session.recordingUrl) : null;
  const hasReplay = win.state === 'ended' && !!session.recordingUrl && !!embed;

  const owedCritiques = Math.max(0, (entry?.reviewsRequired ?? 0) - (entry?.reviewsGiven ?? 0));

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
          {entry?.attendedLive && (
            <span className="flex items-center gap-1 bg-amber-100 text-amber-900 text-xs font-semibold px-2.5 py-1 rounded-full">
              <Flame className="w-3.5 h-3.5" aria-hidden />Was there live
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1.5">
          <Clock className="w-4 h-4" aria-hidden />
          {formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min
        </p>
      </div>

      {locked ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-xl">
          <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden />
          <h2 className="font-bold mb-1">This module is locked</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Finish the previous module first — file the assignment and write the critiques you owe. Attendance is not
            part of the lock: missing a live class never blocks you.
          </p>
          <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Video stage */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl overflow-hidden border border-border bg-[#07111E] text-[#F4F0E8]">
              {hasReplay && embed ? (
                embed.kind === 'iframe' ? (
                  <iframe
                    src={embed.src}
                    title={`${session.title} recording`}
                    className="w-full aspect-video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
                ) : (
                  <video src={embed.src} controls className="w-full aspect-video bg-black" />
                )
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center text-center px-6">
                  {win.canJoin ? (
                    <>
                      <Radio className="w-12 h-12 text-[#F97316] mb-4 animate-pulse" aria-hidden />
                      <h2 className="font-display font-bold text-xl mb-1">
                        {win.state === 'open' ? 'The room is open' : 'Class is in session'}
                      </h2>
                      <p className="text-sm text-[#F4F0E8]/80 mb-2 max-w-md">
                        Joining checks you in and opens the live video room.
                      </p>
                      {/* Say what is about to be lost, before it is lost. */}
                      {win.countsAsOnTime ? (
                        win.msUntilLateMark < 5 * 60 * 1000 && (
                          <p className="text-xs text-amber-300 mb-5 inline-flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                            {minutesFrom(win.msUntilLateMark)} min left to count as on time
                          </p>
                        )
                      ) : (
                        <p className="text-xs text-[#F4F0E8]/70 mb-5 max-w-md">
                          The on-time window has passed, so this join will not add to your streak. You can still join,
                          and it does not affect completing the module.
                        </p>
                      )}
                      <Button
                        size="lg"
                        className="font-bold mt-3"
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
                        This class has ended. The recording appears here once your facilitator uploads it — everyone
                        enrolled gets it, whether or not you made it live.
                      </p>
                    </>
                  ) : (
                    <>
                      <CalendarClock className="w-12 h-12 text-[#F97316] mb-4" aria-hidden />
                      <h2 className="font-display font-bold text-xl mb-1">
                        {win.state === 'unscheduled' ? 'Session not scheduled yet' : 'Starts soon'}
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
            {hasReplay && (
              <p className="text-xs text-muted-foreground mt-2">
                Problems with playback?{' '}
                <a className="underline focus-visible:ring-2 focus-visible:ring-ring rounded" href={session.recordingUrl!} target="_blank" rel="noreferrer">
                  Open the recording in a new tab
                </a>
                {' '}or ask your facilitator for the audio-only version.
              </p>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            <section className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-display font-bold mb-1 text-sm uppercase tracking-wider text-muted-foreground">
                To complete this module
              </h2>
              <p className="text-xs text-muted-foreground mb-3">Attendance is a bonus, not a requirement.</p>
              <ul className="space-y-2.5 text-sm">
                {entry?.hasAssignment !== false && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground"><ClipboardList className="w-4 h-4" aria-hidden />File the make</span>
                    {entry?.assignmentSubmitted
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Filed</span>
                      : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Not filed</span>}
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
                <li className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                  <span className="flex items-center gap-2 text-muted-foreground"><Flame className="w-4 h-4" aria-hidden />Live attendance</span>
                  {entry?.attendedLive
                    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">On time</span>
                    : entry?.attended
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Joined late</span>
                      : <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Bonus</span>}
                </li>
              </ul>
            </section>

            <nav className="grid grid-cols-2 gap-2" aria-label="Module coursework">
              <Button
                variant={tab === 'assignment' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'assignment' ? '' : 'assignment'))}
                aria-pressed={tab === 'assignment'}
              >
                <ClipboardList className="w-4 h-4 mr-1.5" aria-hidden />The make
                {entry?.assignmentSubmitted && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
              <Button
                variant={tab === 'critique' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'critique' ? '' : 'critique'))}
                aria-pressed={tab === 'critique'}
              >
                <MessagesSquare className="w-4 h-4 mr-1.5" aria-hidden />Critique
                {owedCritiques > 0
                  ? <span className="ml-1.5 text-xs font-bold">{owedCritiques}</span>
                  : (entry?.reviewsRequired ?? 0) > 0 && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
              <Button
                variant={tab === 'feedback' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'feedback' ? '' : 'feedback'))}
                aria-pressed={tab === 'feedback'}
              >
                <MessagesSquare className="w-4 h-4 mr-1.5" aria-hidden />My feedback
                {(entry?.reviewsReceived ?? 0) > 0 && entry?.feedbackUnlocked && (
                  <span className="ml-1.5 text-xs font-bold">{entry.reviewsReceived}</span>
                )}
              </Button>
              <Button
                variant={tab === 'quiz' ? 'default' : 'outline'}
                onClick={() => setTab(t => (t === 'quiz' ? '' : 'quiz'))}
                aria-pressed={tab === 'quiz'}
              >
                <FileQuestion className="w-4 h-4 mr-1.5" aria-hidden />Quiz
                {entry?.quizPassed && <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-emerald-600" aria-hidden />}
              </Button>
            </nav>
          </aside>

          {tab === 'assignment' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="font-display font-bold">The make</h2>
                {entry?.assignmentSubmitted && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900">Filed</span>
                )}
              </div>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <AssignmentPanel sessionId={session.id} onSubmitted={() => setTab('critique')} />}
            </section>
          )}

          {tab === 'critique' && (
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

          {tab === 'feedback' && (
            <section className="lg:col-span-3 bg-card border border-border rounded-2xl p-6">
              <h2 className="font-display font-bold mb-4">What your peers said</h2>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <MyFeedbackPanel sessionId={session.id} />}
            </section>
          )}

          {tab === 'quiz' && (
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
      )}
    </div>
  );
}
