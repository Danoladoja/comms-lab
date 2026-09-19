import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Activity, Clock, Loader2, RefreshCw, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The exercises somebody can actually open, for somebody who is not an admin.
 *
 * Lifted out of the Studio page unchanged when the admin's half of that column
 * became the cohort instead. It lists exercises, which is the right unit for a
 * person who has a handful of their own and the wrong one for an admin, who
 * sees every private copy the Studio generates for every learner.
 */
export default function MissionLogs({ simulations, isLoading, programmeById }: {
  simulations: any[] | undefined;
  isLoading: boolean;
  programmeById: Map<number, any>;
}) {
  const isLoadingSims = isLoading;
  return (
    <>
          <div className="h-16 border-b border-white/5 flex items-center px-6 sm:px-8 shrink-0 bg-[#030811]/50 backdrop-blur-sm z-10">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Mission Logs
            </span>
          </div>

          <div className="flex-1 lg:overflow-y-auto lg:min-h-0 p-6 sm:p-8">
            {isLoadingSims ? (
              <div className="py-24 flex items-center justify-center text-[#f97316]">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : !simulations || simulations.length === 0 ? (
              <div className="py-24 flex flex-col items-center justify-center text-white/30 text-center">
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
                    {/*
                      Where an entry leads depends on what the reader has
                      already done with it. A finished exercise leads to its
                      debrief — which is the only reason to open a finished
                      exercise — and one still running leads back into it.
                      Only an exercise never started leads to the briefing.
                    */}
                    <Link href={sim.yourRun ? `/studio/run/${sim.yourRun.id}` : `/studio/scenarios/${sim.id}`}>
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
                          {sim.yourRun && (
                            <div className={cn(
                              "flex items-center gap-1.5",
                              sim.yourRun.status === 'completed' ? 'text-emerald-400/80' : 'text-[#f97316]',
                            )}>
                              {sim.yourRun.status === 'completed' ? 'Debrief' : 'In progress'}
                            </div>
                          )}
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
    </>
  );
}
