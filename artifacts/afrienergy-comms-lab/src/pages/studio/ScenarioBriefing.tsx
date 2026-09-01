import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetSimulation, useCreateSimulationRun, getGetSimulationQueryKey } from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { Button } from '@/components/ui/button';
import { Loader2, Users, Clock, Target, FileText, ShieldAlert, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

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
      toast({ title: "Could not open the brief", description: "Try again, or go back to the Studio.", variant: "destructive" });
      setLocation('/studio');
    }
  }, [error, setLocation, toast]);

  const handleLaunch = () => {
    createRun.mutate({ data: { simulationId: numericId } }, {
      onSuccess: (res) => {
        toast({ title: "Starting", description: "Taking you in." });
        setLocation(`/studio/run/${res.id}`);
      },
      onError: () => {
        toast({ title: "Could not start", description: "Try again in a moment.", variant: "destructive" });
      }
    });
  };

  if (!isValidId) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="font-display text-xl font-bold text-white mb-2 uppercase tracking-widest">We cannot find that exercise</h2>
          <p className="text-white/50 text-xs font-mono uppercase tracking-widest mb-6">The link may be wrong, or the exercise may have been removed.</p>
          <Button onClick={() => setLocation('/studio')} variant="outline" className="border-white/20 text-white hover:bg-white/10 rounded-none uppercase tracking-widest text-xs">
            Back to the Studio
          </Button>
        </div>
      </StudioLayout>
    );
  }

  if (isLoading || !sim) {
    return (
      <StudioLayout backTo="/studio">
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4 text-[#f97316]"
          >
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="font-mono font-bold uppercase tracking-[0.3em] text-[10px] animate-pulse">Opening the brief</p>
          </motion.div>
        </div>
      </StudioLayout>
    );
  }

  return (
    <StudioLayout backTo="/studio">
      <div className="container max-w-4xl mx-auto py-12 px-6 z-10 relative">

        {/* The brief, laid out like something handed to you. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-[#050b14] border border-white/10 p-8 md:p-12 relative shadow-2xl"
        >
          {/* Top secret stamps */}
          <div className="absolute top-6 right-6 border-2 border-red-500/50 text-red-500/50 font-bold uppercase tracking-[0.3em] text-[10px] px-3 py-1 rotate-12 select-none pointer-events-none mix-blend-screen">
            CONFIDENTIAL // NO DISTRIBUTION
          </div>

          <div className="flex items-center gap-3 text-white/40 text-[10px] font-mono uppercase tracking-[0.2em] mb-10 pb-4 border-b border-white/5">
            <ShieldAlert className="w-4 h-4 text-[#f97316]" />
            <span>Exercise {sim.id}</span>
            <span className="ml-auto text-white/20">{new Date().toISOString().split('T')[0]}</span>
          </div>

          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="font-display text-3xl md:text-5xl font-black tracking-tight text-white mb-6 leading-tight uppercase"
          >
            {sim.title || sim.sectorTopic}
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center gap-3 mb-12"
          >
            <div className="flex items-center gap-1.5 bg-[#f97316]/10 border border-[#f97316]/20 text-[#f97316] px-3 py-1.5 uppercase tracking-[0.15em] text-[10px] font-bold">
              <Target className="w-3.5 h-3.5" /> Threat: {sim.difficulty}
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/80 px-3 py-1.5 uppercase tracking-[0.15em] text-[10px] font-bold">
              <Clock className="w-3.5 h-3.5" /> Window: {sim.durationMinutes}m
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/80 px-3 py-1.5 uppercase tracking-[0.15em] text-[10px] font-bold">
              <Users className="w-3.5 h-3.5" /> {sim.mode === 'facilitated' ? 'With a room' : 'On your own'}
            </div>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/80 px-3 py-1.5 uppercase tracking-[0.15em] text-[10px] font-bold">
              <FileText className="w-3.5 h-3.5" /> Assign: {sim.participantPerspective}
            </div>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-12">
            <div className="md:col-span-2 space-y-10">
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <h2 className="text-[#f97316] font-mono uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#f97316] rounded-full" /> What you are practising
                </h2>
                <p className="text-white/90 text-sm md:text-base leading-relaxed font-sans">{sim.objective}</p>
              </motion.section>

              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="relative"
              >
                <h2 className="text-[#f97316] font-mono uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#f97316] rounded-full" /> Situation Report
                </h2>
                <div className="font-mono text-sm leading-relaxed text-white/70 space-y-4 whitespace-pre-wrap pl-4 border-l border-white/10">
                  {sim.openingBrief}
                </div>
              </motion.section>
            </div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 }}
              className="space-y-8"
            >
              <div>
                <h3 className="text-white/50 font-mono uppercase tracking-[0.2em] text-[10px] mb-4 border-b border-white/10 pb-2">
                  Who is involved
                </h3>
                <div className="space-y-3">
                  {sim.stakeholderGroups?.map((group: any) => (
                    <div key={group.id} className="bg-white/[0.02] border border-white/5 p-3 relative group">
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/10 group-hover:bg-[#f97316] transition-colors" />
                      <div className="font-bold text-white/90 text-xs font-display tracking-wider uppercase mb-1">{group.name}</div>
                      <div className="text-[10px] font-mono text-[#f97316] uppercase tracking-wider">{group.roleName}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-white/5">
                <Button
                  onClick={handleLaunch}
                  disabled={createRun.isPending}
                  className="w-full h-16 bg-[#f97316] hover:bg-white text-[#030811] hover:text-[#030811] font-black uppercase tracking-[0.2em] text-sm shadow-[0_0_20px_rgba(249,115,22,0.15)] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all rounded-none"
                >
                  {createRun.isPending ? (
                    <><Loader2 className="w-5 h-5 mr-3 animate-spin" /> Authorizing...</>
                  ) : (
                    <><Zap className="w-5 h-5 mr-3" /> Begin</>
                  )}
                </Button>

                <p className="text-center text-[9px] text-white/30 uppercase tracking-[0.2em] font-mono mt-4">
                  WARNING: Live clock begins upon entry
                </p>
              </div>
            </motion.div>
          </div>

        </motion.div>
      </div>
    </StudioLayout>
  );
}
