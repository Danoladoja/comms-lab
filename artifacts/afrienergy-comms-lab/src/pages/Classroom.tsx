import { Link, useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMySessions, useListMyProgress, useJoinSession,
  getListMyProgressQueryKey, getListMySessionsQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { QuizPanel, AssignmentPanel } from '@/components/CourseworkDialogs';
import {
  ArrowLeft, Video, PlayCircle, CheckCircle2, Lock, Radio, Clock,
  FileQuestion, ClipboardList, ExternalLink, CalendarClock,
} from 'lucide-react';

/** Turn a pasted recording link into an embeddable URL when we recognise the
 *  platform; otherwise the recording opens in a new tab. */
function toEmbedUrl(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return { kind: 'iframe', src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null);
      if (id) return { kind: 'iframe', src: `https://www.youtube.com/embed/${id}` };
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` };
    }
    if (host === 'loom.com' && u.pathname.startsWith('/share/')) {
      return { kind: 'iframe', src: `https://www.loom.com/embed/${u.pathname.split('/')[2]}` };
    }
    if (/\.(mp4|webm|m3u8)$/i.test(u.pathname)) return { kind: 'video', src: url };
  } catch { /* fall through */ }
  return null;
}

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  });
}

export default function Classroom() {
  const params = useParams<{ id: string }>();
  const sessionId = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: sessions = [], isLoading: loadingSessions } = useListMySessions();
  const { data: progress = [] } = useListMyProgress();
  const session = sessions.find(s => s.id === sessionId);
  const entry = progress.find(p => p.sessionId === sessionId);

  const joinSession = useJoinSession({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
        if (result.joinUrl) {
          window.open(result.joinUrl, '_blank', 'noreferrer');
        } else {
          toast({
            title: 'You are checked in',
            description: 'The video link for this session has not been added yet. Your facilitator will share it shortly.',
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

  const now = Date.now();
  const start = session.startsAt ? new Date(session.startsAt as unknown as string).getTime() : null;
  const end = start !== null ? start + session.durationMins * 60 * 1000 : null;
  const isLive = start !== null && now >= start - 15 * 60 * 1000 && now <= (end ?? 0);
  const isOver = end !== null && now > end;
  const locked = entry?.locked ?? false;
  const embed = session.recordingUrl ? toEmbedUrl(session.recordingUrl) : null;
  const canWatchReplay = isOver && !!session.recordingUrl && !!entry?.attendedLive;

  return (
    <div className="container mx-auto px-4 md:px-6 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft className="w-4 h-4" />Back to dashboard
      </Link>

      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-1">{session.programTitle}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-display font-bold">{session.title}</h1>
          {isLive && (
            <span className="flex items-center gap-1.5 bg-[#C2410C] text-white text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />Live
            </span>
          )}
          {entry?.completed && (
            <span className="flex items-center gap-1 bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" />Completed
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1.5">
          <Clock className="w-4 h-4" />{formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min
        </p>
      </div>

      {locked ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-xl">
          <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-bold mb-1">This module is locked</h2>
          <p className="text-sm text-muted-foreground mb-5">Complete the previous module — attend live, pass the quiz, and submit the assignment — to unlock it.</p>
          <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Video stage */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl overflow-hidden border border-border bg-[#07111E] text-[#F4F0E8]">
              {canWatchReplay && embed ? (
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
                  {isLive ? (
                    <>
                      <Radio className="w-12 h-12 text-[#F97316] mb-4 animate-pulse" />
                      <h2 className="font-display font-bold text-xl mb-1">Class is in session</h2>
                      <p className="text-sm text-[#F4F0E8]/70 mb-6 max-w-md">
                        Joining checks you in for attendance and opens the live video room.
                      </p>
                      <Button
                        size="lg"
                        className="font-bold"
                        disabled={joinSession.isPending}
                        onClick={() => joinSession.mutate({ id: session.id })}
                      >
                        <Video className="w-5 h-5 mr-2" />
                        {joinSession.isPending ? 'Opening...' : 'Join live class'}
                      </Button>
                    </>
                  ) : isOver ? (
                    canWatchReplay ? (
                      <>
                        <PlayCircle className="w-12 h-12 text-[#F97316] mb-4" />
                        <h2 className="font-display font-bold text-xl mb-1">Recording available</h2>
                        <p className="text-sm text-[#F4F0E8]/70 mb-6">This recording opens on the video platform.</p>
                        <Button asChild size="lg" className="font-bold">
                          <a href={session.recordingUrl!} target="_blank" rel="noreferrer">
                            <ExternalLink className="w-5 h-5 mr-2" />Watch recording
                          </a>
                        </Button>
                      </>
                    ) : entry?.attendedLive ? (
                      <>
                        <PlayCircle className="w-12 h-12 text-[#F4F0E8]/40 mb-4" />
                        <h2 className="font-display font-bold text-xl mb-1">Recording coming soon</h2>
                        <p className="text-sm text-[#F4F0E8]/70 max-w-md">
                          This session has ended. The recording will appear here once your facilitator uploads it.
                        </p>
                      </>
                    ) : (
                      <>
                        <Video className="w-12 h-12 text-[#F4F0E8]/40 mb-4" />
                        <h2 className="font-display font-bold text-xl mb-1">Live class missed</h2>
                        <p className="text-sm text-[#F4F0E8]/70 max-w-md">
                          Replays are reserved for learners who attended the live session. Speak to your facilitator about catching up.
                        </p>
                      </>
                    )
                  ) : (
                    <>
                      <CalendarClock className="w-12 h-12 text-[#F97316] mb-4" />
                      <h2 className="font-display font-bold text-xl mb-1">
                        {start === null ? 'Session not scheduled yet' : 'Starts soon'}
                      </h2>
                      <p className="text-sm text-[#F4F0E8]/70 max-w-md">
                        {start === null
                          ? 'The date for this session will be announced. Check back here to join live.'
                          : `The live video room opens here 15 minutes before class on ${formatSessionDate(session.startsAt as unknown as string)}.`}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
            {canWatchReplay && embed && (
              <p className="text-xs text-muted-foreground mt-2">
                Problems with playback? <a className="underline" href={session.recordingUrl!} target="_blank" rel="noreferrer">Open the recording in a new tab</a>.
              </p>
            )}
          </div>

          {/* Coursework */}
          <aside className="space-y-6">
            <section className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-display font-bold flex items-center gap-2">
                  <FileQuestion className="w-4 h-4 text-[#C2410C]" />Module quiz
                </h2>
                {entry?.quizPassed && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Passed · {entry.quizBestScore}%
                  </span>
                )}
              </div>
              {entry?.hasQuiz === false
                ? <p className="text-sm text-muted-foreground">No quiz has been published for this module.</p>
                : <QuizPanel sessionId={session.id} />}
            </section>

            <section className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-display font-bold flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-[#C2410C]" />Assignment
                </h2>
                {entry?.assignmentSubmitted && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Submitted
                  </span>
                )}
              </div>
              {entry?.hasAssignment === false
                ? <p className="text-sm text-muted-foreground">No assignment has been published for this module.</p>
                : <AssignmentPanel sessionId={session.id} />}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
