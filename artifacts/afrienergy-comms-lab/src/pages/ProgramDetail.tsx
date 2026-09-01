import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetProgram,
  useListProgramSessions,
  useListMyEnrollments,
  useEnrollInProgram,
  getListMyEnrollmentsQueryKey,
  getListProgramsQueryKey,
  getGetProgramQueryKey,
  getListProgramSessionsQueryKey,
} from '@workspace/api-client-react';
import { acceptsEnrolment } from '@workspace/domain';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Clock, Users, Video, PlayCircle, CheckCircle2 } from 'lucide-react';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function ProgramDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { isSignedIn } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: program, isLoading } = useGetProgram(id, { query: { queryKey: getGetProgramQueryKey(id), enabled: !Number.isNaN(id) } });
  const { data: sessions = [] } = useListProgramSessions(id, { query: { queryKey: getListProgramSessionsQueryKey(id), enabled: !Number.isNaN(id) } });
  const { data: myEnrollments = [] } = useListMyEnrollments({ query: { queryKey: getListMyEnrollmentsQueryKey(), enabled: isSignedIn, retry: false } });

  const myEnrollment = myEnrollments.find(e => e.programId === id && e.status !== 'cancelled');

  const enroll = useEnrollInProgram({
    mutation: {
      onSuccess: (created) => {
        qc.invalidateQueries({ queryKey: getListMyEnrollmentsQueryKey() });
        qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetProgramQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListProgramSessionsQueryKey(id) });
        toast({
          title: created.status === 'waitlisted' ? 'You are on the waitlist' : 'Place reserved',
          description:
            created.status === 'waitlisted'
              ? 'This cohort is full. We will notify you if a place opens up.'
              : 'You are enrolled. Session details are on your dashboard.',
        });
      },
      onError: () => {
        toast({ title: 'Could not reserve a place', description: 'Please try again.', variant: 'destructive' });
      },
    },
  });

  if (isLoading) {
    return <div className="container mx-auto px-4 py-24"><div className="h-64 bg-card border border-border rounded-2xl animate-pulse" /></div>;
  }
  if (!program) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-display font-bold mb-4">Program not found</h1>
        <Button asChild><Link href="/courses">Browse programmes</Link></Button>
      </div>
    );
  }

  const placesLeft = Math.max(0, program.capacity - program.enrolledCount);
  // Closed means the cohort is full or under way. The page stays up so people
  // can read what the Lab runs; only the way in is gone.
  const open = acceptsEnrolment(program.status);

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#07111E] text-[#F4F0E8]">
        <div className="container mx-auto px-4 md:px-6 py-16 md:py-20">
          <p className="text-xs uppercase tracking-widest font-medium text-[#F97316] mb-4">{program.tag}</p>
          <h1 className="text-3xl md:text-5xl font-display font-bold mb-4 max-w-3xl">{program.title}</h1>
          <p className="text-lg text-[#F4F0E8]/70 max-w-2xl mb-8">{program.description}</p>
          <div className="flex flex-wrap items-center gap-6 text-sm text-[#F4F0E8]/80">
            <span className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#F97316]" />Starts {program.startDate}</span>
            <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#F97316]" />{program.duration} · {program.format}</span>
            <span className="flex items-center gap-2"><Users className="w-4 h-4 text-[#F97316]" />{!open ? 'Sign-ups closed' : placesLeft > 0 ? `${placesLeft} places left` : 'Waitlist open'}</span>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 md:px-6 py-12 grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Modules */}
        <div className="lg:col-span-2">
          <h2 className="text-2xl font-display font-bold mb-6">Modules</h2>
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">The module schedule will be published soon.</p>
          ) : (
            <ol className="space-y-4">
              {sessions.map((s, i) => (
                <li key={s.id} className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Named as well as numbered: on a cohort programme these
                        are modules of a course, not a list of appointments. */}
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">Module {i + 1}</p>
                    <h3 className="font-semibold">{s.title}</h3>
                    {s.description && <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatSessionDate(s.startsAt as unknown as string)} · {s.durationMins} min
                      {s.instructorName ? ` · ${s.instructorName}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.meetUrl && (
                      <Button asChild size="sm" variant="outline">
                        <a href={s.meetUrl} target="_blank" rel="noreferrer"><Video className="w-4 h-4 mr-1.5" />Join</a>
                      </Button>
                    )}
                    {s.recordingUrl && (
                      <Button asChild size="sm" variant="outline">
                        <a href={s.recordingUrl} target="_blank" rel="noreferrer"><PlayCircle className="w-4 h-4 mr-1.5" />Recording</a>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Enroll card */}
        <aside>
          <div className="bg-card border border-border rounded-2xl p-6 lg:sticky lg:top-28">
            <h3 className="font-display font-bold text-lg mb-2">
              {open ? 'Reserve your place' : 'Sign-ups have closed'}
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              {open
                ? 'Free to join. Places are limited to keep cohorts practical and interactive.'
                : 'This cohort is no longer taking new learners. Browse the other programmes, or write to us about the next run.'}
            </p>
            {myEnrollment ? (
              <div className="flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-4 py-3 font-medium text-sm">
                <CheckCircle2 className="w-5 h-5" />
                {myEnrollment.status === 'waitlisted' ? 'You are on the waitlist' :
                 myEnrollment.status === 'completed' ? 'Completed' : 'You are enrolled'}
              </div>
            ) : !open ? (
              <Button asChild variant="outline" className="w-full font-bold">
                <Link href="/courses">See other programmes</Link>
              </Button>
            ) : isSignedIn ? (
              <Button
                className="w-full font-bold"
                disabled={enroll.isPending}
                onClick={() => enroll.mutate({ id })}
              >
                {enroll.isPending ? 'Reserving...' : placesLeft > 0 ? 'Reserve a Place' : 'Join the Waitlist'}
              </Button>
            ) : (
              <Button asChild className="w-full font-bold">
                <Link href="/waitlist">Join the waitlist</Link>
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
