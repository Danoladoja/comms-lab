import { useEffect, useState, useRef, useMemo } from 'react';
import { useLocation } from 'wouter';
import { 
  useGetSimulationRun, 
  useSubmitSimulationResponse, 
  useAdvanceSimulationRun, 
  useCompleteSimulationRun,
  getGetSimulationRunQueryKey
} from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Send, Clock, ShieldAlert, AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, Target, Users,
  Newspaper, MessageCircle, Radio, Mail, Phone, Scale, Megaphone, KeyRound,
} from 'lucide-react';

/**
 * What the server actually said went wrong.
 *
 * These calls fail for reasons a person can act on: the AI is busy, the key is
 * missing, somebody else answered while this was generating. "Update Failed"
 * told them none of it.
 */
function reason(err: any, fallback: string): string {
  return err?.error || err?.data?.error || err?.message || fallback;
}

/** Where a development came from, as an icon and a word. */
const CHANNELS: Record<string, { icon: typeof Newspaper; label: string }> = {
  wire: { icon: Newspaper, label: 'News wire' },
  social: { icon: MessageCircle, label: 'Social media' },
  broadcast: { icon: Radio, label: 'Broadcast' },
  internal: { icon: Mail, label: 'Internal' },
  call: { icon: Phone, label: 'Phone call' },
  regulator: { icon: Scale, label: 'Regulator' },
  community: { icon: Megaphone, label: 'Community' },
};
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

export default function SimulationRun({ id }: { id?: string }) {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const parsedId = id ? parseInt(id, 10) : 0;
  const isValidId = !isNaN(parsedId) && parsedId > 0;
  const numericId = isValidId ? parsedId : 0;

  const [responseBody, setResponseBody] = useState('');
  
  // Keep unsaved input when polling refreshes the run data.
  // Polling is needed for facilitated mode where instructor releases injects.
  const { data: run, isLoading, error, refetch } = useGetSimulationRun(numericId, { 
    query: { 
      enabled: isValidId,
      queryKey: getGetSimulationRunQueryKey(numericId),
      refetchInterval: (query) => {
        // Poll every 5s if active and facilitated
        const data = query.state.data as any;
        if (data?.status === 'active' && data?.mode === 'facilitated') return 5000;
        return false;
      }
    } 
  });

  const submitResponse = useSubmitSimulationResponse();
  const advanceRun = useAdvanceSimulationRun();
  const completeRun = useCompleteSimulationRun();

  useEffect(() => {
    if (error) {
      toast({ title: "Connection Lost", description: "Failed to load simulation environment.", variant: "destructive" });
      setLocation('/studio');
    }
  }, [error, setLocation, toast]);

  // Derived state
  const isCompleted = run?.status === 'completed';
  const currentDev = run?.currentDevelopment;
  // The controls hang off this. A facilitator running a room has to be able to
  // move it on without first writing an answer of their own, and a participant
  // must never be able to move it on at all.
  const isOwner = !!run?.isOwner;
  const anyoneAnswered = useMemo(
    () => !!currentDev && !!run?.responses?.some((r: any) => r.injectId === currentDev.id),
    [run, currentDev],
  );
  // If we have responded to the current inject, we might wait for instructor (facilitated) or advance (autonomous)
  const hasRespondedToCurrent = useMemo(() => {
    if (!run || !currentDev) return false;
    return run.responses?.some((r: any) => r.injectId === currentDev.id);
  }, [run, currentDev]);

  const handleSubmit = () => {
    if (!responseBody.trim()) return;
    submitResponse.mutate({ runId: numericId, data: { body: responseBody } }, {
      onSuccess: () => {
        toast({ title: "Response sent" });
        setResponseBody('');
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Not sent", description: reason(err, "Your response could not be saved. Try again."), variant: "destructive" });
      }
    });
  };

  const handleAdvance = () => {
    advanceRun.mutate({ runId: numericId }, {
      onSuccess: () => {
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Could not continue", description: reason(err, "The next development could not be written. Try again."), variant: "destructive" });
      }
    });
  };

  const handleComplete = () => {
    completeRun.mutate({ runId: numericId }, {
      onSuccess: () => {
        refetch();
      },
      onError: (err: any) => {
        toast({ title: "Could not finish", description: reason(err, "The debrief could not be written. Try again."), variant: "destructive" });
      }
    });
  };

  if (!isValidId) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[#07111e]">
          <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="font-display text-xl font-bold text-white mb-2">Invalid Simulation Link</h2>
          <p className="text-white/60 text-sm mb-6">The simulation ID is malformed or missing.</p>
          <Button onClick={() => setLocation('/studio')} variant="outline" className="border-white/20 text-white hover:bg-white/10">
            Return to Command Center
          </Button>
        </div>
      </StudioLayout>
    );
  }

  if (isLoading || !run) {
    return (
      <StudioLayout>
        <div className="flex-1 flex items-center justify-center bg-[#07111e]">
          <div className="flex flex-col items-center gap-4 text-[#f97316]">
            <Loader2 className="w-12 h-12 animate-spin" />
            <p className="font-display font-bold uppercase tracking-widest text-sm animate-pulse">Establishing Secure Connection...</p>
          </div>
        </div>
      </StudioLayout>
    );
  }

  if (isCompleted && run.debrief) {
    return <DebriefView run={run} onExit={() => setLocation('/studio')} />;
  }

  return (
    <StudioLayout>
      <div className="flex flex-col lg:flex-row h-[calc(100dvh-73px)] w-full overflow-hidden bg-[#07111e] z-10">
        
        {/* Left Panel: Stream / Log */}
        <div className="flex-1 flex flex-col border-r border-white/10 bg-[#0c1929] relative">
          <div className="h-12 border-b border-white/10 flex items-center px-4 shrink-0 bg-[#07111e] justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
              <ShieldAlert className="w-4 h-4 text-[#f97316]" /> Live Event Stream
            </div>
            {run.mode === 'facilitated' && (
              <div className="flex items-center gap-2 text-xs font-bold text-[#f97316] uppercase">
                <div className="w-2 h-2 rounded-full bg-[#f97316] animate-pulse" /> Facilitated Mode
              </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* Opening Brief / Context */}
            <div className="border border-white/10 rounded-lg p-5 bg-[#07111e]/50 text-white/80">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#f97316] mb-3">Initial Situation</h3>
              <p className="text-sm leading-relaxed">{run.openingBrief}</p>
            </div>

            {/* Render past developments and responses */}
            {run.developments?.map((dev: any, index: number) => {
              const response = run.responses?.find((r: any) => r.injectId === dev.id);
              const isCurrent = currentDev?.id === dev.id;
              
              return (
                <div key={dev.id} className={cn("space-y-4", isCurrent && !hasRespondedToCurrent && "opacity-100")}>
                  {/* Development Box */}
                  <div className="relative border-l-2 border-[#f97316] pl-6 py-2">
                    <div className="absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-[#f97316]"></div>
                    <div className="bg-[#1e1511] border border-[#f97316]/20 rounded-lg p-5">
                      {(() => {
                        const channel = CHANNELS[dev.channel as string] ?? CHANNELS.wire;
                        const Icon = channel.icon;
                        return (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 text-[#f97316] text-xs font-bold uppercase tracking-wider">
                            <Icon className="w-4 h-4" aria-hidden />
                            <span>{channel.label}</span>
                            {dev.source && (
                              <>
                                <span className="text-white/25" aria-hidden>/</span>
                                <span className="text-white/60 normal-case tracking-normal font-medium">{dev.source}</span>
                              </>
                            )}
                          </div>
                        );
                      })()}
                      <h4 className="font-bold text-white text-lg mb-2">{dev.title}</h4>
                      <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{dev.content}</p>
                    </div>
                  </div>

                  {/* Response Box */}
                  {response && (
                    <div className="relative border-l-2 border-white/20 pl-6 py-2 ml-4">
                      <div className="absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-white/40"></div>
                      <div className="bg-[#07111e] border border-white/10 rounded-lg p-5">
                        <div className="flex items-center gap-2 mb-2 text-white/40 text-xs font-bold uppercase tracking-wider">
                          <CheckCircle2 className="w-4 h-4" /> Your Response Logged
                        </div>
                        <p className="text-white/90 text-sm whitespace-pre-wrap font-mono">{response.body}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Waiting state for facilitated mode */}
            {hasRespondedToCurrent && !isOwner && run.mode === 'facilitated' && run.status === 'active' && (
              <div className="flex flex-col items-center justify-center p-10 border border-white/10 border-dashed rounded-lg text-white/50">
                <RefreshCw className="w-8 h-8 animate-spin mb-4 text-[#f97316]" />
                <p className="text-sm font-bold uppercase tracking-widest text-center">Awaiting Facilitator</p>
                <p className="text-xs text-center mt-2 max-w-xs">The simulation is paused until the facilitator releases the next inject.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Action Station */}
        <div className="w-full lg:w-[400px] shrink-0 flex flex-col bg-[#07111e]">
          <div className="h-12 border-b border-white/10 flex items-center px-4 bg-[#0c1929] justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Command Input</span>
            <div className="flex items-center gap-1.5 text-[#f97316] text-xs font-mono">
              <Clock className="w-3.5 h-3.5" /> LIVE
            </div>
          </div>

          <div className="flex-1 flex flex-col p-4">
            {isCompleted ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-white/10 rounded-lg bg-white/5">
                <CheckCircle2 className="w-12 h-12 text-[#f97316] mb-4" />
                <h3 className="text-white font-bold text-lg mb-2">Exercise finished</h3>
                <p className="text-white/60 text-sm mb-6">Nothing more can be sent. The debrief is being written.</p>
                <Button onClick={() => refetch()} className="bg-white text-[#07111e] hover:bg-white/90">
                  Show the debrief
                </Button>
              </div>
            ) : !currentDev ? (
               <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-white/10 border-dashed rounded-lg text-white/50">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-[#f97316]" />
                <p className="text-sm font-bold uppercase tracking-widest">Waiting for initial inject...</p>
              </div>
            ) : hasRespondedToCurrent || (isOwner && run.mode === 'facilitated') ? (
              <div className="flex-1 flex flex-col gap-4">
                {run.mode === 'facilitated' && isOwner && run.joinCode && (
                  <div className="bg-[#0c1929] border border-white/10 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-widest mb-2">
                      <KeyRound className="w-3.5 h-3.5" aria-hidden /> Room code
                    </div>
                    <p className="font-mono text-3xl tracking-[0.3em] text-[#f97316]">{run.joinCode}</p>
                    <p className="text-white/50 text-xs mt-2">Read this out. Anyone signed in can join with it.</p>
                  </div>
                )}

                <div className="bg-[#0c1929] border border-white/10 rounded-lg p-5 text-center">
                  {hasRespondedToCurrent ? (
                    <>
                      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-3" aria-hidden />
                      <p className="text-white font-bold mb-1">Your response is in</p>
                    </>
                  ) : (
                    <>
                      <Users className="w-8 h-8 text-[#f97316] mx-auto mb-3" aria-hidden />
                      <p className="text-white font-bold mb-1">You are running this room</p>
                    </>
                  )}
                  <p className="text-white/60 text-sm mb-6">
                    {run.mode === 'facilitated'
                      ? `${run.responses?.filter((r: any) => r.injectId === currentDev.id).length ?? 0} answered so far.`
                      : 'Move it on when you are ready.'}
                  </p>

                  {isOwner && (
                    <>
                      <Button
                        onClick={handleAdvance}
                        disabled={advanceRun.isPending || completeRun.isPending || !anyoneAnswered}
                        className="w-full bg-[#f97316] hover:bg-[#ea6d0a] text-[#07111e] font-bold uppercase tracking-wider"
                      >
                        {advanceRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null}
                        {advanceRun.isPending ? 'Writing what happens next' : 'What happens next'}
                      </Button>
                      <Button
                        onClick={handleComplete}
                        disabled={completeRun.isPending || advanceRun.isPending || !anyoneAnswered}
                        variant="outline"
                        className="w-full mt-3 border-white/20 text-white hover:bg-white/10 font-bold uppercase tracking-wider"
                      >
                        {completeRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null}
                        {completeRun.isPending ? 'Writing the debrief' : 'End and debrief'}
                      </Button>
                      {!anyoneAnswered && (
                        <p className="text-white/40 text-xs mt-3">
                          Waiting for the first answer to this development.
                        </p>
                      )}
                    </>
                  )}
                </div>

                {isOwner && !hasRespondedToCurrent && run.mode === 'facilitated' && (
                  <p className="text-white/40 text-xs text-center">
                    You do not have to answer yourself. The room does.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="bg-[#1e1511] border border-[#f97316]/20 rounded-lg p-4 mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#f97316] mb-2">Required Action</h4>
                  <p className="text-white/90 text-sm">{currentDev.responsePrompt}</p>
                </div>
                
                <div className="flex-1 flex flex-col min-h-[300px]">
                  <Textarea
                    value={responseBody}
                    onChange={(e) => setResponseBody(e.target.value)}
                    placeholder="Type your response, holding statement, or action plan here..."
                    className="flex-1 resize-none bg-[#0c1929] border-white/20 text-white font-mono text-sm leading-relaxed p-4 focus-visible:ring-[#f97316] rounded-b-none"
                  />
                  <Button
                    onClick={handleSubmit}
                    disabled={!responseBody.trim() || submitResponse.isPending}
                    className="h-14 rounded-t-none bg-[#f97316] hover:bg-[#ea6d0a] text-[#07111e] font-bold uppercase tracking-widest"
                  >
                    {submitResponse.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <><Send className="w-5 h-5 mr-2" /> Execute Action</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </StudioLayout>
  );
}

function DebriefView({ run, onExit }: { run: any, onExit: () => void }) {
  const debrief = run.debrief;
  
  if (!debrief) return null;

  return (
    <StudioLayout>
      <div className="container max-w-4xl mx-auto py-10 px-6 z-10">
        <div className="bg-[#0c1929] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="bg-[#f97316] px-8 py-6 flex items-center justify-between">
            <div className="pr-4">
              <h2 className="font-display text-3xl font-bold text-[#07111e]">After-action report</h2>
              <p className="text-[#07111e]/80 font-medium">
                {debrief.headline || 'The exercise is finished.'}
              </p>
            </div>
            <div className="w-20 h-20 rounded-full bg-[#07111e] flex items-center justify-center border-4 border-[#f97316] shadow-lg">
              <span className="font-display font-black text-3xl text-white">{debrief.score}</span>
            </div>
          </div>
          
          <div className="p-8 space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> Key Strengths
                </h3>
                <ul className="space-y-3">
                  {debrief.strengths?.map((str: string, i: number) => (
                    <li key={i} className="text-white/80 text-sm flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">•</span> <span>{str}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-4">
                <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" /> Identified Risks
                </h3>
                <ul className="space-y-3">
                  {debrief.risks?.map((risk: string, i: number) => (
                    <li key={i} className="text-white/80 text-sm flex items-start gap-2">
                      <span className="text-red-500 mt-0.5">•</span> <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                <Users className="w-4 h-4 text-[#f97316]" /> Stakeholder Impact
              </h3>
              <p className="text-white/90 text-sm leading-relaxed bg-white/5 p-4 rounded-lg">
                {debrief.stakeholderImpact}
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
                <Target className="w-4 h-4 text-[#f97316]" /> Recommendations
              </h3>
              <ul className="space-y-3">
                {debrief.recommendations?.map((rec: string, i: number) => (
                  <li key={i} className="text-white/80 text-sm flex items-start gap-3 bg-[#07111e] p-3 rounded-lg border border-white/5">
                    <ChevronRight className="w-4 h-4 text-[#f97316] shrink-0 mt-0.5" /> <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-6 border-t border-white/10">
              <Button onClick={onExit} className="w-full h-14 bg-white text-[#07111e] hover:bg-white/90 font-bold uppercase tracking-widest">
                Return to Command Center
              </Button>
            </div>
          </div>
        </div>
      </div>
    </StudioLayout>
  );
}
