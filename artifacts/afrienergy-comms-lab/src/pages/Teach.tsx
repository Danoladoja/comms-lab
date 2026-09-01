import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMySessions,
  useUpdateSession,
  useJoinSession,
  getListMySessionsQueryKey,
  type SessionDetail,
} from '@workspace/api-client-react';
import { liveWindow } from '@workspace/domain';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Video, PlayCircle, CircleAlert, CircleCheck } from 'lucide-react';
import CourseworkStudio from '@/components/CourseworkStudio';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function SessionCard({ session, onSaved }: { session: SessionDetail; onSaved: () => void }) {
  const [recordingUrl, setRecordingUrl] = useState(session.recordingUrl ?? '');
  const [showCoursework, setShowCoursework] = useState(false);
  const { toast } = useToast();

  const update = useUpdateSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Session updated' }); onSaved(); },
      onError: () => toast({ title: 'Could not save changes', variant: 'destructive' }),
    },
  });

  // Facilitators reach the room the same way learners do — through Join, never
  // a link they hold themselves. The room itself is set up by the team.
  const join = useJoinSession({
    mutation: {
      onSuccess: (result) => {
        if (result.joinUrl) window.open(result.joinUrl, '_blank', 'noreferrer');
        else toast({ title: 'No room yet', description: 'The team has not set up the meeting room for this session.' });
      },
      onError: () => toast({ title: 'Could not open the room', variant: 'destructive' }),
    },
  });

  const win = liveWindow({
    startsAt: session.startsAt as unknown as string | null,
    durationMins: session.durationMins,
  });
  const roomReady = session.hasMeetUrl;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-1">{session.programTitle}</p>
      <h3 className="font-semibold">{session.title}</h3>
      <p className="text-xs text-muted-foreground mb-4">
        {formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
            <Video className="w-3.5 h-3.5" aria-hidden />Meeting room
          </p>
          {roomReady ? (
            <>
              <p className="text-xs text-emerald-700 flex items-center gap-1.5 mb-2">
                <CircleCheck className="w-3.5 h-3.5" aria-hidden />Room is set up by the team
              </p>
              <Button
                size="sm"
                className="w-full font-semibold"
                disabled={join.isPending}
                onClick={() => join.mutate({ id: session.id })}
              >
                <Video className="w-4 h-4 mr-1.5" aria-hidden />
                {join.isPending ? 'Opening...' : win.state === 'ended' ? 'Open room' : 'Open the room'}
              </Button>
            </>
          ) : (
            <p className="text-xs text-amber-700 flex items-start gap-1.5">
              <CircleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
              No room yet. The team sets this up — ask them if the class is soon.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
            <PlayCircle className="w-3.5 h-3.5" aria-hidden />Recording link (unlisted YouTube)
          </label>
          <Input
            value={recordingUrl}
            onChange={e => setRecordingUrl(e.target.value)}
            placeholder="https://youtu.be/..."
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Learners who could not attend complete the module by watching this, so please upload it promptly.
            It must be YouTube — other players cannot be counted.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: session.id, data: { recordingUrl: recordingUrl || null } })}
        >
          {update.isPending ? 'Saving...' : 'Save recording link'}
        </Button>

        <Button
          size="sm"
          variant={showCoursework ? 'secondary' : 'ghost'}
          className="w-full"
          onClick={() => setShowCoursework(v => !v)}
        >
          {showCoursework ? 'Hide slides & coursework' : 'Slides & coursework'}
        </Button>

        {showCoursework && <CourseworkStudio sessionId={session.id} />}
      </div>
    </div>
  );
}

export default function Teach() {
  const { role, isLoading } = useCurrentUser();
  const qc = useQueryClient();
  const { data: sessions = [], isLoading: loadingSessions } = useListMySessions();

  if (!isLoading && role !== 'instructor' && role !== 'admin') {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-display font-bold mb-2">Facilitators only</h1>
        <p className="text-muted-foreground">This area is for program facilitators. If you have been invited to teach, ask the team to activate your facilitator access.</p>
      </div>
    );
  }

  const onSaved = () => qc.invalidateQueries({ queryKey: getListMySessionsQueryKey() });
  const missingRecordings = sessions.filter(s => {
    const win = liveWindow({
      startsAt: s.startsAt as unknown as string | null,
      durationMins: s.durationMins,
    });
    return win.state === 'ended' && !s.recordingUrl;
  });

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">Teaching</h1>
        <p className="text-muted-foreground max-w-2xl">
          Your modules are listed below. Open the room from here when it is time to teach, and add the recording
          link afterwards.
        </p>
      </div>

      {/* Anyone who missed the class completes the module by watching the
          recording, so a missing upload holds learners up. */}
      {missingRecordings.length > 0 && (
        <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4 max-w-4xl">
          <p className="font-semibold text-amber-900 flex items-center gap-2 mb-1">
            <CircleAlert className="w-4 h-4" aria-hidden />
            {missingRecordings.length} past module{missingRecordings.length === 1 ? '' : 's'} without a recording
          </p>
          <p className="text-sm text-amber-900/80">
            Learners who could not attend cannot finish these modules until the recording is up.
          </p>
        </div>
      )}

      {loadingSessions ? (
        <div className="h-40 bg-card border border-border rounded-xl animate-pulse" />
      ) : sessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center text-muted-foreground">
          No modules assigned to you yet. The team will assign you once your programme is scheduled.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl">
          {sessions.map(s => <SessionCard key={s.id} session={s} onSaved={onSaved} />)}
        </div>
      )}
    </div>
  );
}
