import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link, useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useCreateStudioAccessCode,
  useGrantStudioAccessToProgramme,
  useListPrograms,
  useGenerateSimulation,
  useGetStudioAccess,
  useJoinSimulationRun,
  useListSimulations,

  useGetStudioRecord,} from '@workspace/api-client-react';
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
  programId: z.number().int().positive().optional(),
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
  const [createdAccessCodes, setCreatedAccessCodes] = useState<string[]>([]);
  const [codeCount, setCodeCount] = useState(5);
  const [copied, setCopied] = useState(false);
  const [cohortProgramId, setCohortProgramId] = useState('');

  const { data: simulations, isLoading: isLoadingSims } = useListSimulations();
  const { data: studioAccess } = useGetStudioAccess();
  const { data: record } = useGetStudioRecord();
  const generateSim = useGenerateSimulation();
  const joinSim = useJoinSimulationRun();
  const createAccessCode = useCreateStudioAccessCode();
  const grantToCohort = useGrantStudioAccessToProgramme();
  // Programmes, modules and who is on them: the Studio reads the same catalogue
  // as the rest of the Lab rather than keeping a list of its own.
  const { data: programmes = [] } = useListPrograms();
  const programmeById = new Map(programmes.map((p: any) => [p.id, p]));

  const form = useForm<z.infer<typeof generateSchema>>({
    resolver: zodResolver(generateSchema),
    defaultValues: {
      sectorTopic: '',
      objective: '',
      difficulty: 'intermediate',
      durationMinutes: 30,
      participantPerspective: 'Head of Communications',
      mode: 'autonomous',
      programId: undefined,
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

  function handleCreateAccessCodes() {
    createAccessCode.mutate({ data: { count: codeCount } }, {
      onSuccess: ({ codes, code }) => {
        // Shown once. Only a digest is kept, so there is no screen that can
        // show them again: the admin has to copy them now.
        setCreatedAccessCodes(codes?.length ? codes : code ? [code] : []);
        setCopied(false);
      },
      onError: (err: any) => {
        toast({ title: "Could not make the codes", description: reason(err, "Try again in a moment."), variant: "destructive" });
      },
    });
  }

  async function copyAccessCodes() {
    await navigator.clipboard.writeText(createdAccessCodes.join('\n'));
    setCopied(true);
  }

  function handleOpenToCohort() {
    const programId = Number(cohortProgramId);
    if (!programId) return;
    grantToCohort.mutate({ programId }, {
      onSuccess: (r: any) => {
        const parts = [
          r.granted === 0 ? 'Everybody on it already had access.' : `${r.granted} of ${r.enrolled} now have access.`,
          !r.emailConfigured ? 'No email was sent: the server has no mail provider.'
            : r.emailed > 0 ? `${r.emailed} were emailed a link.` : '',
          r.emailFailed > 0 ? `${r.emailFailed} could not be emailed, but they still have access.` : '',
        ].filter(Boolean);
        toast({ title: `${r.programmeTitle} can use the Studio`, description: parts.join(' ') });
      },
      onError: (err: any) => {
        toast({ title: "Could not open the Studio to them", description: reason(err, "Try again in a moment."), variant: "destructive" });
      },
    });
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
              <motion.div {...FADE_UP} className="mb-10 space-y-4">

                {/* One press: everybody on a programme gets in, and hears about it. */}
                <div className="p-5 bg-white/[0.02] border border-white/10 relative">
                  <div className="absolute top-0 left-0 w-1 h-full bg-[#f97316]" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-[#f97316]" aria-hidden /> Open the Studio to a cohort
                  </h3>
                  <p className="text-xs text-white/50 mb-4">
                    Everybody enrolled on the programme gets access and an email with a link. Anyone who already has access is left alone.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Select value={cohortProgramId} onValueChange={setCohortProgramId}>
                      <SelectTrigger className="bg-[#030811] border-white/20 text-white rounded-none flex-1">
                        <SelectValue placeholder="Choose a programme" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0c1929] border-white/20 text-white">
                        {programmes.map((programme: any) => (
                          <SelectItem key={programme.id} value={String(programme.id)}>
                            {programme.title}{typeof programme.enrolledCount === 'number' ? ` — ${programme.enrolledCount} enrolled` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleOpenToCohort}
                      disabled={!cohortProgramId || grantToCohort.isPending}
                      className="bg-[#f97316] text-[#030811] hover:bg-[#ea6d0a] rounded-none uppercase tracking-wider text-xs h-10 px-6 shrink-0"
                    >
                      {grantToCohort.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Users className="mr-2 h-4 w-4" aria-hidden />}
                      Open it to them
                    </Button>
                  </div>
                </div>

                {/* And for everybody else: a handful of codes, in one press. */}
                <div className="p-5 bg-white/[0.02] border border-white/10 relative">
                  <div className="absolute top-0 left-0 w-1 h-full bg-white/20" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-1">
                    <KeyRound className="w-4 h-4 text-[#f97316]" aria-hidden /> Access codes
                  </h3>
                  <p className="text-xs text-white/50 mb-4">
                    For anybody not on a programme. Each code lets one person in, once. They are shown here once and cannot be looked up again.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center gap-2">
                      <label htmlFor="code-count" className="text-[10px] uppercase tracking-widest text-white/40 font-bold">How many</label>
                      <Input
                        id="code-count" type="number" min={1} max={50} value={codeCount}
                        onChange={(e) => setCodeCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                        className="w-20 bg-[#030811] border-white/20 text-white rounded-none"
                      />
                    </div>
                    <Button
                      onClick={handleCreateAccessCodes}
                      disabled={createAccessCode.isPending}
                      className="bg-white/10 text-white hover:bg-white/20 rounded-none uppercase tracking-wider text-xs h-10 px-6"
                    >
                      {createAccessCode.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-2 h-4 w-4" aria-hidden />}
                      {createdAccessCodes.length > 0 ? 'Make more' : 'Make them'}
                    </Button>
                  </div>

                  {createdAccessCodes.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] uppercase tracking-widest text-[#f97316] font-bold">
                          Copy these now
                        </p>
                        <Button variant="outline" onClick={copyAccessCodes} className="h-8 border-white/20 bg-transparent text-white hover:bg-white/10 rounded-none text-xs">
                          {copied ? <><Check className="w-3.5 h-3.5 mr-1.5 text-green-400" aria-hidden /> Copied</> : <><Clipboard className="w-3.5 h-3.5 mr-1.5" aria-hidden /> Copy all</>}
                        </Button>
                      </div>
                      <div className="bg-[#030811] border border-white/20 p-3 max-h-40 overflow-y-auto">
                        {createdAccessCodes.map((code) => (
                          <p key={code} className="font-mono text-sm tracking-widest text-white">{code}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </motion.div>
            )}

            {/*
              What they have actually done.
              No rank, no badge, nobody else's number. Senior people do not
              practise where they are scored against their peers; they practise
              where they can be bad at something privately and watch it move.
              This is the watching-it-move part, which no single run can show.
            */}
            {record && record.runs > 0 && (
              <motion.div {...FADE_UP} className="mb-10 p-5 bg-white/[0.02] border border-white/10">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-4">
                  <Activity className="w-4 h-4 text-[#f97316]" aria-hidden /> Your practice
                </h3>

                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div>
                    <p className="font-display text-3xl font-bold text-white tabular-nums">{record.runs}</p>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">
                      {record.runs === 1 ? 'exercise' : 'exercises'}
                    </p>
                  </div>
                  <div>
                    <p className="font-display text-3xl font-bold text-white tabular-nums">
                      {record.minutes >= 60 ? `${Math.round(record.minutes / 60)}h` : `${record.minutes}m`}
                    </p>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">practised</p>
                  </div>
                  <div>
                    <p className="font-display text-3xl font-bold text-[#f97316] tabular-nums">{record.latestScore ?? '—'}</p>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mt-1">
                      most recent{record.bestScore !== null && record.bestScore !== record.latestScore ? ` · best ${record.bestScore}` : ''}
                    </p>
                  </div>
                </div>

                {record.trend.length > 1 && (
                  <div className="flex items-end gap-1.5 h-12 mb-5" role="img"
                       aria-label={`Scores across your last ${record.trend.length} exercises: ${record.trend.map((t: any) => t.score).join(', ')}`}>
                    {record.trend.map((point: any, i: number) => (
                      <div key={i} className="flex-1 bg-[#f97316]/70 min-h-[2px]" style={{ height: `${Math.max(4, point.score)}%` }} title={`${point.title}: ${point.score}`} />
                    ))}
                  </div>
                )}

                {record.strengths.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-5 pt-4 border-t border-white/10">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Reliably strong</p>
                      {record.strengths.map((d: any) => (
                        <p key={d.name} className="text-sm text-white/80 flex justify-between gap-3">
                          <span>{d.name}</span><span className="text-white/40 font-mono tabular-nums">{d.score}</span>
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Has not moved yet</p>
                      {record.toWorkOn.map((d: any) => (
                        <p key={d.name} className="text-sm text-white/80 flex justify-between gap-3">
                          <span>{d.name}</span><span className="text-white/40 font-mono tabular-nums">{d.score}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
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

                    {studioAccess?.isAdmin && programmes.length > 0 && (
                      <FormField
                        control={form.control}
                        name="programId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[10px] uppercase text-white/50 font-bold tracking-[0.15em]">Write it for a programme</FormLabel>
                            <Select
                              value={field.value ? String(field.value) : 'none'}
                              onValueChange={(v) => field.onChange(v === 'none' ? undefined : Number(v))}
                            >
                              <FormControl>
                                <SelectTrigger className="bg-[#07111e] border-white/20 text-white rounded-none">
                                  <SelectValue placeholder="Nobody in particular" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="bg-[#0c1929] border-white/20 text-white">
                                <SelectItem value="none">Nobody in particular</SelectItem>
                                {programmes.map((programme: any) => (
                                  <SelectItem key={programme.id} value={String(programme.id)}>{programme.title}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-white/40 leading-relaxed">
                              {field.value
                                ? "The scenario will be built around what this cohort is studying, and everybody enrolled will be able to work through it."
                                : "Choose a programme and the scenario is built around its modules, and the whole cohort can work through it."}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
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

                        {sim.programId && (
                          <p className="text-[10px] uppercase tracking-widest text-[#f97316]/80 font-bold mb-2">
                            {programmeById.get(sim.programId)?.title ?? 'For a programme'}
                          </p>
                        )}

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
