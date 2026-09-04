import { useEffect, useState, useMemo } from 'react';
import { formatClock, apiReason } from '@workspace/domain';
import { useLocation } from 'wouter';
import {
  useGetSimulationRun,
  useSubmitSimulationResponse,
  useAdvanceSimulationRun,
  useCompleteSimulationRun,
  getGetSimulationRunQueryKey
} from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { DevelopmentCard } from '@/components/simulation/DevelopmentCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Send, ShieldAlert, CheckCircle2, ChevronRight, RefreshCw, Target, Users,
  Newspaper, MessageCircle, Radio, Mail, Phone, Scale, Megaphone, Zap, Clock, TimerOff, Download,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';


type Atmosphere = 'operational' | 'media' | 'executive';

function getAtmosphere(run: any): Atmosphere {
  const text = (run?.openingBrief + " " + (run?.currentDevelopment?.title || '')).toLowerCase();
  if (text.includes('press') || text.includes('media') || text.includes('interview') || text.includes('journalist') || text.includes('news')) return 'media';
  if (text.includes('board') || text.includes('shareholder') || text.includes('investor') || text.includes('executive')) return 'executive';
  return 'operational';
}

const THEMES = {
  operational: {
    bg: 'bg-[#030811]',
    panelBorder: 'border-green-500/20',
    accentText: 'text-green-400',
    accentBg: 'bg-green-500',
    terminalBg: 'bg-[#010a05]',
    fontBody: 'font-mono text-sm leading-relaxed',
    headerStyle: 'font-mono uppercase tracking-[0.2em]',
    devBox: 'border-l-2 border-green-500 bg-green-500/5',
    btn: 'bg-green-500 hover:bg-green-400 text-black',
  },
  media: {
    bg: 'bg-[#050505]',
    panelBorder: 'border-white/10',
    accentText: 'text-red-500',
    accentBg: 'bg-red-500',
    terminalBg: 'bg-[#0a0a0a]',
    fontBody: 'font-sans text-base leading-relaxed',
    headerStyle: 'font-display uppercase tracking-tight font-black',
    devBox: 'border-l-4 border-red-600 bg-white/5',
    btn: 'bg-red-600 hover:bg-red-500 text-white',
  },
  executive: {
    bg: 'bg-[#080a0c]',
    panelBorder: 'border-[#d4af37]/20',
    accentText: 'text-[#d4af37]',
    accentBg: 'bg-[#d4af37]',
    terminalBg: 'bg-[#0c0e11]',
    fontBody: 'font-sans text-base leading-relaxed text-white/90',
    headerStyle: 'font-display text-white',
    devBox: 'border-l-2 border-[#d4af37] bg-[#d4af37]/5',
    btn: 'bg-[#d4af37] hover:bg-[#b08d20] text-black',
  }
};

/**
 * A clock that ticks between the server's answers.
 *
 * The server decides what time it is; this only counts down from the last
 * number it gave us so the display does not sit frozen for five seconds at a
 * stretch. It resets whenever a fresh number arrives, so it can drift for a
 * moment but never for long, and it is never what decides that time is up.
 */
function useTicking(secondsFromServer: number | null | undefined) {
  const [seconds, setSeconds] = useState<number | null>(secondsFromServer ?? null);

  useEffect(() => {
    setSeconds(secondsFromServer ?? null);
  }, [secondsFromServer]);

  useEffect(() => {
    if (seconds === null) return;
    const id = setInterval(() => setSeconds((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, [seconds === null]);

  return seconds;
}

export default function SimulationRun({ id }: { id?: string }) {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const parsedId = id ? parseInt(id, 10) : 0;
  const isValidId = !isNaN(parsedId) && parsedId > 0;
  const numericId = isValidId ? parsedId : 0;

  const [responseBody, setResponseBody] = useState('');

  const { data: run, isLoading, error, refetch } = useGetSimulationRun(numericId, {
    query: {
      enabled: isValidId,
      queryKey: getGetSimulationRunQueryKey(numericId),
      /*
       * Keep asking for as long as anything can change.
       *
       * This used to poll only in a room, which meant a solo exercise never
       * found out that anything had happened: the session clock ran on past
       * zero with nothing stopping it, and the debrief sat on the server until
       * somebody reloaded the page by hand. Both were the same bug.
       *
       * Fast while the newsroom is writing, because that is the wait people
       * feel. Steady otherwise, so an expiring clock is noticed within a few
       * seconds. Nothing at all once the exercise is over, because then
       * nothing can change again.
       */
      refetchInterval: (query) => {
        const data = query.state.data as any;
        if (!data || data.status !== 'active') return false;
        if (data.working) return 1500;
        const left = data.clock?.responseSecondsLeft;
        if (typeof left === 'number' && left <= 0) return 2000;
        return 4000;
      },
    }
  });

  const submitResponse = useSubmitSimulationResponse();
  const advanceRun = useAdvanceSimulationRun();
  const completeRun = useCompleteSimulationRun();

  useEffect(() => {
    if (error) {
      toast({ title: "Connection Severed", description: "Failed to load active scenario.", variant: "destructive" });
      setLocation('/studio');
    }
  }, [error, setLocation, toast]);

  const isCompleted = run?.status === 'completed';
  const currentDev = run?.currentDevelopment;
  const isOwner = !!run?.isOwner;
  const sessionLeft = useTicking(run?.clock?.sessionSecondsLeft);
  const responseLeft = useTicking(run?.clock?.responseSecondsLeft);
  // Under a minute is when people start typing faster. It is the only moment
  // the interface raises its voice.
  const urgent = responseLeft !== null && responseLeft <= 60;
  const missed = responseLeft === 0;
  // The server is writing. Say so, rather than showing a screen that looks
  // like it has stopped.
  const working = !!run?.working;
  const anyoneAnswered = useMemo(
    () => !!currentDev && !!run?.responses?.some((r: any) => r.injectId === currentDev.id),
    [run, currentDev],
  );

  const hasRespondedToCurrent = useMemo(() => {
    if (!run || !currentDev) return false;
    return run.responses?.some((r: any) => r.injectId === currentDev.id);
  }, [run, currentDev]);

  const handleSubmit = () => {
    if (!responseBody.trim()) return;
    submitResponse.mutate({ runId: numericId, data: { body: responseBody } }, {
      onSuccess: () => {
        // In a solo run the server has already written whatever happens next,
        // so there is nothing to announce: the feed simply moves.
        setResponseBody('');
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Not sent", description: apiReason(err, "Your response could not be saved."), variant: "destructive" });
      }
    });
  };

  const handleAdvance = () => {
    advanceRun.mutate({ runId: numericId }, {
      onSuccess: () => refetch(),
      onError: (err: any) => toast({ title: "System error", description: apiReason(err, "Unable to compute next state."), variant: "destructive" })
    });
  };

  const handleComplete = () => {
    completeRun.mutate({ runId: numericId }, {
      onSuccess: () => refetch(),
      onError: (err: any) => toast({ title: "System error", description: apiReason(err, "Unable to finalize scenario."), variant: "destructive" })
    });
  };

  if (!isValidId) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#030811]">
          <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="font-mono text-sm uppercase tracking-widest text-white mb-2">We cannot find that exercise</h2>
          <Button onClick={() => setLocation('/studio')} variant="outline" className="mt-6 border-white/20 text-white rounded-none uppercase tracking-widest text-xs">
            Back to the Studio
          </Button>
        </div>
      </StudioLayout>
    );
  }

  if (isLoading || !run) {
    return (
      <StudioLayout>
        <div className="flex-1 flex items-center justify-center bg-[#030811]">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 text-[#f97316]">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="font-mono font-bold uppercase tracking-[0.2em] text-[10px] animate-pulse">Opening the exercise</p>
          </motion.div>
        </div>
      </StudioLayout>
    );
  }

  if (isCompleted && run.debrief) {
    return <DebriefView run={run} onExit={() => setLocation('/studio')} />;
  }

  const atmosphere = getAtmosphere(run);
  const t = THEMES[atmosphere];

  return (
    <div className={cn("min-h-[100dvh] flex flex-col font-sans selection:bg-white/20 selection:text-white transition-colors duration-1000", t.bg, "text-white")}>

      {/* Studio Header overrides global layout when inside a run to stay deeply immersive */}
      <header className={cn("border-b h-14 flex items-center justify-between shrink-0 px-6 z-50", t.panelBorder, t.terminalBg)}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full animate-pulse", t.accentBg)} />
            <span className={cn("text-[10px] font-bold uppercase tracking-[0.2em]", t.accentText)}>What is happening</span>
          </div>
          <div className="h-4 w-px bg-white/20 mx-2" />
          <span className="font-mono text-xs text-white/50">{run.simulationId.toString().padStart(6, '0')}</span>
        </div>

        <div className="flex items-center gap-3">
          {run.status === 'active' && responseLeft !== null && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 border font-mono tabular-nums transition-colors",
                missed ? "border-white/20 text-white/40"
                  : urgent ? "border-red-500/60 text-red-400 bg-red-500/10 animate-pulse"
                  : cn(t.panelBorder, t.accentText),
              )}
              role="timer"
              aria-live={urgent ? "polite" : "off"}
              aria-label={missed ? "The deadline for this response has passed" : `${formatClock(responseLeft)} left to answer`}
            >
              {missed ? <TimerOff className="w-3.5 h-3.5" aria-hidden /> : <Clock className="w-3.5 h-3.5" aria-hidden />}
              <span className="text-sm font-bold">{missed ? 'Deadline passed' : formatClock(responseLeft)}</span>
            </div>
          )}

          {run.status === 'active' && sessionLeft !== null && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-white/10 text-white/40 font-mono tabular-nums"
                 aria-label={`${formatClock(sessionLeft)} left in this exercise`}>
              <span className="text-[9px] uppercase tracking-[0.2em] font-bold">Session</span>
              <span className="text-sm">{formatClock(sessionLeft)}</span>
            </div>
          )}

          {run.mode === 'facilitated' && (
            <div className={cn("px-3 py-1 text-[9px] uppercase tracking-[0.2em] font-bold border", t.panelBorder, t.accentText)}>
              Room
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">

        {/* Left Panel: The Feed */}
        <div className={cn("flex-1 flex flex-col border-r relative", t.panelBorder)}>
          <div className="absolute inset-0 noise-bg opacity-[0.03] pointer-events-none mix-blend-overlay" />

          <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-10 scroll-smooth">

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("border border-dashed p-6", t.panelBorder, t.fontBody, "text-white/60")}>
              <h3 className={cn("text-[10px] mb-4 flex items-center gap-2", t.headerStyle, t.accentText)}>
                <Target className="w-3.5 h-3.5" /> Initial Parameters
              </h3>
              <div className="whitespace-pre-wrap">{run.openingBrief}</div>
            </motion.div>

            <AnimatePresence>
              {run.developments?.map((dev: any, index: number) => {
                const response = run.responses?.find((r: any) => r.injectId === dev.id);
                const isCurrent = currentDev?.id === dev.id;
                return (
                  <motion.div
                    key={dev.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4 }}
                    className={cn("space-y-4", isCurrent && !hasRespondedToCurrent ? "opacity-100" : "opacity-60 grayscale-[0.3]")}
                  >
                    {/*
                      Each one drawn as the thing it is: a post as a post, a
                      wire item as a bulletin, a regulator's letter with its
                      reference on it. All from text the model already returns.
                    */}
                    <DevelopmentCard development={dev} />

                    {response && (
                      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn("p-5 ml-8 border bg-black/20", t.panelBorder)}>
                        <div className="flex items-center gap-2 mb-3 text-white/40 text-[10px] uppercase tracking-widest font-mono">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Logged Action
                        </div>
                        <p className="font-mono text-sm text-white/90 whitespace-pre-wrap">{response.body}</p>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {hasRespondedToCurrent && !isOwner && run.mode === 'facilitated' && run.status === 'active' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("flex flex-col items-center justify-center p-12 border border-dashed", t.panelBorder)}>
                <RefreshCw className={cn("w-6 h-6 animate-spin mb-4", t.accentText)} />
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50 text-center">Waiting for the facilitator</p>
              </motion.div>
            )}

            {/* Spacer for bottom padding */}
            <div className="h-10" />
          </div>
        </div>

        {/* Right Panel: Terminal */}
        <div className={cn("w-full lg:w-[420px] shrink-0 flex flex-col z-10 shadow-2xl lg:shadow-none border-t lg:border-t-0", t.terminalBg, t.panelBorder)}>
          <div className={cn("h-14 border-b flex items-center justify-between px-6 shrink-0", t.panelBorder)}>
            <span className={cn("text-[10px] uppercase tracking-[0.2em]", t.accentText, t.headerStyle)}>Your response</span>
            <span className="text-white/30 text-[10px] font-mono uppercase">User: {run.participantGroupId || 'Local'}</span>
          </div>

          <div className="flex-1 flex flex-col p-6 overflow-y-auto">
            {isCompleted ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className={cn("w-12 h-12 mb-6", t.accentText)} />
                <h3 className={cn("text-lg mb-2", t.headerStyle)}>Exercise finished</h3>
                <p className="text-white/40 font-mono text-xs mb-8">Your debrief is ready.</p>
                <Button onClick={() => refetch()} className={cn("uppercase tracking-widest text-xs rounded-none h-12 w-full", t.btn)}>
                  See the debrief
                </Button>
              </div>
            ) : !currentDev ? (
               <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Loader2 className={cn("w-8 h-8 animate-spin mb-4", t.accentText)} />
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50">Waiting for the first development</p>
              </div>
            ) : hasRespondedToCurrent || (isOwner && run.mode === 'facilitated') ? (
              <div className="flex-1 flex flex-col gap-6">
                {run.mode === 'facilitated' && isOwner && run.joinCode && (
                  <div className={cn("border p-5", t.panelBorder, t.devBox)}>
                    <div className={cn("text-[10px] uppercase tracking-widest mb-2 font-bold", t.accentText)}>Room code</div>
                    <p className="font-mono text-3xl tracking-[0.25em] text-white">{run.joinCode}</p>
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mt-3 font-mono">Read this out. Anyone signed in can join with it.</p>
                  </div>
                )}

                <div className="flex-1 flex flex-col justify-center text-center">
                  {hasRespondedToCurrent ? (
                    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-8">
                      <CheckCircle2 className="w-12 h-12 text-white/20 mx-auto mb-4" />
                      <p className={cn("text-sm", t.headerStyle)}>Your response is in</p>
                    </motion.div>
                  ) : (
                    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-8">
                      <Users className={cn("w-12 h-12 mx-auto mb-4", t.accentText)} />
                      <p className={cn("text-sm", t.headerStyle)}>You are running this room</p>
                    </motion.div>
                  )}

                  <p className="text-white/40 font-mono text-xs mb-8">
                    {run.mode === 'facilitated'
                      ? `${run.responses?.filter((r: any) => r.injectId === currentDev.id).length ?? 0} answered so far.`
                      : 'The next development is being written.'}
                  </p>

                  {/*
                    A room still waits for the person running it. A solo run
                    does not: the server writes the next development the moment
                    the answer lands, so there is nothing here to press. The
                    only control left is the one that ends it early.
                  */}
                  {isOwner && run.mode === 'facilitated' && (
                    <div className="space-y-3 mt-auto">
                      <Button
                        onClick={handleAdvance}
                        disabled={advanceRun.isPending || completeRun.isPending || !anyoneAnswered}
                        className={cn("w-full uppercase tracking-[0.2em] text-[10px] h-14 rounded-none font-bold", t.btn)}
                      >
                        {advanceRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Zap className="w-4 h-4 mr-2" aria-hidden />}
                        What happens next
                      </Button>
                      <Button
                        onClick={handleComplete}
                        disabled={completeRun.isPending || advanceRun.isPending || !anyoneAnswered}
                        variant="outline"
                        className={cn("w-full uppercase tracking-[0.2em] text-[10px] h-14 rounded-none border-white/20 text-white hover:bg-white/5", !anyoneAnswered && "opacity-50")}
                      >
                        {completeRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null}
                        End and debrief
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className={cn("p-5 border mb-6", missed ? "border-white/20" : t.panelBorder, "bg-white/[0.02]")}>
                  <h4 className={cn("text-[10px] uppercase tracking-[0.2em] mb-3 font-bold", missed ? "text-white/40" : t.accentText)}>
                    What you need to do
                  </h4>
                  <p className="text-white/90 text-sm font-mono leading-relaxed">{currentDev.responsePrompt}</p>
                  {missed && (
                    <p className="text-white/50 text-xs mt-4 leading-relaxed">
                      The deadline has gone. The story is moving on without you, which is itself an
                      outcome and will be in the debrief.
                    </p>
                  )}
                </div>

                <div className="flex-1 flex flex-col relative min-h-[300px]">
                  <Textarea
                    value={responseBody}
                    onChange={(e) => setResponseBody(e.target.value)}
                    placeholder="Write what you would actually send, and to whom."
                    className={cn(
                      "flex-1 resize-none bg-black/40 text-white font-mono text-sm leading-relaxed p-5 rounded-none border-b-0 placeholder:text-white/20 focus-visible:ring-1",
                      t.panelBorder, "focus-visible:ring-current", t.accentText
                    )}
                  />
                  <Button
                    onClick={handleSubmit}
                    disabled={!responseBody.trim() || submitResponse.isPending || missed}
                    className={cn("h-14 rounded-none uppercase tracking-[0.2em] text-[10px] font-bold w-full", t.btn)}
                  >
                    {submitResponse.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Send className="w-4 h-4 mr-2" /> Send</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

function DebriefView({ run, onExit }: { run: any, onExit: () => void }) {
  const debrief = run.debrief;
  if (!debrief) return null;

  /*
   * Saving it.
   *
   * Every browser prints to PDF, so the work is in making the printed page a
   * proper report rather than in shipping a library that would do the same job
   * worse. The print rules live in index.css and key off data-print-root.
   */
  const save = () => window.print();

  return (
    <StudioLayout>
      <div className="container max-w-4xl mx-auto py-12 px-6 z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#050b14] border border-[#f97316]/30 shadow-[0_0_40px_rgba(249,115,22,0.1)] relative overflow-hidden"
          data-print-root
        >
          <div className="bg-[#f97316] p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-black/50 text-[10px] font-mono uppercase tracking-[0.2em] mb-2 font-bold">
                <Target className="w-3 h-3" /> Debrief
              </div>
              <h2 className="font-display text-3xl md:text-4xl font-black text-[#030811] uppercase tracking-tight">
                {debrief.headline || 'After-Action Report'}
              </h2>
            </div>

            <div className="shrink-0 flex items-center justify-center w-24 h-24 bg-[#030811] border border-[#f97316]/20 relative">
              <div className="absolute inset-1 border border-[#f97316]/20" />
              <div className="text-center">
                <span className="block text-3xl font-mono text-[#f97316] leading-none">{debrief.score}</span>
                <span className="block text-[8px] uppercase tracking-widest text-white/50 mt-1">Rating</span>
              </div>
            </div>
          </div>

          <div className="p-8 md:p-10 space-y-10">
            {debrief.ratings?.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                  <Target className="w-4 h-4 text-[#f97316]" aria-hidden /> How each part went
                </h3>
                <div className="space-y-4">
                  {debrief.ratings.map((rating: any) => (
                    <div key={rating.name}>
                      <div className="flex items-baseline justify-between gap-4 mb-1.5">
                        <span className="text-white/90 text-sm font-semibold">{rating.name}</span>
                        <span className="text-white/60 text-xs font-mono tabular-nums">{rating.score}</span>
                      </div>
                      {/* A bar, not a grade. It exists so that the same name
                          next time can visibly be somewhere else. */}
                      <div className="h-1.5 bg-white/10 overflow-hidden" role="img" aria-label={`${rating.name}: ${rating.score} out of 100`}>
                        <div className="h-full bg-[#f97316]" data-print-keep style={{ width: `${Math.max(2, Math.min(100, rating.score))}%` }} />
                      </div>
                      {rating.note && <p className="text-white/50 text-xs mt-2 leading-relaxed">{rating.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-10">
              <div className="space-y-5">
                <h3 className="text-white font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2 border-b border-white/10 pb-3">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> Execution Strengths
                </h3>
                <ul className="space-y-4">
                  {debrief.strengths?.map((str: string, i: number) => (
                    <li key={i} className="text-white/80 text-sm font-sans flex items-start gap-3">
                      <ChevronRight className="w-4 h-4 text-green-500 shrink-0 mt-0.5" /> <span>{str}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-5">
                <h3 className="text-white font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2 border-b border-white/10 pb-3">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full" /> Vulnerabilities
                </h3>
                <ul className="space-y-4">
                  {debrief.risks?.map((risk: string, i: number) => (
                    <li key={i} className="text-white/80 text-sm font-sans flex items-start gap-3">
                      <ChevronRight className="w-4 h-4 text-red-500 shrink-0 mt-0.5" /> <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4 bg-white/[0.02] border border-white/5 p-6">
              <h3 className="text-white font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2 border-b border-white/10 pb-3">
                <Users className="w-3.5 h-3.5 text-[#f97316]" /> Stakeholder Fallout
              </h3>
              <p className="text-white/90 text-sm leading-relaxed font-sans">
                {debrief.stakeholderImpact}
              </p>
            </div>

            <div className="space-y-5">
              <h3 className="text-[#f97316] font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2">
                <Target className="w-3.5 h-3.5" /> Prescribed Countermeasures
              </h3>
              <ul className="space-y-3">
                {debrief.recommendations?.map((rec: string, i: number) => (
                  <li key={i} className="text-white/90 text-sm font-mono flex items-start gap-4 bg-[#030811] p-4 border border-[#f97316]/20">
                    <span className="text-[#f97316] opacity-50">[{i+1}]</span> <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row gap-3" data-print-hide>
              <Button
                onClick={save}
                variant="outline"
                className="sm:w-auto h-14 px-8 border-white/20 bg-transparent text-white hover:bg-white/5 font-bold uppercase tracking-[0.2em] text-[10px] rounded-none"
              >
                <Download className="w-4 h-4 mr-2" aria-hidden /> Save as PDF
              </Button>
              <Button onClick={onExit} className="flex-1 h-14 bg-white text-[#030811] hover:bg-white/90 font-bold uppercase tracking-[0.2em] text-[10px] rounded-none transition-all active:scale-[0.99]">
                Back to the Studio
              </Button>
            </div>
            <p className="text-white/30 text-[10px] mt-3 leading-relaxed" data-print-hide>
              Opens your browser's print window. Choose "Save as PDF" as the destination.
            </p>
          </div>
        </motion.div>
      </div>
    </StudioLayout>
  );
}
