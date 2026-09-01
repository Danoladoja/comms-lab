import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSimulationStudio,
  useUpsertSimulationResponse,
  getGetSimulationStudioQueryKey,
  type SimulationDefinition,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Clock, ShieldAlert, Target, Save, CheckCircle2 } from 'lucide-react';

export default function SimulationLearnerView({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: studio, isLoading } = useGetSimulationStudio(sessionId, {
    query: {
      queryKey: getGetSimulationStudioQueryKey(sessionId),
      refetchInterval: (query) => {
        const run = (query.state.data as any)?.run;
        return run?.status === 'live' || run?.status === 'debrief' ? 5000 : false;
      },
    },
  });

  if (isLoading) return <div className="h-20 bg-muted/40 rounded-lg animate-pulse" />;

  const definition = studio?.definition;
  const run = studio?.run;

  if (!definition || !definition.published || !run || run.status === 'draft') {
    return (
      <div className="text-center py-10 bg-muted/20 rounded-xl border border-border">
        <Target className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-display font-semibold" data-testid="text-simulation-inactive-title">Simulation not active</h3>
        <p className="text-sm text-muted-foreground mt-1">The simulation has not been started by the facilitator.</p>
      </div>
    );
  }

  // The backend redacts groups so the learner only sees theirs.
  const myGroup = definition.groups[0];

  if (!myGroup) {
    return (
      <div className="text-center py-10 bg-muted/20 rounded-xl border border-border">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-display font-semibold" data-testid="text-not-assigned-title">Not Assigned</h3>
        <p className="text-sm text-muted-foreground mt-1">You have not been assigned to a group for this simulation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-display font-bold text-lg" data-testid="text-simulation-title">{definition.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{definition.context}</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Your Role</h4>
            <p className="font-medium text-sm" data-testid="text-learner-role">{myGroup.name} — {myGroup.roleName}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Confidential Brief</h4>
            <p className="text-sm text-amber-900 bg-amber-50/50 p-3 rounded-lg border border-amber-200" data-testid="text-learner-confidential-brief">
              {myGroup.confidentialBrief}
            </p>
          </div>
        </div>
        
        <div className="pt-4 border-t border-border">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Opening Brief</h4>
          <p className="text-sm" data-testid="text-opening-brief">{definition.openingBrief}</p>
        </div>
      </div>

      {/* Injects (Developments) */}
      {studio.releases.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-display font-bold text-lg">Developments</h4>
          {studio.releases.map((rel: any, index: number) => {
            const inj = definition.injects.find((j) => j.id === rel.injectId);
            if (!inj) return null;
            
            // Check if there is an existing response
            const response = studio.responses.find((r: any) => r.injectId === inj.id && r.groupId === myGroup.id);
            
            return (
              <InjectCard
                key={inj.id}
                sessionId={sessionId}
                inject={inj}
                release={rel}
                response={response}
                isLatest={index === studio.releases.length - 1}
                runStatus={run.status}
              />
            );
          })}
        </div>
      )}

      {/* Debrief Phase */}
      {run.status === 'debrief' || run.status === 'ended' ? (
        <div className="bg-card border border-primary/20 rounded-xl p-5 shadow-sm shadow-primary/5">
          <h4 className="font-display font-bold text-lg mb-3">Debrief</h4>
          {definition.debriefQuestions && definition.debriefQuestions.length > 0 ? (
            <ul className="list-decimal pl-5 space-y-2 text-sm">
              {definition.debriefQuestions.map((q, i) => (
                <li key={i} data-testid={`text-debrief-question-${i}`}>{q}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">The simulation is now in debrief.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function InjectCard({
  sessionId,
  inject,
  release,
  response,
  isLatest,
  runStatus,
}: {
  sessionId: number;
  inject: any;
  release: any;
  response: any;
  isLatest: boolean;
  runStatus: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const [draft, setDraft] = useState(response?.body || '');
  const lastSyncedValue = useRef(response?.body || '');
  
  // Keep draft in sync if someone else updates the response,
  // but ONLY if the learner hasn't locally edited the draft.
  useEffect(() => {
    if (response?.body !== undefined && response.body !== lastSyncedValue.current) {
      if (draft === lastSyncedValue.current) {
        setDraft(response.body);
      }
      lastSyncedValue.current = response.body;
    }
  }, [response?.body, draft]);

  const submitResponse = useUpsertSimulationResponse({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Response saved' });
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
      },
      onError: (err: any) => {
        // Standard ORVAL/CustomFetch error might be in err.error, err.data?.error, or status on the response.
        // We'll rely on the error message text or status if available, but conflict usually has a specific shape.
        const isConflict = err?.status === 409 || err?.error?.toLowerCase().includes('conflict') || err?.data?.error?.toLowerCase().includes('conflict');
        if (isConflict) {
          toast({ 
            title: 'Conflict detected', 
            description: 'Another group member saved a newer response. Please refresh to see their changes or copy your work.', 
            variant: 'destructive' 
          });
        } else {
          toast({ title: 'Could not save', description: err?.error || err?.data?.error || 'Failed to save response', variant: 'destructive' });
        }
      },
    },
  });

  // Calculate time remaining
  const releasedAt = new Date(release.releasedAt).getTime();
  const dueAt = releasedAt + inject.responseMinutes * 60 * 1000;
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
    if (runStatus !== 'live' || !isLatest) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [runStatus, isLatest]);
  
  const msLeft = dueAt - now;
  const isOverdue = msLeft <= 0;
  const minsLeft = Math.max(0, Math.floor(msLeft / 60000));
  const secsLeft = Math.max(0, Math.floor((msLeft % 60000) / 1000));
  
  const canEdit = runStatus === 'live' && isLatest;

  return (
    <div className={`bg-card border ${isLatest && runStatus === 'live' ? 'border-primary' : 'border-border'} rounded-xl p-5 space-y-4`} data-testid={`card-inject-${inject.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h5 className="font-semibold" data-testid={`text-inject-title-${inject.id}`}>{inject.title}</h5>
          <p className="text-sm mt-1" data-testid={`text-inject-content-${inject.id}`}>{inject.content}</p>
        </div>
        {canEdit && (
          <div className={`flex flex-col items-end text-xs font-semibold px-3 py-1.5 rounded-lg border ${isOverdue ? 'bg-destructive/10 text-destructive border-destructive/20' : 'bg-muted text-muted-foreground border-border'}`}>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Time Remaining
            </span>
            <span className="text-sm mt-0.5" data-testid={`text-inject-timer-${inject.id}`}>
              {isOverdue ? 'Overdue' : `${minsLeft}:${secsLeft.toString().padStart(2, '0')}`}
            </span>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-border">
        <p className="text-sm font-semibold mb-2" data-testid={`text-inject-prompt-${inject.id}`}>{inject.responsePrompt}</p>
        {canEdit ? (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Draft your group's response here..."
              rows={3}
              data-testid={`input-inject-response-${inject.id}`}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">This response is shared with your group.</span>
              <Button
                size="sm"
                onClick={() => submitResponse.mutate({ 
                  sessionId, 
                  injectId: inject.id, 
                  data: { 
                    body: draft,
                    expectedUpdatedAt: response?.updatedAt || null
                  } 
                })}
                disabled={submitResponse.isPending || !draft.trim()}
                data-testid={`button-submit-response-${inject.id}`}
              >
                <Save className="w-4 h-4 mr-1.5" /> {submitResponse.isPending ? 'Saving...' : (response ? 'Update Response' : 'Save Response')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-muted/30 p-3 rounded-lg border border-border">
            {response?.body ? (
              <p className="text-sm whitespace-pre-wrap" data-testid={`text-saved-response-${inject.id}`}>{response.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No response was submitted.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
