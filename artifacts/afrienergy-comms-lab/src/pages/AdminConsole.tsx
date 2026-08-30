import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPrograms,
  useCreateProgram,
  useUpdateProgram,
  useListProgramSessions,
  useCreateSession,
  useUpdateSession,
  useDeleteSession,
  useListAllEnrollments,
  useUpdateEnrollment,
  useListUsers,
  useUpdateUserRole,
  getListProgramsQueryKey,
  getListProgramSessionsQueryKey,
  getListAllEnrollmentsQueryKey,
  getListUsersQueryKey,
  type Program,
  type Session,
} from '@workspace/api-client-react';
import CourseworkStudio from '@/components/CourseworkStudio';
import RecordingsAdmin from '@/components/RecordingsAdmin';
import { isMeasurableRecording } from '@/lib/embed';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronUp, Plus, Trash2, CircleAlert } from 'lucide-react';

const TABS = ['Programs', 'Enrollments', 'People', 'Recordings'] as const;
type Tab = (typeof TABS)[number];

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'TBA';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/* ---------- Sessions manager for one program ---------- */

function SessionRow({ session, instructors, onChanged }: {
  session: Session; instructors: { id: number; name: string; email: string }[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [meetUrl, setMeetUrl] = useState(session.meetUrl ?? '');
  const [recordingUrl, setRecordingUrl] = useState(session.recordingUrl ?? '');
  const [instructorId, setInstructorId] = useState<string>(session.instructorId ? String(session.instructorId) : '');
  const [coursework, setCoursework] = useState<'none' | 'open'>('none');

  const startsAtMs = session.startsAt ? new Date(session.startsAt as unknown as string).getTime() : null;
  const isPast = startsAtMs !== null && Date.now() > startsAtMs + session.durationMins * 60 * 1000;
  const recordingMeasurable = !!recordingUrl.trim() && isMeasurableRecording(recordingUrl.trim());

  const update = useUpdateSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Session saved' }); onChanged(); },
      onError: () => toast({ title: 'Could not save session', variant: 'destructive' }),
    },
  });
  const remove = useDeleteSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Session deleted' }); onChanged(); },
      onError: () => toast({ title: 'Could not delete session', variant: 'destructive' }),
    },
  });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">{session.title}</p>
          <p className="text-xs text-muted-foreground">{formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min</p>
        </div>
        <Button
          variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"
          onClick={() => { if (confirm('Delete this session?')) remove.mutate({ id: session.id }); }}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      {/* Past class with nowhere to watch it: the one state that actually
          holds learners up, so it is said out loud rather than implied. */}
      {isPast && !recordingUrl && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <CircleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
          <span>
            This class has finished and has no recording. Anyone who missed it cannot complete the module until
            you add one below.
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor={`meet-${session.id}`}>
            Meeting link
          </label>
          <Input
            id={`meet-${session.id}`}
            value={meetUrl}
            onChange={e => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/..."
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">Create the room, paste it here.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor={`rec-${session.id}`}>
            Recording link
          </label>
          <Input
            id={`rec-${session.id}`}
            value={recordingUrl}
            onChange={e => setRecordingUrl(e.target.value)}
            placeholder="https://youtu.be/..."
            className="text-sm"
            aria-describedby={`rec-help-${session.id}`}
          />
          <p id={`rec-help-${session.id}`} className="text-xs mt-1">
            {!recordingUrl.trim() ? (
              <span className="text-muted-foreground">Upload to YouTube as unlisted, paste the link.</span>
            ) : recordingMeasurable ? (
              <span className="text-emerald-700">Good — watch time counts towards completion.</span>
            ) : (
              <span className="text-amber-800">
                Not a YouTube or video-file link. It will play, but watch time can't be counted, so learners who
                missed the class can't complete the module.
              </span>
            )}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor={`fac-${session.id}`}>
            Facilitator
          </label>
          <select
            id={`fac-${session.id}`}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
            value={instructorId}
            onChange={e => setInstructorId(e.target.value)}
          >
            <option value="">No facilitator</option>
            {instructors.map(i => <option key={i.id} value={i.id}>{i.name || i.email}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm" variant="outline" disabled={update.isPending}
          onClick={() => update.mutate({
            id: session.id,
            data: {
              meetUrl: meetUrl || null,
              recordingUrl: recordingUrl || null,
              instructorId: instructorId ? Number(instructorId) : null,
            },
          })}
        >
          {update.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button
          size="sm" variant={coursework === 'open' ? 'secondary' : 'ghost'}
          onClick={() => setCoursework(coursework === 'open' ? 'none' : 'open')}
        >
          Slides & coursework
        </Button>
      </div>
      {coursework === 'open' && <CourseworkStudio sessionId={session.id} />}
    </div>
  );
}

function ProgramSessions({ programId, instructors }: { programId: number; instructors: { id: number; name: string; email: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: sessions = [] } = useListProgramSessions(programId);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState('90');

  const onChanged = () => qc.invalidateQueries({ queryKey: getListProgramSessionsQueryKey(programId) });

  const create = useCreateSession({
    mutation: {
      onSuccess: () => { setTitle(''); setStartsAt(''); toast({ title: 'Session added' }); onChanged(); },
      onError: () => toast({ title: 'Could not add session', variant: 'destructive' }),
    },
  });

  return (
    <div className="space-y-3 mt-4">
      {sessions.map(s => <SessionRow key={s.id} session={s} instructors={instructors} onChanged={onChanged} />)}
      <div className="border border-dashed border-border rounded-lg p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Add a session</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Session title" className="md:col-span-2 text-sm" />
          <Input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="text-sm" />
          <div className="flex gap-2">
            <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="Minutes" className="text-sm" />
            <Button
              size="sm" disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate({
                id: programId,
                data: {
                  title: title.trim(),
                  sortOrder: sessions.length + 1,
                  startsAt: startsAt ? new Date(startsAt).toISOString() : null,
                  durationMins: Math.max(5, Number(duration) || 90),
                },
              })}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Programs tab ---------- */

function ProgramCard({ program, instructors }: { program: Program; instructors: { id: number; name: string; email: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(String(program.capacity));

  const update = useUpdateProgram({
    mutation: {
      onSuccess: () => { toast({ title: 'Program updated' }); qc.invalidateQueries({ queryKey: getListProgramsQueryKey() }); },
      onError: () => toast({ title: 'Could not update program', variant: 'destructive' }),
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium">{program.tag}</p>
          <h3 className="font-semibold">{program.title}</h3>
          <p className="text-xs text-muted-foreground">{program.startDate} · {program.format} · {program.duration} · {program.enrolledCount}/{program.capacity} enrolled</p>
        </div>
        <select
          className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          value={program.status}
          onChange={e => update.mutate({ id: program.id, data: { status: e.target.value as any } })}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <div className="flex items-center gap-1.5">
          <Input
            type="number" className="w-20 text-sm" value={capacity}
            onChange={e => setCapacity(e.target.value)}
            onBlur={() => {
              const c = Number(capacity);
              if (c >= 1 && c !== program.capacity) update.mutate({ id: program.id, data: { capacity: c } });
            }}
          />
          <span className="text-xs text-muted-foreground">places</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          Sessions {open ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
        </Button>
      </div>
      {open && <ProgramSessions programId={program.id} instructors={instructors} />}
    </div>
  );
}

function ProgramsTab({ instructors }: { instructors: { id: number; name: string; email: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: programs = [], isLoading } = useListPrograms();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ tag: '', title: '', description: '', startDate: '', format: 'Cohort', duration: '', capacity: '30' });

  const create = useCreateProgram({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Program created as a draft' });
        setShowCreate(false);
        setForm({ tag: '', title: '', description: '', startDate: '', format: 'Cohort', duration: '', capacity: '30' });
        qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
      },
      onError: () => toast({ title: 'Could not create program', variant: 'destructive' }),
    },
  });

  const canCreate = form.tag && form.title && form.description && form.startDate && form.duration;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}><Plus className="w-4 h-4 mr-1.5" />New Program</Button>
      </div>
      {showCreate && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <Input placeholder="Focus area (e.g. Strategic Energy Communications)" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} />
            <Input placeholder="Start (e.g. Nov 2026)" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
            <Input placeholder="Duration (e.g. 4 weeks)" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} />
            <select
              className="border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={form.format} onChange={e => setForm({ ...form, format: e.target.value })}
            >
              <option>Cohort</option><option>Masterclass</option><option>Intensive</option>
            </select>
            <Input type="number" placeholder="Capacity" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
          </div>
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Button
            size="sm" disabled={!canCreate || create.isPending}
            onClick={() => create.mutate({
              data: {
                tag: form.tag, title: form.title, description: form.description,
                startDate: form.startDate, format: form.format, duration: form.duration,
                capacity: Math.max(1, Number(form.capacity) || 30), status: 'draft',
              },
            })}
          >
            {create.isPending ? 'Creating...' : 'Create Draft'}
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="h-32 bg-card border border-border rounded-xl animate-pulse" />
      ) : (
        programs.map(p => <ProgramCard key={p.id} program={p} instructors={instructors} />)
      )}
    </div>
  );
}

/* ---------- Enrollments tab ---------- */

function EnrollmentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: enrollments = [], isLoading } = useListAllEnrollments();
  const update = useUpdateEnrollment({
    mutation: {
      onSuccess: () => { toast({ title: 'Enrollment updated' }); qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() }); },
      onError: () => toast({ title: 'Could not update enrollment', variant: 'destructive' }),
    },
  });

  if (isLoading) return <div className="h-32 bg-card border border-border rounded-xl animate-pulse" />;
  if (enrollments.length === 0) return <p className="text-muted-foreground">No enrollments yet.</p>;

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="p-4">Learner</th><th className="p-4">Program</th><th className="p-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map(e => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="p-4">
                <p className="font-medium">{e.userName || e.userEmail}</p>
                <p className="text-xs text-muted-foreground">{e.userEmail}</p>
              </td>
              <td className="p-4">{e.programTitle}</td>
              <td className="p-4">
                <select
                  className="border border-border rounded-md px-2 py-1.5 text-sm bg-background"
                  value={e.status}
                  onChange={ev => update.mutate({ id: e.id, data: { status: ev.target.value as any } })}
                >
                  <option value="enrolled">Enrolled</option>
                  <option value="waitlisted">Waitlisted</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- People tab ---------- */

function PeopleTab({ selfId }: { selfId: number | undefined }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: users = [], isLoading } = useListUsers();
  const update = useUpdateUserRole({
    mutation: {
      onSuccess: () => { toast({ title: 'Role updated' }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
      onError: () => toast({ title: 'Could not update role', variant: 'destructive' }),
    },
  });

  if (isLoading) return <div className="h-32 bg-card border border-border rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Facilitators sign up like everyone else. Once they have joined, set their role to Facilitator here, then assign them to sessions under Programs.
      </p>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="p-4">Name</th><th className="p-4">Email</th><th className="p-4">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="p-4 font-medium">{u.name || '—'}</td>
                <td className="p-4 text-muted-foreground">{u.email}</td>
                <td className="p-4">
                  <select
                    className="border border-border rounded-md px-2 py-1.5 text-sm bg-background disabled:opacity-50"
                    value={u.role}
                    disabled={u.id === selfId}
                    onChange={e => update.mutate({ id: u.id, data: { role: e.target.value as any } })}
                  >
                    <option value="learner">Learner</option>
                    <option value="instructor">Facilitator</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Console ---------- */

export default function AdminConsole() {
  const { role, user, isLoading } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('Programs');
  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: role === 'admin' } });
  const instructors = users.filter(u => u.role === 'instructor' || u.role === 'admin');

  if (!isLoading && role !== 'admin') {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-display font-bold mb-2">Admins only</h1>
        <p className="text-muted-foreground">You do not have access to the admin console.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">Admin Console</h1>
        <p className="text-muted-foreground">Manage programs, sessions, enrollments, people, and class recordings.</p>
      </div>

      <div className="flex gap-1 border-b border-border mb-8">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Programs' && <ProgramsTab instructors={instructors} />}
      {tab === 'Enrollments' && <EnrollmentsTab />}
      {tab === 'People' && <PeopleTab selfId={user?.id} />}
      {tab === 'Recordings' && <RecordingsAdmin />}
    </div>
  );
}
