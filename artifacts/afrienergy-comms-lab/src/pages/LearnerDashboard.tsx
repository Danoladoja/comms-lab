import { Link } from 'wouter';
import { useListMyEnrollments, useListMySessions } from '@workspace/api-client-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Calendar, Video, PlayCircle, ArrowRight, GraduationCap } from 'lucide-react';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });
}

const statusLabel: Record<string, string> = {
  enrolled: 'Enrolled',
  waitlisted: 'Waitlisted',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const statusClass: Record<string, string> = {
  enrolled: 'bg-primary/10 text-primary',
  waitlisted: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function LearnerDashboard() {
  const { user } = useCurrentUser();
  const { data: enrollments = [], isLoading: loadingEnrollments } = useListMyEnrollments();
  const { data: sessions = [] } = useListMySessions();

  const now = Date.now();
  const upcoming = sessions
    .filter(s => s.startsAt && new Date(s.startsAt as unknown as string).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => new Date(a.startsAt as unknown as string).getTime() - new Date(b.startsAt as unknown as string).getTime());
  const recordings = sessions.filter(s => s.recordingUrl);

  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">
          {firstName ? `Welcome, ${firstName}` : 'My Learning'}
        </h1>
        <p className="text-muted-foreground">Your programs, live sessions, and recordings in one place.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Programs */}
        <div className="lg:col-span-2 space-y-10">
          <section>
            <h2 className="text-xl font-display font-bold mb-4">My Programs</h2>
            {loadingEnrollments ? (
              <div className="h-24 bg-card border border-border rounded-xl animate-pulse" />
            ) : enrollments.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl p-10 text-center">
                <GraduationCap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-bold mb-1">No programs yet</h3>
                <p className="text-sm text-muted-foreground mb-5">Reserve a place on a program to get started.</p>
                <Button asChild><Link href="/courses">Browse Programs</Link></Button>
              </div>
            ) : (
              <div className="space-y-3">
                {enrollments.map(e => (
                  <Link key={e.id} href={`/programs/${e.programId}`}>
                    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{e.programTitle}</h3>
                        {e.programStartDate && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />Starts {e.programStartDate}
                          </p>
                        )}
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass[e.status] ?? 'bg-muted'}`}>
                        {statusLabel[e.status] ?? e.status}
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Recordings */}
          {recordings.length > 0 && (
            <section>
              <h2 className="text-xl font-display font-bold mb-4">Recordings</h2>
              <div className="space-y-3">
                {recordings.map(s => (
                  <div key={s.id} className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{s.title}</h3>
                      <p className="text-xs text-muted-foreground">{s.programTitle}</p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a href={s.recordingUrl!} target="_blank" rel="noreferrer">
                        <PlayCircle className="w-4 h-4 mr-1.5" />Watch
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Upcoming sessions */}
        <aside>
          <h2 className="text-xl font-display font-bold mb-4">Upcoming Sessions</h2>
          {upcoming.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
              No upcoming sessions yet. When your program schedule is live, sessions appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.map(s => (
                <div key={s.id} className="bg-card border border-border rounded-xl p-5">
                  <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-1">{s.programTitle}</p>
                  <h3 className="font-semibold mb-1">{s.title}</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {formatSessionDate(s.startsAt as unknown as string)} · {s.durationMins} min
                  </p>
                  {s.meetUrl ? (
                    <Button asChild size="sm" className="w-full font-bold">
                      <a href={s.meetUrl} target="_blank" rel="noreferrer"><Video className="w-4 h-4 mr-1.5" />Join Session</a>
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Join link will appear before the session.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
