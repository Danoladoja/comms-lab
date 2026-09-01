import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link, useLocation } from 'wouter';
import { useListSimulations, useGenerateSimulation, useJoinSimulationRun } from '@workspace/api-client-react';
import { StudioLayout } from '@/components/simulation/StudioLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Loader2, Plus, Users, Clock, Target, PlayCircle, ChevronRight, Hash } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const generateSchema = z.object({
  sectorTopic: z.string().min(5, "Topic must be at least 5 characters"),
  objective: z.string().min(10, "Objective must be at least 10 characters"),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  durationMinutes: z.coerce.number().min(5).max(240),
  participantPerspective: z.string().min(5, "Role perspective is required"),
  mode: z.enum(['autonomous', 'facilitated']),
});

const joinSchema = z.object({
  joinCode: z.string().min(6, "Join code must be at least 6 characters").max(32),
});

export default function StudioHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'new' | 'join'>('new');
  
  const { data: simulations, isLoading: isLoadingSims } = useListSimulations();
  const generateSim = useGenerateSimulation();
  const joinSim = useJoinSimulationRun();

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
        toast({ title: "Scenario Generated", description: "Your simulation environment is ready." });
        setLocation(`/studio/scenarios/${res.id}`);
      },
      onError: () => {
        toast({ title: "Generation failed", description: "Failed to generate scenario. Please try again.", variant: "destructive" });
      }
    });
  }

  function onSubmitJoin(data: z.infer<typeof joinSchema>) {
    joinSim.mutate({ data }, {
      onSuccess: (res) => {
        toast({ title: "Room Joined", description: "Entering simulation..." });
        setLocation(`/studio/run/${res.id}`);
      },
      onError: () => {
        toast({ title: "Join failed", description: "Failed to join room. Please check the access code.", variant: "destructive" });
      }
    });
  }

  return (
    <StudioLayout>
      <div className="container max-w-6xl mx-auto py-12 px-6 flex flex-col lg:flex-row gap-12 h-full z-10">
        
        {/* Left Column: Create or Join */}
        <div className="lg:w-1/2 flex flex-col gap-6">
          <div className="mb-4">
            <h1 className="font-display text-4xl font-bold tracking-tight text-white mb-2">Simulation Command</h1>
            <p className="text-white/60 text-lg">Generate new high-stakes scenarios or join a facilitated live room.</p>
          </div>

          <div className="flex bg-[#0c1929] rounded-lg p-1 border border-white/10 w-fit mb-2">
            <button
              onClick={() => setActiveTab('new')}
              className={`px-6 py-2.5 text-sm font-bold uppercase tracking-wider rounded-md transition-colors ${activeTab === 'new' ? 'bg-[#f97316] text-[#07111e]' : 'text-white/60 hover:text-white'}`}
            >
              New Scenario
            </button>
            <button
              onClick={() => setActiveTab('join')}
              className={`px-6 py-2.5 text-sm font-bold uppercase tracking-wider rounded-md transition-colors ${activeTab === 'join' ? 'bg-[#f97316] text-[#07111e]' : 'text-white/60 hover:text-white'}`}
            >
              Join Room
            </button>
          </div>

          {activeTab === 'new' && (
            <Card className="bg-[#0c1929] border-white/10 shadow-xl rounded-xl">
              <CardHeader className="border-b border-white/5 pb-6">
                <CardTitle className="text-2xl text-white font-display">Configure Scenario</CardTitle>
                <CardDescription className="text-white/50 text-base">
                  Define the parameters for the AI to generate a bespoke crisis or media situation.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmitGenerate)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="sectorTopic"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Sector & Topic</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Oil spill off the coast of Nigeria" className="bg-[#07111e] border-white/20 text-white placeholder:text-white/30 focus-visible:ring-[#f97316]" {...field} />
                          </FormControl>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="objective"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Learning Objective</FormLabel>
                          <FormControl>
                            <Textarea placeholder="e.g. Practice stakeholder communication and media holding statements under pressure." className="bg-[#07111e] border-white/20 text-white placeholder:text-white/30 min-h-[80px] focus-visible:ring-[#f97316]" {...field} />
                          </FormControl>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-5">
                      <FormField
                        control={form.control}
                        name="difficulty"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Difficulty</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="bg-[#07111e] border-white/20 text-white focus:ring-[#f97316]">
                                  <SelectValue placeholder="Select difficulty" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="bg-[#0c1929] border-white/20 text-white">
                                <SelectItem value="beginner">Beginner</SelectItem>
                                <SelectItem value="intermediate">Intermediate</SelectItem>
                                <SelectItem value="advanced">Advanced</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-red-400" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="durationMinutes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Duration (Mins)</FormLabel>
                            <FormControl>
                              <Input type="number" min={5} max={240} className="bg-[#07111e] border-white/20 text-white focus-visible:ring-[#f97316]" {...field} />
                            </FormControl>
                            <FormMessage className="text-red-400" />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                      <FormField
                        control={form.control}
                        name="participantPerspective"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Your Role</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Comms Director" className="bg-[#07111e] border-white/20 text-white placeholder:text-white/30 focus-visible:ring-[#f97316]" {...field} />
                            </FormControl>
                            <FormMessage className="text-red-400" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="mode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Mode</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="bg-[#07111e] border-white/20 text-white focus:ring-[#f97316]">
                                  <SelectValue placeholder="Select mode" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="bg-[#0c1929] border-white/20 text-white">
                                <SelectItem value="autonomous">Autonomous (Solo)</SelectItem>
                                <SelectItem value="facilitated">Facilitated (Group)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-red-400" />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full bg-[#f97316] hover:bg-[#ea6d0a] text-[#07111e] font-bold uppercase tracking-widest h-12 mt-4 transition-transform active:scale-[0.98]"
                      disabled={generateSim.isPending}
                    >
                      {generateSim.isPending ? (
                        <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Generating AI Scenario...</>
                      ) : (
                        <><Target className="mr-2 h-5 w-5" /> Initialize Scenario</>
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {activeTab === 'join' && (
            <Card className="bg-[#0c1929] border-white/10 shadow-xl rounded-xl overflow-hidden">
              <div className="h-2 bg-[#f97316]" />
              <CardHeader className="pb-6">
                <CardTitle className="text-2xl text-white font-display">Join Facilitated Room</CardTitle>
                <CardDescription className="text-white/50 text-base">
                  Enter the access code provided by your session facilitator.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...joinForm}>
                  <form onSubmit={joinForm.handleSubmit(onSubmitJoin)} className="space-y-6">
                    <FormField
                      control={joinForm.control}
                      name="joinCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white/80 uppercase text-xs font-bold tracking-wider">Access Code</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                              <Input 
                                placeholder="Enter code" 
                                className="bg-[#07111e] border-white/20 text-white placeholder:text-white/30 h-14 pl-12 text-xl tracking-widest font-mono focus-visible:ring-[#f97316]" 
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />
                    
                    <Button 
                      type="submit" 
                      className="w-full bg-white text-[#07111e] hover:bg-white/90 font-bold uppercase tracking-widest h-14 transition-transform active:scale-[0.98]"
                      disabled={joinSim.isPending}
                    >
                      {joinSim.isPending ? (
                        <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Connecting...</>
                      ) : (
                        <><Users className="mr-2 h-5 w-5" /> Enter Room</>
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Recent Scenarios */}
        <div className="lg:w-1/2 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-xl font-bold text-white">Recent Briefings</h2>
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">Archive</span>
          </div>
          
          <div className="flex-1 bg-[#0c1929]/50 border border-white/5 rounded-xl p-4 overflow-y-auto min-h-[400px]">
            {isLoadingSims ? (
              <div className="h-full flex items-center justify-center text-white/40">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : !simulations || simulations.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-white/40 text-center px-8">
                <Activity className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-lg font-medium mb-1">No Scenarios Found</p>
                <p className="text-sm">Generate your first scenario to begin practice.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {simulations.map((sim: any) => (
                  <Link key={sim.id} href={`/studio/scenarios/${sim.id}`}>
                    <div className="block p-4 rounded-lg bg-[#07111e] border border-white/10 hover:border-[#f97316]/50 transition-colors cursor-pointer group">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-white text-lg line-clamp-1 group-hover:text-[#f97316] transition-colors">
                          {sim.title || sim.sectorTopic || 'Untitled Scenario'}
                        </h3>
                        <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-[#f97316] bg-[#f97316]/10 px-2 py-1 rounded">
                          {sim.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-white/60 line-clamp-2 mb-4">
                        {sim.objective}
                      </p>
                      <div className="flex items-center gap-4 text-xs font-medium text-white/40 uppercase tracking-wider">
                        <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {sim.durationMinutes}m</div>
                        <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {sim.mode}</div>
                        {sim.createdAt && (
                          <div className="flex items-center gap-1.5 ml-auto">
                            {format(new Date(sim.createdAt), 'MMM d, yyyy')}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </StudioLayout>
  );
}
