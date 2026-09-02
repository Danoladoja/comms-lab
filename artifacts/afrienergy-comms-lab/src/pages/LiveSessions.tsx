import { useState } from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  useListLiveSessions,
  useRegisterForLiveSession,
  useCancelLiveSessionRegistration,
  useJoinLiveSession,
  getListLiveSessionsQueryKey,
  type LiveSession,
} from '@workspace/api-client-react';
import { liveSessionCallToAction, sortLiveSessions } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Video, Radio, CalendarDays, Users, Loader2, Check, PlayCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Live Sessions: the standalone evenings.
 *
 * This page used to list the classes inside programmes, which meant a cohort's
 * week-three module appeared here as though it were a public event. Those
 * belong to their programme and are reached through it.
 *
 * What is here now is a different thing: a one-off masterclass or deep dive on
 * something happening this month. No programme, no certificate, open to
 * anybody with an account.
 *
 * The shape of it answers one question. Registration opens the moment a
 * session is announced, so people can put their names down weeks ahead. The
 * joining link appears only when the room opens, ten minutes before the start,
 * because a link on a public page is a public link whatever the page says
 * above it. The recording afterwards goes to everyone who registered, whether
 * or not they made it: somebody who signed up and then had a power cut has
 * done nothing wrong.
 */

function formatWhen(iso: string | null) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function reason(err: any, fallback: string): string {
  return err?.error || err?.data?.error || err?.message || fallback;
}

function SessionCard({ session }: { session: LiveSession }) {
  const { isSignedIn } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [joining, setJoining] = useState(false);

  const register = useRegisterForLiveSession();
  const cancel = useCancelLiveSessionRegistration();
  const join = useJoinLiveSession();

  const refresh = () => qc.invalidateQueries({ queryKey: getListLiveSessionsQueryKey() });
  const state = session.state;
  const busy = register.isPending || cancel.isPending || joining;

  const onRegister = () => {
    if (!isSignedIn) {
      toast({ title: 'Sign in to register', description: 'It takes a moment, and the joining link comes to your account.' });
      return;
    }
    register.mutate({ id: session.id }, {
      onSuccess: () => { toast({ title: `You are registered for ${session.title}` }); refresh(); },
      onError: (err: any) => toast({ title: 'Could not register', description: reason(err, 'Try again in a moment.'), variant: 'destructive' }),
    });
  };

  const onJoin = () => {
    setJoining(true);
    join.mutate({ id: session.id }, {
      onSuccess: ({ joinUrl }) => {
        setJoining(false);
        // Opened rather than navigated to, so the Lab stays where it was.
        window.open(joinUrl, '_blank', 'noopener,noreferrer');
        refresh();
      },
      onError: (err: any) => {
        setJoining(false);
        toast({ title: 'Could not open the room', description: reason(err, 'Try again in a moment.'), variant: 'destructive' });
      },
    });
  };

  return (
    <article className="bg-card border border-border rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {session.topic && <Badge variant="secondary">{session.topic}</Badge>}
            {state === 'live' && (
              <Badge className="bg-red-600 hover:bg-red-600 text-white gap-1.5">
                <Radio className="w-3 h-3" aria-hidden /> Live now
              </Badge>
            )}
            {state === 'cancelled' && <Badge variant="outline">Cancelled</Badge>}
            {session.status === 'draft' && <Badge variant="outline">Draft</Badge>}
          </div>
          <h3 className="font-display font-bold text-lg">{session.title}</h3>
          {session.speaker && (
            <p className="text-sm text-muted-foreground mt-1">
              {session.speaker}{session.speakerTitle ? `, ${session.speakerTitle}` : ''}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-medium flex items-center gap-1.5 justify-end">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            {formatWhen(session.startsAt)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {session.durationMins} minutes
            {session.registeredCount > 0 && (
              <> · <Users className="w-3 h-3 inline align-[-1px]" aria-hidden /> {session.registeredCount} registered</>
            )}
          </p>
        </div>
      </div>

      {session.summary && <p className="text-sm text-muted-foreground leading-relaxed mb-5">{session.summary}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {state === 'live' && session.registered && (
          <Button onClick={onJoin} disabled={busy}>
            {joining ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Video className="w-4 h-4 mr-2" aria-hidden />}
            Join now
          </Button>
        )}

        {!session.registered && state !== 'past' && state !== 'cancelled' && (
          <Button onClick={onRegister} disabled={busy}>
            {register.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null}
            {liveSessionCallToAction(state, false)}
          </Button>
        )}

        {session.registered && state !== 'live' && (
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Check className="w-4 h-4 text-green-600" aria-hidden />
            {state === 'past' ? 'You registered for this' : 'You are registered'}
          </span>
        )}

        {state === 'past' && session.registered && session.hasRecording && (
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <PlayCircle className="w-4 h-4" aria-hidden /> The recording is on your Recordings page
          </span>
        )}

        {session.registered && state === 'upcoming' && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => cancel.mutate({ id: session.id }, {
              onSuccess: () => { toast({ title: 'Taken off the list' }); refresh(); },
            })}
          >
            Cannot make it
          </Button>
        )}

        {state === 'upcoming' && (
          <span className="text-xs text-muted-foreground">
            The joining link appears here ten minutes before the start.
          </span>
        )}
      </div>
    </article>
  );
}

export default function LiveSessions() {
  const { data: sessions = [], isLoading } = useListLiveSessions();
  const { upcoming, past } = sortLiveSessions(sessions as LiveSession[]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <header className="mb-10">
        <h1 className="text-4xl font-display font-bold mb-3">Live Sessions</h1>
        <p className="text-muted-foreground leading-relaxed">
          One-off masterclasses and deep dives on what is happening in Africa's energy transition
          right now. Each one stands alone: no programme to join and nothing to finish. Register
          when it is announced, and the joining link appears here when the room opens.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-4" aria-busy>
          {[0, 1].map((i) => <div key={i} className="h-40 bg-card border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing scheduled at the moment. The next one will be announced here.
        </p>
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Coming up</h2>
              <div className="space-y-4">
                {upcoming.map((s) => <SessionCard key={s.id} session={s} />)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Already run</h2>
              <div className="space-y-4">
                {past.map((s) => <SessionCard key={s.id} session={s} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
