import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSimulationStudio,
  useUpsertSimulationDefinition,
  useStartSimulationRun,
  useAssignSimulationGroups,
  useReleaseNextSimulationInject,
  useTransitionSimulationRun,
  getGetSimulationStudioQueryKey,
  type SimulationDefinition,
  type SimulationGroup,
  type SimulationInject,
  type SimulationGroupAssignment,
  type SimulationParticipant,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Play, CheckCircle2, MessageSquare, Save, Users, Target, Send, Hand } from 'lucide-react';

export default function SimulationStaffStudio({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: studio, isLoading, isError } = useGetSimulationStudio(sessionId, {
    query: {
      queryKey: getGetSimulationStudioQueryKey(sessionId),
      refetchInterval: (query) => {
        const run = (query.state.data as any)?.run;
        return run?.status === 'live' || run?.status === 'debrief' ? 5000 : false;
      },
    },
  });

  const [editing, setEditing] = useState(false);

  if (isLoading) return <div className="h-20 bg-muted/40 rounded-lg animate-pulse" />;
  if (isError) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        The Simulation Studio could not load because this environment does not have the latest database schema.
      </div>
    );
  }

  const definition = studio?.definition;
  const run = studio?.run;
  const isEditing = editing || !definition;

  return (
    <div className="space-y-6">
      {isEditing ? (
        <SimulationDefinitionEditor
          sessionId={sessionId}
          initial={definition || null}
          onDone={() => setEditing(false)}
          canCancel={!!definition}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 bg-card border border-border rounded-xl p-4">
            <div>
              <h3 className="font-display font-bold text-lg" data-testid="text-simulation-title">{definition.title}</h3>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-simulation-status">
                {run?.status ? `Status: ${run.status.toUpperCase()}` : 'Not started'}
                {!definition.published && ' · Draft (Not published)'}
              </p>
            </div>
            {!run && (
              <Button variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-definition">
                Edit Definition
              </Button>
            )}
          </div>

          {definition.published && (
            <SimulationRunController
              sessionId={sessionId}
              studio={studio!}
              participants={studio?.participants || []}
              definition={definition}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SimulationDefinitionEditor({
  sessionId,
  initial,
  onDone,
  canCancel,
}: {
  sessionId: number;
  initial: SimulationDefinition | null;
  onDone: () => void;
  canCancel: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState(initial?.title || '');
  const [context, setContext] = useState(initial?.context || '');
  const [learningObjective, setLearningObjective] = useState(initial?.learningObjective || '');
  const [openingBrief, setOpeningBrief] = useState(initial?.openingBrief || '');
  const [groups, setGroups] = useState<SimulationGroup[]>(
    initial?.groups || [{ id: 'group1', name: 'Group 1', roleName: 'Role', confidentialBrief: '' }]
  );
  const [injects, setInjects] = useState<SimulationInject[]>(
    initial?.injects || [{ id: 'inj1', title: 'Inject 1', content: '', responsePrompt: '', responseMinutes: 15 }]
  );
  const [debriefQuestions, setDebriefQuestions] = useState<string[]>(initial?.debriefQuestions || ['']);
  const [published, setPublished] = useState(initial?.published || false);

  const save = useUpsertSimulationDefinition({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Simulation definition saved' });
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
        onDone();
      },
      onError: (err: any) => toast({ title: 'Could not save', description: err.error || err.data?.error, variant: 'destructive' }),
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Title
          </label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Simulation Title" data-testid="input-def-title" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Context & Learning Objective
          </label>
          <Textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context" className="mb-2" data-testid="input-def-context" />
          <Textarea
            value={learningObjective}
            onChange={(e) => setLearningObjective(e.target.value)}
            placeholder="Learning Objective"
            data-testid="input-def-objective"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Opening Brief (Given to all learners)
          </label>
          <Textarea
            value={openingBrief}
            onChange={(e) => setOpeningBrief(e.target.value)}
            placeholder="Opening Brief"
            rows={4}
            data-testid="input-def-opening-brief"
          />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Groups & Roles</h4>
        {groups.map((g, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-muted/20" data-testid={`card-def-group-${i}`}>
            <div className="flex gap-2">
              <Input
                value={g.id}
                onChange={(e) => setGroups((gs) => qsUpdate(gs, i, { id: e.target.value }))}
                placeholder="ID (e.g. g1)"
                className="w-24"
                data-testid={`input-def-group-id-${i}`}
              />
              <Input
                value={g.name}
                onChange={(e) => setGroups((gs) => qsUpdate(gs, i, { name: e.target.value }))}
                placeholder="Group Name"
                data-testid={`input-def-group-name-${i}`}
              />
              <Input
                value={g.roleName}
                onChange={(e) => setGroups((gs) => qsUpdate(gs, i, { roleName: e.target.value }))}
                placeholder="Role Name"
                data-testid={`input-def-group-role-${i}`}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setGroups((gs) => gs.filter((_, idx) => idx !== i))}
                data-testid={`button-def-group-delete-${i}`}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <Textarea
              value={g.confidentialBrief}
              onChange={(e) => setGroups((gs) => qsUpdate(gs, i, { confidentialBrief: e.target.value }))}
              placeholder="Confidential Brief for this group"
              rows={2}
              data-testid={`input-def-group-brief-${i}`}
            />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setGroups((gs) => [...gs, { id: `g${gs.length + 1}`, name: '', roleName: '', confidentialBrief: '' }])} data-testid="button-def-add-group">
          <Plus className="w-4 h-4 mr-1.5" /> Add Group
        </Button>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Developments (Injects)</h4>
        {injects.map((inj, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-muted/20" data-testid={`card-def-inject-${i}`}>
            <div className="flex gap-2">
              <Input
                value={inj.id}
                onChange={(e) => setInjects((is) => qsUpdate(is, i, { id: e.target.value }))}
                placeholder="ID"
                className="w-24"
                data-testid={`input-def-inject-id-${i}`}
              />
              <Input
                value={inj.title}
                onChange={(e) => setInjects((is) => qsUpdate(is, i, { title: e.target.value }))}
                placeholder="Title"
                className="flex-1"
                data-testid={`input-def-inject-title-${i}`}
              />
              <Input
                type="number"
                value={inj.responseMinutes}
                onChange={(e) => setInjects((is) => qsUpdate(is, i, { responseMinutes: Number(e.target.value) || 15 }))}
                placeholder="Minutes"
                className="w-24"
                data-testid={`input-def-inject-minutes-${i}`}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setInjects((is) => is.filter((_, idx) => idx !== i))}
                data-testid={`button-def-inject-delete-${i}`}
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <Textarea
              value={inj.content}
              onChange={(e) => setInjects((is) => qsUpdate(is, i, { content: e.target.value }))}
              placeholder="Content / The Development"
              rows={2}
              data-testid={`input-def-inject-content-${i}`}
            />
            <Input
              value={inj.responsePrompt}
              onChange={(e) => setInjects((is) => qsUpdate(is, i, { responsePrompt: e.target.value }))}
              placeholder="Prompt for response"
              data-testid={`input-def-inject-prompt-${i}`}
            />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setInjects((is) => [...is, { id: `i${is.length + 1}`, title: '', content: '', responsePrompt: '', responseMinutes: 15 }])} data-testid="button-def-add-inject">
          <Plus className="w-4 h-4 mr-1.5" /> Add Inject
        </Button>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Debrief Questions</h4>
        {debriefQuestions.map((q, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setDebriefQuestions((qs) => qs.map((v, idx) => (idx === i ? e.target.value : v)))}
              placeholder="Question"
              data-testid={`input-def-debrief-question-${i}`}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDebriefQuestions((qs) => qs.filter((_, idx) => idx !== i))}
              data-testid={`button-def-debrief-delete-${i}`}
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setDebriefQuestions((qs) => [...qs, ''])} data-testid="button-def-add-debrief">
          <Plus className="w-4 h-4 mr-1.5" /> Add Question
        </Button>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="w-4 h-4 accent-primary"
            data-testid="checkbox-def-published"
          />
          Published
        </label>
        <div className="flex-1" />
        {canCancel && (
          <Button variant="ghost" onClick={onDone} disabled={save.isPending} data-testid="button-def-cancel">
            Cancel
          </Button>
        )}
        <Button
          onClick={() =>
            save.mutate({
              sessionId,
              data: {
                title,
                context,
                learningObjective,
                openingBrief,
                groups,
                injects,
                debriefQuestions: debriefQuestions.filter(Boolean),
                published,
              },
            })
          }
          disabled={save.isPending || !title.trim()}
          data-testid="button-def-save"
        >
          <Save className="w-4 h-4 mr-1.5" /> {save.isPending ? 'Saving...' : 'Save Definition'}
        </Button>
      </div>
    </div>
  );
}

function qsUpdate<T>(arr: T[], idx: number, patch: Partial<T>): T[] {
  return arr.map((item, i) => (i === idx ? { ...item, ...patch } : item));
}

function SimulationRunController({
  sessionId,
  studio,
  participants,
  definition,
}: {
  sessionId: number;
  studio: any;
  participants: SimulationParticipant[];
  definition: SimulationDefinition;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const run = studio.run;
  const assignments: SimulationGroupAssignment[] = studio.assignments || [];

  const assignGroups = useAssignSimulationGroups({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
      },
      onError: (err: any) => toast({ title: 'Could not assign', description: err.error || err.data?.error || 'Failed to assign groups', variant: 'destructive' }),
    },
  });

  const startRun = useStartSimulationRun({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Simulation started' });
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
      },
      onError: (err: any) => toast({ title: 'Could not start', description: err.error || err.data?.error || 'Failed to start simulation', variant: 'destructive' }),
    },
  });

  const releaseInject = useReleaseNextSimulationInject({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Inject released' });
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
      },
      onError: (err: any) => toast({ title: 'Could not release inject', description: err.error || err.data?.error, variant: 'destructive' }),
    },
  });

  const transitionRun = useTransitionSimulationRun({
    mutation: {
      onSuccess: (data: any, vars: any) => {
        toast({ title: `Moved to ${vars.data.status}` });
        qc.invalidateQueries({ queryKey: getGetSimulationStudioQueryKey(sessionId) });
      },
      onError: (err: any) => toast({ title: 'Could not transition', description: err.error || err.data?.error, variant: 'destructive' }),
    },
  });

  const handleStart = async () => {
    if (!definition.groups || definition.groups.length === 0) {
      toast({ title: 'No groups defined in the simulation', variant: 'destructive' });
      return;
    }

    const existingMap = new Map(assignments.map((a) => [a.userId, a.groupId]));
    const validGroupIds = new Set(definition.groups.map(g => g.id));
    
    const toAssign: { userId: number; groupId: string }[] = [];
    let groupIdx = 0;
    
    for (const p of participants) {
      const existingGroupId = existingMap.get(p.userId);
      if (existingGroupId && validGroupIds.has(existingGroupId)) {
        toAssign.push({ userId: p.userId, groupId: existingGroupId });
      } else {
        toAssign.push({ userId: p.userId, groupId: definition.groups[groupIdx % definition.groups.length].id });
        groupIdx++;
      }
    }
    
    try {
      await assignGroups.mutateAsync({ sessionId, data: { assignments: toAssign } });
      await startRun.mutateAsync({ sessionId });
    } catch (err) {
      // Error handled by the mutation onError
    }
  };

  const handleAssignOnly = async () => {
    if (!definition.groups || definition.groups.length === 0) {
      toast({ title: 'No groups defined', variant: 'destructive' });
      return;
    }

    const existingMap = new Map(assignments.map((a) => [a.userId, a.groupId]));
    const validGroupIds = new Set(definition.groups.map(g => g.id));
    
    const toAssign: { userId: number; groupId: string }[] = [];
    let groupIdx = 0;
    
    for (const p of participants) {
      const existingGroupId = existingMap.get(p.userId);
      if (existingGroupId && validGroupIds.has(existingGroupId)) {
        toAssign.push({ userId: p.userId, groupId: existingGroupId });
      } else {
        toAssign.push({ userId: p.userId, groupId: definition.groups[groupIdx % definition.groups.length].id });
        groupIdx++;
      }
    }
    
    try {
      await assignGroups.mutateAsync({ sessionId, data: { assignments: toAssign } });
      toast({ title: 'Groups updated', description: `Assigned ${toAssign.length} participants.` });
    } catch (err) {
      // Error handled by mutation
    }
  };

  const handleSingleAssign = async (userId: number, groupId: string) => {
    const existingMap = new Map(assignments.map((a) => [a.userId, a.groupId]));
    existingMap.set(userId, groupId);
    
    const validGroupIds = new Set(definition.groups.map(g => g.id));
    
    const toAssign: { userId: number; groupId: string }[] = [];
    
    for (const p of participants) {
      const existingGroupId = existingMap.get(p.userId);
      if (existingGroupId && validGroupIds.has(existingGroupId)) {
        toAssign.push({ userId: p.userId, groupId: existingGroupId });
      }
    }
    
    try {
      await assignGroups.mutateAsync({ sessionId, data: { assignments: toAssign } });
      toast({ title: 'Group assigned' });
    } catch (err) {
      // Error handled by mutation
    }
  };

  const nextInject = definition.injects[studio.releases?.length || 0];

  return (
    <div className="space-y-6">
      {!run || run.status === 'draft' ? (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h4 className="font-display font-bold">Preparation</h4>
          <p className="text-sm text-muted-foreground">Assign groups before starting the simulation.</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleAssignOnly} disabled={assignGroups.isPending || startRun.isPending} data-testid="button-auto-assign">
              <Users className="w-4 h-4 mr-1.5" /> Auto-assign {participants.length} Learners
            </Button>
            <Button onClick={handleStart} disabled={startRun.isPending || assignGroups.isPending} data-testid="button-start-simulation">
              <Play className="w-4 h-4 mr-1.5" /> Start Simulation
            </Button>
          </div>
          
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-sm font-semibold mb-3">Learner Assignments</p>
            <div className="space-y-2">
              {participants.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No participants available.</p>
              ) : (
                participants.map((p) => {
                  const assignedGroupId = assignments.find((a) => a.userId === p.userId)?.groupId || '';
                  return (
                    <div key={p.userId} className="flex items-center justify-between gap-4 text-sm bg-muted/20 p-2 rounded-md border border-border/50" data-testid={`row-participant-${p.userId}`}>
                      <span className="truncate font-medium">{p.name}</span>
                      <Select
                        value={assignedGroupId}
                        onValueChange={(val) => handleSingleAssign(p.userId, val)}
                        disabled={assignGroups.isPending || startRun.isPending}
                      >
                        <SelectTrigger className="w-[220px]" data-testid={`select-group-${p.userId}`}>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {definition.groups.map(g => (
                            <SelectItem key={g.id} value={g.id} data-testid={`option-group-${g.id}`}>
                              {g.name} — {g.roleName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : run.status === 'live' ? (
        <div className="bg-card border border-primary/20 rounded-xl p-5 space-y-4 shadow-sm shadow-primary/5">
          <div className="flex items-center justify-between">
            <h4 className="font-display font-bold flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
              </span>
              Simulation is Live
            </h4>
            <div className="flex gap-2">
              {nextInject ? (
                <Button onClick={() => releaseInject.mutate({ sessionId })} disabled={releaseInject.isPending} data-testid="button-release-inject">
                  <Send className="w-4 h-4 mr-1.5" /> Release "{nextInject.title}"
                </Button>
              ) : (
                <Button onClick={() => transitionRun.mutate({ sessionId, data: { status: 'debrief' } })} disabled={transitionRun.isPending} data-testid="button-open-debrief">
                  <Target className="w-4 h-4 mr-1.5" /> Open Debrief
                </Button>
              )}
            </div>
          </div>
          
          <div className="pt-4 border-t border-border space-y-4">
            <h5 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Releases & Responses</h5>
            {studio.releases.map((rel: any, i: number) => {
              const inj = definition.injects.find(j => j.id === rel.injectId);
              if (!inj) return null;
              const responses = studio.responses.filter((r: any) => r.injectId === inj.id);
              return (
                <div key={rel.injectId} className="bg-muted/30 p-3 rounded-lg border border-border" data-testid={`card-release-${inj.id}`}>
                  <p className="font-semibold text-sm mb-2">{i + 1}. {inj.title}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {definition.groups.map(g => {
                      const resp = responses.find((r: any) => r.groupId === g.id);
                      return (
                        <div key={g.id} className="bg-card border border-border rounded p-2">
                          <p className="font-medium text-xs text-muted-foreground mb-1">{g.name}</p>
                          {resp ? <p>{resp.body}</p> : <p className="text-muted-foreground italic">Waiting for response...</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : run.status === 'debrief' ? (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-display font-bold">Debrief</h4>
            <Button variant="destructive" onClick={() => transitionRun.mutate({ sessionId, data: { status: 'ended' } })} disabled={transitionRun.isPending} data-testid="button-end-simulation">
              <Hand className="w-4 h-4 mr-1.5" /> End Simulation
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Learners can now see the debrief questions.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-5">
          <h4 className="font-display font-bold mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Simulation Ended
          </h4>
          <p className="text-sm text-muted-foreground">The simulation is complete.</p>
        </div>
      )}
    </div>
  );
}
