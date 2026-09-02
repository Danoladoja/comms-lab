import { useState } from 'react';
import {
  useListLiveSessions,
  useCreateLiveSession,
  useUpdateLiveSession,
  useListLiveSessionRegistrations,
  getListLiveSessionsQueryKey,
  type LiveSession,
} from '@workspace/api-client-react';
import { sessionDateTimeFromInput, sessionDateTimeInput, sortLiveSessions } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Announcing and running the standalone Live Sessions.
 *
 * The joining link and the recording live here, and only here. Nothing on the
 * public page ever carries either: the server hands them out one person at a
 * time, having checked that they registered.
 */

const EMPTY = {
  title: '', summary: '', description: '', topic: '',
  speaker: '', speakerTitle: '',
  startsAt: '', durationMins: 60, capacity: 0,
  meetUrl: '', recordingUrl: '', status: 'draft' as const,
};

function reason(err: any, fallback: string): string {
  return err?.error || err?.data?.error || err?.message || fallback;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

function Registrations({ id }: { id: number }) {
  const { data: people = [], isLoading } = useListLiveSessionRegistrations(id);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (people.length === 0) return <p className="text-sm text-muted-foreground">Nobody has registered yet.</p>;

  const came = people.filter((p: any) => p.attendedAt).length;
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        {people.length} registered{came > 0 ? `, ${came} opened the room` : ''}.
      </p>
      <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
        {people.map((p: any) => (
          <div key={p.userId} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{p.name || p.email}</span>
            <span className="text-xs text-muted-foreground shrink-0">{p.attendedAt ? 'Came' : 'Registered'}</span>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => navigator.clipboard.writeText(people.map((p: any) => p.email).filter(Boolean).join(', '))}
      >
        Copy their email addresses
      </Button>
    </div>
  );
}

function SessionRow({ session }: { session: LiveSession }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateLiveSession();
  const [open, setOpen] = useState<'closed' | 'edit' | 'people'>('closed');
  const [form, setForm] = useState({
    ...EMPTY,
    ...session,
    summary: session.summary ?? '',
    description: session.description ?? '',
    topic: session.topic ?? '',
    speaker: session.speaker ?? '',
    speakerTitle: session.speakerTitle ?? '',
    meetUrl: '',
    recordingUrl: '',
    startsAt: sessionDateTimeInput(session.startsAt),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: getListLiveSessionsQueryKey() });

  const save = (extra: Record<string, unknown> = {}) => {
    update.mutate({ id: session.id, data: {
      title: form.title, summary: form.summary, description: form.description, topic: form.topic,
      speaker: form.speaker, speakerTitle: form.speakerTitle,
      startsAt: sessionDateTimeFromInput(form.startsAt),
      durationMins: Number(form.durationMins) || 60,
      capacity: Number(form.capacity) || 0,
      ...(form.meetUrl.trim() ? { meetUrl: form.meetUrl.trim() } : {}),
      ...(form.recordingUrl.trim() ? { recordingUrl: form.recordingUrl.trim() } : {}),
      ...extra,
    } as any }, {
      onSuccess: () => { toast({ title: 'Saved' }); refresh(); setOpen('closed'); },
      onError: (err: any) => toast({ title: 'Could not save', description: reason(err, 'Try again.'), variant: 'destructive' }),
    });
  };

  return (
    <div className="border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={session.status === 'published' ? 'default' : 'outline'}>
              {session.status === 'published' ? 'Published' : session.status === 'draft' ? 'Draft' : 'Cancelled'}
            </Badge>
            {session.topic && <Badge variant="secondary">{session.topic}</Badge>}
          </div>
          <p className="font-semibold">{session.title}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {session.startsAt ? new Date(session.startsAt).toLocaleString() : 'No date yet'}
            {' · '}{session.registeredCount} registered
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {session.status === 'draft' && (
            <Button size="sm" onClick={() => save({ status: 'published' })} disabled={update.isPending}>
              Publish
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpen(open === 'edit' ? 'closed' : 'edit')}>
            {open === 'edit' ? <ChevronUp className="w-4 h-4" aria-hidden /> : <ChevronDown className="w-4 h-4" aria-hidden />}
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(open === 'people' ? 'closed' : 'people')}>
            <Users className="w-4 h-4 mr-1.5" aria-hidden /> Who is coming
          </Button>
        </div>
      </div>

      {open === 'people' && <div className="mt-4 pt-4 border-t border-border"><Registrations id={session.id} /></div>}

      {open === 'edit' && (
        <div className="mt-4 pt-4 border-t border-border grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Topic" hint="A short label: Gas, Grid, Finance."><Input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
          <Field label="Speaker"><Input value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} /></Field>
          <Field label="Their role"><Input value={form.speakerTitle} onChange={(e) => setForm({ ...form, speakerTitle: e.target.value })} /></Field>
          <Field label="When"><Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
          <Field label="How long, in minutes"><Input type="number" min={5} value={form.durationMins} onChange={(e) => setForm({ ...form, durationMins: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2">
            <Field label="The one line on the listing"><Textarea rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Joining link" hint="Never shown publicly. It reaches a registered person when the room opens, ten minutes before the start.">
              <Input placeholder="Paste a new link to replace the current one" value={form.meetUrl} onChange={(e) => setForm({ ...form, meetUrl: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Recording" hint="Added afterwards. Goes to everyone who registered, whether or not they came.">
              <Input placeholder="Paste the recording link" value={form.recordingUrl} onChange={(e) => setForm({ ...form, recordingUrl: e.target.value })} />
            </Field>
          </div>
          <Field label="Limit on numbers" hint="Leave at zero for no limit, which is usually right.">
            <Input type="number" min={0} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
          </Field>

          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
            <Button onClick={() => save()} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : null} Save
            </Button>
            {session.status !== 'cancelled' && (
              <Button variant="outline" onClick={() => save({ status: 'cancelled' })} disabled={update.isPending}>
                Cancel this session
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveSessionsAdmin() {
  const { data: sessions = [], isLoading } = useListLiveSessions();
  const create = useCreateLiveSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');

  const { upcoming, past } = sortLiveSessions(sessions as LiveSession[]);

  const add = () => {
    if (!title.trim()) return;
    create.mutate({ data: { title: title.trim() } as any }, {
      onSuccess: () => {
        toast({ title: 'Draft created', description: 'Fill in the details, then publish it.' });
        setTitle('');
        qc.invalidateQueries({ queryKey: getListLiveSessionsQueryKey() });
      },
      onError: (err: any) => toast({ title: 'Could not create it', description: reason(err, 'Try again.'), variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold">Live Sessions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Standalone masterclasses and deep dives. Not the modules inside a programme, which are
          under Programmes. People register as soon as you publish one; the joining link reaches
          them only when the room opens.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="What is it called?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <Button onClick={add} disabled={!title.trim() || create.isPending} className="shrink-0">
          {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Plus className="w-4 h-4 mr-2" aria-hidden />}
          Add a session
        </Button>
      </div>

      {isLoading ? (
        <div className="h-24 bg-muted/40 rounded-xl animate-pulse" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. Add one above.</p>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Coming up</h3>
              {upcoming.map((s) => <SessionRow key={s.id} session={s} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Already run</h3>
              {past.map((s) => <SessionRow key={s.id} session={s} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
