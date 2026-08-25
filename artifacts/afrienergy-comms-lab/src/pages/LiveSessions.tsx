import { Link } from 'wouter';
import {
  useListPrograms, useListProgramSessions,
  getListProgramsQueryKey, getListProgramSessionsQueryKey,
  type Program, type SessionDetail,
} from '@workspace/api-client-react';
import { liveWindow } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Clock, Radio, CalendarDays } from 'lucide-react';

/**
 * The public class schedule.
 *
 * This page used to render `mock.ts` — fake sessions with fake join links, on a
 * public marketing surface. It now reads the real programs and their real
 * sessions. Join links are never included here: the API only issues them
 * through the join endpoint, to enrolled learners.
 */

/** Times are shown with the zone spelled out — the cohort spans WAT to EAT. */
function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function ProgramSchedule({ program }: { program: Program }) {
  const { data: sessions = [], isLoading } = useListProgramSessions(program.id, {
    query: { queryKey: getListProgramSessionsQueryKey(program.id) },
  });

  if (isLoading) {
    return <div className="h-24 bg-card border border-border rounded-2xl animate-pulse" />;
  }

  const scheduled = (sessions as SessionDetail[])
    .filter((s) => !!s.startsAt)
    .sort((a, b) =>
      new Date(a.startsAt as unknown as string).getTime() - new Date(b.startsAt as unknown as string).getTime());

  if (scheduled.length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-2xl p-6" aria-labelledby={`program-${program.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 id={`program-${program.id}`} className="font-display font-bold text-lg">{program.title}</h2>
        <Badge variant="outline" className="bg-background">{program.format}</Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-5">{program.duration} · starts {program.startDate}</p>

      <ol className="space-y-2">
        {scheduled.map((s) => {
          const iso = s.startsAt as unknown as string;
          const win = liveWindow({ startsAt: iso, durationMins: s.durationMins });
          const date = new Date(iso);
          return (
            <li key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-border px-4 py-3">
              <div className="bg-muted rounded-lg px-3 py-2 text-center min-w-[72px] flex-shrink-0">
                <div className="text-[11px] font-bold text-[#C2410C] uppercase">
                  {date.toLocaleDateString(undefined, { month: 'short' })}
                </div>
                <div className="text-2xl font-bold font-display leading-none">{date.getDate()}</div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <h3 className="font-semibold">{s.title}</h3>
                  {win.canJoin && (
                    <span className="inline-flex items-center gap-1 bg-[#C2410C] text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                      <Radio className="w-2.5 h-2.5" aria-hidden />Live now
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" aria-hidden />{formatWhen(iso)} · {s.durationMins} min
                  </span>
                  {s.instructorName && <span>with {s.instructorName}</span>}
                </p>
              </div>

              <Button asChild size="sm" variant={win.canJoin ? 'default' : 'outline'} className="flex-shrink-0">
                <Link href={`/programs/${program.id}`}>
                  <Video className="w-4 h-4 mr-1.5" aria-hidden />
                  {win.canJoin ? 'Enrolled? Open it' : 'Reserve a place'}
                </Link>
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function LiveSessions() {
  const { data: programs = [], isLoading } = useListPrograms({
    query: { queryKey: getListProgramsQueryKey() },
  });

  const published = programs.filter((p) => p.status === 'published');

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl font-display font-bold mb-4">Class schedule</h1>
        <p className="text-lg text-muted-foreground">
          Every live class across our current programs. Classes are recorded and released to everyone enrolled — if a
          story breaks or the power goes, you have not lost the module.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-6">
          {[0, 1].map((i) => <div key={i} className="h-40 bg-card border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : published.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center max-w-xl">
          <CalendarDays className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden />
          <h2 className="font-bold mb-1">No classes scheduled yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            The next cohort's schedule will be published here.
          </p>
          <Link href="/courses" className="text-sm font-semibold text-primary hover:underline">
            Browse programs
          </Link>
        </div>
      ) : (
        <div className="space-y-6 max-w-4xl">
          {published.map((p) => <ProgramSchedule key={p.id} program={p} />)}
        </div>
      )}
    </div>
  );
}
