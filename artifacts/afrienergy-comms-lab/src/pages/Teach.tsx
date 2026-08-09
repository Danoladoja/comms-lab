import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMySessions,
  useUpdateSession,
  getListMySessionsQueryKey,
} from '@workspace/api-client-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Video, PlayCircle } from 'lucide-react';

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'Date to be announced';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function SessionCard({ session, onSaved }: { session: any; onSaved: () => void }) {
  const [meetUrl, setMeetUrl] = useState(session.meetUrl ?? '');
  const [recordingUrl, setRecordingUrl] = useState(session.recordingUrl ?? '');
  const { toast } = useToast();
  const update = useUpdateSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Session updated' }); onSaved(); },
      onError: () => toast({ title: 'Could not save changes', variant: 'destructive' }),
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-1">{session.programTitle}</p>
      <h3 className="font-semibold">{session.title}</h3>
      <p className="text-xs text-muted-foreground mb-4">
        {formatSessionDate(session.startsAt)} · {session.durationMins} min
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
            <Video className="w-3.5 h-3.5" />Meeting link (Google Meet or Zoom)
          </label>
          <Input value={meetUrl} onChange={e => setMeetUrl(e.target.value)} placeholder="https://meet.google.com/..." />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
            <PlayCircle className="w-3.5 h-3.5" />Recording link (unlisted YouTube)
          </label>
          <Input value={recordingUrl} onChange={e => setRecordingUrl(e.target.value)} placeholder="https://youtu.be/..." />
        </div>
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: session.id, data: { meetUrl: meetUrl || null, recordingUrl: recordingUrl || null } })}
        >
          {update.isPending ? 'Saving...' : 'Save Links'}
        </Button>
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

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">Teaching</h1>
        <p className="text-muted-foreground max-w-2xl">
          Your sessions are listed below. Add your meeting link before the session, and paste the recording link afterwards. Everything else is handled by the team.
        </p>
      </div>
      {loadingSessions ? (
        <div className="h-40 bg-card border border-border rounded-xl animate-pulse" />
      ) : sessions.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-10 text-center text-muted-foreground">
          No sessions assigned to you yet. The team will assign you to sessions once your program is scheduled.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl">
          {sessions.map(s => <SessionCard key={s.id} session={s} onSaved={onSaved} />)}
        </div>
      )}
    </div>
  );
}
