import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link, useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useCreateStudioAccessCode,
  useGenerateSimulation,
  useGetStudioAccess,
  useJoinSimulationRun,
  useListSimulations,
} from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Activity, Check, Clipboard, Loader2, Users, Clock, Hash, KeyRound, Radio, RefreshCw, Zap, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const generateSchema = z.object({
  sectorTopic: z.string().min(5, "Topic must be at least 5 characters"),
  objective: z.string().min(10, "Objective must be at least 10 characters"),
  difficulty: z.enum(['foundation', 'intermediate', 'advanced']),
  durationMinutes: z.coerce.number().min(5).max(240),
  participantPerspective: z.string().min(5, "Role perspective is required"),
  mode: z.enum(['autonomous', 'facilitated']),
});

const joinSchema = z.object({
  joinCode: z.string().trim().min(6, "A room code is six characters").max(12),
});

const FADE_UP = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -15 },
  transition: { duration: 0.3, ease: "easeOut" as const }
};

/**
 * What the server actually said went wrong.
 *
 * These calls fail for reasons a person can do something about: the AI is
 * busy, the daily allowance is spent, the room code was mistyped. "Generation
 * failed" told them none of it, so they pressed the button again.
 */
function reason(err: any, fallback: string): string {
  return err?.error || err?.data?.error || err?.message || fallback;
}

export default function StudioHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'new' | 'join'>('new');
  const [createdAccessCode, setCreatedAccessCode] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: simulations, isLoading: isLoadingSims } = useListSimulations();
  const { data: studioAccess } = useGetStudioAccess();
  const generateSim = useGenerateSimulation();
  const joinSim = useJoinSimulationRun();
  const createAccessCode = useCreateStudioAccessCode();

  const form = useForm<z.infer<typeof generateSchema>>({
    resolver: zodResolver(generateSchema),
    defaultValues: {
      sectorTopic: '',
      objective: '',
      difficulty: 'intermediate',
      durationMinutes: 30,
      participantPerspective: 'Head of Communications',
      mode: 'autonomous',
    }
  });

  const joinForm = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: { joinCode: '' }
  });

  function onSubmitGenerate(data: z.infer<typeof generateSchema>) {
    generateSim.mutate({ data }, {
      onSuccess: (res) => {
        toast({ title: "Your exercise is ready", description: "Read the brief, then begin when you are." });
        setLocation(`/studio/scenarios/${res.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Could not write the exercise", description: reason(err, "Something went wrong. Try again."), variant: "destructive" });
      }
    });
  }

  function onSubmitJoin(data: z.infer<typeof joinSchema>) {
    joinSim.mutate({ data }, {
      onSuccess: (res) => {
        toast({ title: "You are in", description: "Taking you to the room." });
        setLocation(`/studio/run/${res.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Could not join", description: reason(err, "Check the room code and try again."), variant: "destructive" });
      }
    });
  }

  function handleCreateAccessCode() {
    createAccessCode.mutate(undefined, {
      onSuccess: ({ code }) => {
        setCreatedAccessCode(code);
        setCopied(false);
      },
      onError: (err: any) => {
        toast({ title: "Could not make a code", description: reason(err, "Try again in a moment."), variant: "destructive" });
      },
    });
  }

  async function copyAccessCode() {
    await navigator.clipboard.writeText(createdAccessCode);
    setCopied(true);
  }

  return (
    <StudioLayout>
      <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden z-10">

        {/* Left: writing a new exercise, and joining a room. */}
        <div className="lg:w-7/12 flex flex-col border-r border-white/5 bg-[#030811] relative h-full overflow-y-auto">
          <div className="p-8 md:p-12 max-w-2xl w-full mx-auto">

            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 bg-[#f97316] rounded-full animate-pulse" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#f97316]">Ready</span>
              </div>
              {/* The masthead already says Simulation Studio. This says what to do. */}
              <h1 className="font-display text-4xl font-bold tracking-tight text-white mb-3">Practise something</h1>
              <p className="text-white/50 text-sm leading-relaxed">Write an exercise to work through on your own, or join a room somebody else is running.</p>
            </motion.div>

            {studioAccess?.isAdmin && (
              <motion.div {...FADE_UP} className="mb-10 p-5 bg-white/[0.02] border border-white/10 rounded-none relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-[#f97316]" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-1">
                      <KeyRound className="w-4 h-4 text-[#f97316]" /> Learner Access
                    </h3>
                    <p className="text-xs text-white/50">Create a one-time code so a learner can use the Studio.</p>
                  </div>

                  {createdAccessCode ? (
                    <div className="flex items-center gap-2">
                      <div className="bg-[#030811] border border-white/20 px-4 py-2 text-sm font-mono tracking-widest text-white">
                        {createdAccessCode}
                      </div>
                      <Button variant="outline" onClick={copyAccessCode} className="h-9 w-9 p-0 border-white/20 bg-transparent text-white hover:bg-white/10 rounded-none">
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Clipboard className="w-4 h-4" />}
                      </Button>
                      <Button onClick={handleCreateAccessCode} className="h-9 bg-white/10 text-white hover:bg-white/20 rounded-none text-xs uppercase tracking-wider">
                        Refresh
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={handleCreateAccessCode} disabled={createAccessCode.isPending} className="bg-[#f97316] text-[#030811] hover:bg-[#ea6d0a] rounded-none uppercase tracking-wider text-xs h-10 px-6">
                      {createAccessCode.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Make a code
                    </Button>
                  )}
                </div>
              </motion.div>
            )}

            <div className="flex bg-white/5 p-1 rounded-none border border-white/10 w-fit mb-8">
              <button
                onClick={() => setActiveTab('new')}
                className={cn("px-6 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-none", activeTab === 'new' ? 'bg-[#f97316] text-[#030811]' : 'text-white/50 hover:text-white')}
              >
                New exercise
              </button>
              <button
                onClick={() => setActiveTab('join')}
                className={cn("px-6 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-none", activeTab === 'join' ? 'bg-[#f97316] text-[#030811]' : 'text-white/50 hover:text-white')}
              >
                Join a room
              </button>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === 'new' && (
                <motion.div key="new" {...FADE_UP}>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmitGenerate)} className="space-y-6">

                      <div className="space-y-6 bg-white/[0.01] border border-white/5 p-6 relative">
                        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-white/20" />
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-white/20" />

                        <FormField
                          control={form.control}
                          name="sectorTopic"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">What is it about</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Subsea pipeline breach off the coast of Lagos" className="bg-[#030811] border-white/10 text-white placeholder:text-white/20 focus-visible:ring-1 focus-visible:ring-[#f97316] focus-visible:border-[#f97316] rounded-none h-12" {...field} />
                              </FormControl>
                              <FormMessage className="text-xs text-red-400 font-mono" />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="objective"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">What should they get better at</FormLabel>
                              <FormControl>
                                <Textarea placeholder="e.g. Practice stakeholder communication and media holding statements under high pressure." className="bg-[#030811] border-white/10 text-white placeholder:text-white/20 focus-visible:ring-1 focus-visible:ring-[#f97316] focus-visible:border-[#f97316] rounded-none min-h-[100px] resize-none" {...field} />
                              </FormControl>
                              <FormMessage className="text-xs text-red-400 font-mono" />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField
                            control={form.control}
                            name="participantPerspective"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">Whose job are they doing</FormLabel>
                                <FormControl>
                                  <Input placeholder="e.g. Comms Director" className="bg-[#030811] border-white/10 text-white placeholder:text-white/20 focus-visible:ring-1 focus-visible:ring-[#f97316] focus-visible:border-[#f97316] rounded-none h-12" {...field} />
                                </FormControl>
                                <FormMessage className="text-xs text-red-400 font-mono" />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="mode"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">How it runs</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="bg-[#030811] border-white/10 text-white focus:ring-1 focus:ring-[#f97316] rounded-none h-12">
                                      <SelectValue placeholder="Choose one" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="bg-[#07111e] border-white/10 text-white rounded-none">
                                    <SelectItem value="autonomous">On their own</SelectItem>
                                    <SelectItem value="facilitated">With a room</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="text-xs text-red-400 font-mono" />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField
                            control={form.control}
                            name="difficulty"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">Level</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="bg-[#030811] border-white/10 text-white focus:ring-1 focus:ring-[#f97316] rounded-none h-12">
                                      <SelectValue placeholder="Choose one" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="bg-[#07111e] border-white/10 text-white rounded-none">
                                    <SelectItem value="foundation">Foundation</SelectItem>
                                    <SelectItem value="intermediate">Intermediate</SelectItem>
                                    <SelectItem value="advanced">Advanced</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="text-xs text-red-400 font-mono" />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="durationMinutes"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">How long, in minutes</FormLabel>
                                <FormControl>
                                  <Input type="number" min={5} max={240} className="bg-[#030811] border-white/10 text-white focus-visible:ring-1 focus-visible:ring-[#f97316] focus-visible:border-[#f97316] rounded-none h-12" {...field} />
                                </FormControl>
                                <FormMessage className="text-xs text-red-400 font-mono" />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        className="w-full bg-[#f97316] hover:bg-[#ea6d0a] text-[#030811] font-bold uppercase tracking-[0.2em] h-14 transition-all active:scale-[0.99] rounded-none"
                        disabled={generateSim.isPending}
                      >
                        {generateSim.isPending ? (
                          <><Loader2 className="mr-3 h-5 w-5 animate-spin" /> Synthesizing Scenario...</>
                        ) : (
                          <><Zap className="mr-3 h-5 w-5" /> Compile & Launch</>
                        )}
                      </Button>
                    </form>
                  </Form>
                </motion.div>
              )}

              {activeTab === 'join' && (
                <motion.div key="join" {...FADE_UP} className="max-w-md">
                  <div className="bg-[#030811] border border-[#f97316]/30 p-8 relative shadow-[0_0_30px_rgba(249,115,22,0.05)]">
                    <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#f97316]" />
                    <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#f97316]" />
                    <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#f97316]" />
                    <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#f97316]" />

                    <h2 className="text-[#f97316] font-mono text-sm uppercase tracking-widest mb-6 text-center">Join a room</h2>

                    <Form {...joinForm}>
                      <form onSubmit={joinForm.handleSubmit(onSubmitJoin)} className="space-y-6">
                        <FormField
                          control={joinForm.control}
                          name="joinCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <div className="relative">
                                  <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                                  <Input
                                    placeholder="KD7X9M" maxLength={12} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                                    className="bg-black/50 border-[#f97316]/30 text-[#f97316] placeholder:text-[#f97316]/20 h-16 pl-12 text-2xl tracking-[0.3em] font-mono focus-visible:ring-1 focus-visible:ring-[#f97316] rounded-none text-center"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage className="text-xs text-red-400 font-mono text-center" />
                            </FormItem>
                          )}
                        />

                        <Button
                          type="submit"
                          className="w-full bg-[#f97316] text-[#030811] hover:bg-[#ea6d0a] font-bold uppercase tracking-[0.2em] h-14 transition-all active:scale-[0.98] rounded-none"
                          disabled={joinSim.isPending}
                        >
                          {joinSim.isPending ? (
                            <><Loader2 className="mr-3 h-5 w-5 animate-spin" /> Patching in...</>
                          ) : (
                            <><Radio className="mr-3 h-5 w-5" /> Connect to Grid</>
                          )}
                        </Button>
                      </form>
                    </Form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>
        </div>

        {/* Right Column: Mission Logs */}
        <div className="lg:w-5/12 flex flex-col bg-[#050b14] relative h-full">
          <div className="h-16 border-b border-white/5 flex items-center px-8 shrink-0 bg-[#030811]/50 backdrop-blur-sm z-10">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Mission Logs
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-8">
            {isLoadingSims ? (
              <div className="h-full flex items-center justify-center text-[#f97316]">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : !simulations || simulations.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-white/30 text-center px-8">
                <Activity className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm font-mono uppercase tracking-widest mb-1">Nothing here yet</p>
                <p className="text-xs">Write your first exercise on the left.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {simulations.map((sim: any, i: number) => (
                  <motion.div
                    key={sim.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link href={`/studio/scenarios/${sim.id}`}>
                      <div className="group block p-5 border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-[#f97316]/30 transition-all cursor-pointer relative overflow-hidden rounded-none">
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-transparent group-hover:bg-[#f97316] transition-colors" />

                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-bold text-white/90 text-base line-clamp-1 group-hover:text-[#f97316] transition-colors font-display tracking-wide">
                            {sim.title || sim.sectorTopic || 'Untitled exercise'}
                          </h3>
                          <span className={cn(
                            "shrink-0 text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1 border rounded-none ml-3",
                            sim.difficulty === 'advanced' ? 'text-red-400 border-red-400/30 bg-red-400/5' :
                            sim.difficulty === 'intermediate' ? 'text-[#f97316] border-[#f97316]/30 bg-[#f97316]/5' :
                            'text-green-400 border-green-400/30 bg-green-400/5'
                          )}>
                            {sim.difficulty}
                          </span>
                        </div>

                        <p className="text-xs text-white/50 line-clamp-2 mb-4 leading-relaxed font-mono">
                          {sim.objective}
                        </p>

                        <div className="flex items-center gap-4 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#f97316]/70" /> {sim.durationMinutes}m</div>
                          <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-[#f97316]/70" /> {sim.mode}</div>
                          {sim.createdAt && (
                            <div className="ml-auto opacity-50">
                              {format(new Date(sim.createdAt), 'dd.MM.yy')}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </StudioLayout>
  );
}
