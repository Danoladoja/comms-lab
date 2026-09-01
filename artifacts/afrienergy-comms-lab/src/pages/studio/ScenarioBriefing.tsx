import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetSimulation, useCreateSimulationRun, getGetSimulationQueryKey } from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Play, Users, Clock, Target, FileText, ChevronRight, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ScenarioBriefing({ id }: { id?: string }) {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const parsedId = id ? parseInt(id, 10) : 0;
  const isValidId = !isNaN(parsedId) && parsedId > 0;
  const numericId = isValidId ? parsedId : 0;
  
  const { data: sim, isLoading, error } = useGetSimulation(numericId, { query: { enabled: isValidId, queryKey: getGetSimulationQueryKey(numericId) } });
  const createRun = useCreateSimulationRun();

  useEffect(() => {
    if (error) {
      toast({ title: "Error", description: "Failed to load scenario briefing.", variant: "destructive" });
      setLocation('/studio');
    }
  }, [error, setLocation, toast]);

  const handleLaunch = () => {
    createRun.mutate({ data: { simulationId: numericId } }, {
      onSuccess: (res) => {
        toast({ title: "Simulation Launched", description: "Entering environment..." });
        setLocation(`/studio/run/${res.id}`);
      },
      onError: () => {
        toast({ title: "Launch failed", description: "Failed to launch simulation. Please try again.", variant: "destructive" });
      }
    });
  };

  if (!isValidId) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="font-display text-xl font-bold text-white mb-2">Invalid Briefing Link</h2>
          <p className="text-white/60 text-sm mb-6">The scenario ID is malformed or missing.</p>
          <Button onClick={() => setLocation('/studio')} variant="outline" className="border-white/20 text-white hover:bg-white/10">
            Return to Command Center
          </Button>
        </div>
      </StudioLayout>
    );
  }

  if (isLoading || !sim) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-[#f97316]">
            <Loader2 className="w-12 h-12 animate-spin" />
            <p className="font-display font-bold uppercase tracking-widest text-sm animate-pulse">Decrypting Briefing...</p>
          </div>
        </div>
      </StudioLayout>
    );
  }

  // The generated hook response type is StudioSimulation.
  // properties: title, sectorTopic, objective, difficulty, durationMinutes, participantPerspective, mode, openingBrief, stakeholderGroups...

  return (
    <StudioLayout backTo="/studio">
      <div className="container max-w-5xl mx-auto py-10 px-6 z-10">
        
        <div className="flex items-center gap-2 text-white/50 text-xs font-bold uppercase tracking-widest mb-6">
          <ShieldAlert className="w-4 h-4 text-[#f97316]" />
          <span>Confidential Briefing Document</span>
        </div>

        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
          {sim.title || sim.sectorTopic}
        </h1>
        
        <div className="flex flex-wrap items-center gap-4 mb-10 text-sm font-medium">
          <div className="flex items-center gap-1.5 bg-[#f97316]/10 text-[#f97316] px-3 py-1.5 rounded uppercase tracking-wider text-xs font-bold">
            <Target className="w-4 h-4" /> {sim.difficulty}
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 text-white/80 px-3 py-1.5 rounded uppercase tracking-wider text-xs font-bold">
            <Clock className="w-4 h-4" /> {sim.durationMinutes} Minutes
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 text-white/80 px-3 py-1.5 rounded uppercase tracking-wider text-xs font-bold">
            <Users className="w-4 h-4" /> {sim.mode}
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 text-white/80 px-3 py-1.5 rounded uppercase tracking-wider text-xs font-bold">
            <FileText className="w-4 h-4" /> Role: {sim.participantPerspective}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-8">
            <section className="bg-[#0c1929] border border-white/10 rounded-xl p-6 md:p-8 shadow-xl">
              <h2 className="text-[#f97316] font-bold uppercase tracking-widest text-xs mb-4 flex items-center gap-2 border-b border-white/10 pb-4">
                <Target className="w-4 h-4" /> Learning Objective
              </h2>
              <p className="text-white/90 text-lg leading-relaxed">{sim.objective}</p>
            </section>

            <section className="bg-[#0c1929] border border-white/10 rounded-xl p-6 md:p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-[#f97316]"></div>
              <h2 className="text-[#f97316] font-bold uppercase tracking-widest text-xs mb-4 flex items-center gap-2 border-b border-white/10 pb-4">
                <FileText className="w-4 h-4" /> Situation Report
              </h2>
              <div className="prose prose-invert prose-p:text-white/80 prose-p:leading-relaxed max-w-none">
                {sim.openingBrief.split('\n').map((paragraph: string, i: number) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <Card className="bg-[#0c1929] border-white/10 shadow-xl">
              <CardContent className="p-6">
                <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#f97316]" /> Key Stakeholders
                </h3>
                <div className="space-y-4">
                  {sim.stakeholderGroups?.map((group: any) => (
                    <div key={group.id} className="bg-[#07111e] border border-white/5 rounded-lg p-3">
                      <div className="font-bold text-white/90 text-sm">{group.name}</div>
                      <div className="text-xs text-[#f97316] mt-0.5">{group.roleName}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleLaunch}
              disabled={createRun.isPending}
              className="w-full h-16 bg-[#f97316] hover:bg-[#ea6d0a] text-[#07111e] font-black uppercase tracking-widest text-lg shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)] transition-all"
            >
              {createRun.isPending ? (
                <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> Initializing...</>
              ) : (
                <><Play className="w-6 h-6 mr-3 fill-current" /> Begin Simulation</>
              )}
            </Button>
            
            <p className="text-center text-xs text-white/40 uppercase tracking-wider font-bold">
              Warning: Timer begins immediately upon entry
            </p>
          </div>
        </div>

      </div>
    </StudioLayout>
  );
}
