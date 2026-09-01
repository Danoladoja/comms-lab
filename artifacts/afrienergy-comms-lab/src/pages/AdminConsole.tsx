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
  useListStaff,
  useListWaitlist,
  useUpdateWaitlistEntry,
  useListUnattachedUsers,
  getListWaitlistQueryKey,
  useUpdateUserRole,
  getListProgramsQueryKey,
  getListProgramSessionsQueryKey,
  getListAllEnrollmentsQueryKey,
  getListUsersQueryKey,
  getListStaffQueryKey,
  type Program,
  type ProgramStatus,
  type Session,
} from '@workspace/api-client-react';
import {
  ROLE_NOTES,
  describeWaitlist,
  canAppointStaff,
  groupStaff,
  describeFacilitatorChoice,
  facilitatorFields,
  facilitatorInputValue,
  matchFacilitator,
  programStatusNote,
  sessionDateTimeFromInput,
  sessionDateTimeInput,
  sessionMinutes,
} from '@workspace/domain';
import CourseworkStudio from '@/components/CourseworkStudio';
import SimulationStaffStudio from '@/components/SimulationStaffStudio';
import InviteFacilitator from '@/components/InviteFacilitator';
import InviteLearners from '@/components/InviteLearners';
import RecordingsAdmin from '@/components/RecordingsAdmin';
import ProgramThumbnail from '@/components/ProgramThumbnail';
import { isMeasurableRecording } from '@/lib/embed';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronUp, Plus, Trash2, CircleAlert, Pencil } from 'lucide-react';

const TABS = ['Programs', 'Simulation Studio', 'Enrollments', 'People', 'Recordings'] as const;
type Tab = (typeof TABS)[number];

function formatSessionDate(iso: string | null | undefined) {
  if (!iso) return 'TBA';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/* ---------- Modules manager for one program ---------- */

function SessionRow({ session, instructors, onChanged }: {
  session: Session; instructors: { id: number; name: string; email: string }[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [meetUrl, setMeetUrl] = useState(session.meetUrl ?? '');
  const [recordingUrl, setRecordingUrl] = useState(session.recordingUrl ?? '');
  const [facilitator, setFacilitator] = useState(facilitatorInputValue(session));
  const [coursework, setCoursework] = useState<'none' | 'open'>('none');
  /** What the typed text means right now: an account, a guest, or nobody. */
  const choice = matchFacilitator(facilitator, instructors);
  const [editing, setEditing] = useState(false);

  /** The details themselves — what it is called, when it runs, how long for. */
  const detailsFromSession = () => ({
    title: session.title,
    description: session.description ?? '',
    startsAt: sessionDateTimeInput(session.startsAt as unknown as string),
    durationMins: String(session.durationMins),
  });
  const [details, setDetails] = useState(detailsFromSession);

  const startsAtMs = session.startsAt ? new Date(session.startsAt as unknown as string).getTime() : null;
  const isPast = startsAtMs !== null && Date.now() > startsAtMs + session.durationMins * 60 * 1000;
  const recordingMeasurable = !!recordingUrl.trim() && isMeasurableRecording(recordingUrl.trim());

  const update = useUpdateSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Module saved' }); setEditing(false); onChanged(); },
      onError: () => toast({ title: 'Could not save module', variant: 'destructive' }),
    },
  });
  const remove = useDeleteSession({
    mutation: {
      onSuccess: () => { toast({ title: 'Module deleted' }); onChanged(); },
      onError: () => toast({ title: 'Could not delete module', variant: 'destructive' }),
    },
  });

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">{session.title}</p>
          <p className="text-xs text-muted-foreground">{formatSessionDate(session.startsAt as unknown as string)} · {session.durationMins} min</p>
          {session.description && (
            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{session.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="outline" size="sm"
            onClick={() => {
              // Opening reloads from the session, so a half-finished edit that
              // was abandoned never comes back to surprise anybody.
              if (!editing) setDetails(detailsFromSession());
              setEditing(!editing);
            }}
          >
            <Pencil className="w-4 h-4 mr-1.5" />{editing ? 'Done' : 'Edit'}
          </Button>
          <Button
            variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"
            onClick={() => { if (confirm('Delete this module? Its slides, quiz and assignment go with it.')) remove.mutate({ id: session.id }); }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`title-${session.id}`}>
                Title
              </label>
              <Input
                id={`title-${session.id}`}
                className="text-sm"
                value={details.title}
                onChange={e => setDetails({ ...details, title: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`when-${session.id}`}>
                Date and time
              </label>
              <Input
                id={`when-${session.id}`}
                type="datetime-local"
                className="text-sm"
                value={details.startsAt}
                onChange={e => setDetails({ ...details, startsAt: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Your own clock. Leave it empty if the date is still to be announced.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`mins-${session.id}`}>
                Minutes
              </label>
              <Input
                id={`mins-${session.id}`}
                type="number"
                className="text-sm"
                value={details.durationMins}
                onChange={e => setDetails({ ...details, durationMins: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`desc-${session.id}`}>
              What this module covers
            </label>
            <Textarea
              id={`desc-${session.id}`}
              className="text-sm"
              rows={3}
              value={details.description}
              onChange={e => setDetails({ ...details, description: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">Learners read this on the programme page.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!details.title.trim() || update.isPending}
              onClick={() => update.mutate({
                id: session.id,
                data: {
                  title: details.title.trim(),
                  description: details.description.trim(),
                  startsAt: sessionDateTimeFromInput(details.startsAt),
                  durationMins: sessionMinutes(details.durationMins),
                },
              })}
            >
              {update.isPending ? 'Saving...' : 'Save details'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDetails(detailsFromSession()); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
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
          {/* Type a name or pick one from the list. Somebody with an account
              gets the class; anybody else is written up as a guest. */}
          <Input
            id={`fac-${session.id}`}
            className="text-sm"
            list={`facilitators-${session.id}`}
            value={facilitator}
            placeholder="Type a name, or choose"
            onChange={e => setFacilitator(e.target.value)}
          />
          <datalist id={`facilitators-${session.id}`}>
            {instructors.map(i => <option key={i.id} value={i.name || i.email} />)}
          </datalist>
          <p className={`text-xs mt-1 ${choice.kind === 'ambiguous' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {describeFacilitatorChoice(choice)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm" variant="outline"
          // Two people of the same name: saving would hand the class to whichever
          // the code happened to find first, so it waits for an email instead.
          disabled={update.isPending || choice.kind === 'ambiguous'}
          onClick={() => update.mutate({
            id: session.id,
            data: {
              meetUrl: meetUrl || null,
              recordingUrl: recordingUrl || null,
              ...facilitatorFields(choice),
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCoursework('open');
            requestAnimationFrame(() => requestAnimationFrame(() => {
              document.getElementById(`simulation-studio-${session.id}`)?.scrollIntoView({ behavior: 'smooth' });
            }));
          }}
        >
          Simulation Studio
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
      onSuccess: () => { setTitle(''); setStartsAt(''); toast({ title: 'Module added' }); onChanged(); },
      onError: () => toast({ title: 'Could not add module', variant: 'destructive' }),
    },
  });

  return (
    <div className="space-y-3 mt-4">
      {sessions.map(s => <SessionRow key={s.id} session={s} instructors={instructors} onChanged={onChanged} />)}
      <div className="border border-dashed border-border rounded-lg p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Add a module</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Module title" className="md:col-span-2 text-sm" />
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
                  startsAt: sessionDateTimeFromInput(startsAt),
                  durationMins: sessionMinutes(duration),
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

/**
 * Editing everything about a programme except its modules.
 *
 * Status and capacity stay as the inline controls on the card: they are changed
 * often and one at a time, and burying them behind an Edit button would make
 * the commonest actions the slowest. Everything else — the words a prospective
 * learner reads, and the picture they see first — lives here.
 */
function ProgramEditor({ program, onDone }: { program: Program; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: program.title,
    tag: program.tag,
    description: program.description,
    startDate: program.startDate,
    format: program.format,
    duration: program.duration,
  });
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(program.thumbnailUrl ?? null);

  const save = useUpdateProgram({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Programme updated' });
        qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
        onDone();
      },
      onError: () => toast({ title: 'Could not save those changes', variant: 'destructive' }),
    },
  });

  const complete = form.title && form.tag && form.description && form.startDate && form.duration;

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        <Input placeholder="Focus area" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} />
        <Input placeholder="Start (e.g. Nov 2026)" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />
        <Input placeholder="Duration (e.g. 4 weeks)" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} />
        <select
          className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          value={form.format} onChange={e => setForm({ ...form, format: e.target.value })}
        >
          <option>Cohort</option><option>Masterclass</option><option>Intensive</option>
        </select>
      </div>
      <Textarea
        placeholder="Description"
        value={form.description}
        onChange={e => setForm({ ...form, description: e.target.value })}
      />

      {/* The image saves itself the moment it is chosen, so it sits outside the
          Save button: nothing is lost if the admin closes the editor after
          changing only the picture. */}
      <ProgramThumbnail
        programId={program.id}
        thumbnailUrl={thumbnailUrl}
        onChanged={(url) => {
          setThumbnailUrl(url);
          qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!complete || save.isPending}
          onClick={() => save.mutate({ id: program.id, data: { ...form } })}
        >
          {save.isPending ? 'Saving...' : 'Save changes'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function ProgramCard({ program, instructors }: { program: Program; instructors: { id: number; name: string; email: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [capacity, setCapacity] = useState(String(program.capacity));

  const update = useUpdateProgram({
    mutation: {
      onSuccess: (updated) => {
        toast({ title: `${updated.title} — ${programStatusNote(updated.status).toLowerCase()}` });
        qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
      },
      onError: () => toast({ title: 'Could not update program', variant: 'destructive' }),
    },
  });

  const setStatus = (status: ProgramStatus) => update.mutate({ id: program.id, data: { status } });

  /** The obvious next move from wherever the programme is now. */
  const next =
    program.status === 'published'
      ? { label: 'Close', status: 'closed' as const, strong: false }
      : program.status === 'closed'
        ? { label: 'Reopen sign-ups', status: 'published' as const, strong: false }
        : program.status === 'archived'
          ? { label: 'Put back on the site', status: 'published' as const, strong: false }
          : { label: 'Publish', status: 'published' as const, strong: true };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* A glance at the picture the catalogue is actually showing, so a
            missing or wrong thumbnail is obvious from the list. */}
        {program.thumbnailUrl && (
          <img
            src={program.thumbnailUrl}
            alt=""
            className="h-12 w-20 shrink-0 rounded-md border border-border object-cover"
          />
        )}
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium">{program.tag}</p>
          <h3 className="font-semibold">{program.title}</h3>
          <p className="text-xs text-muted-foreground">{program.startDate} · {program.format} · {program.duration} · {program.enrolledCount}/{program.capacity} enrolled</p>
          {/* What this state actually does, in words, next to the control that
              changes it — so nobody has to remember what "closed" means. */}
          <p className="text-xs text-muted-foreground/80 mt-0.5">{programStatusNote(program.status)}</p>
        </div>
        <select
          className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          value={program.status}
          onChange={e => setStatus(e.target.value as ProgramStatus)}
        >
          <option value="draft">Draft — hidden</option>
          <option value="published">Published — open for sign-ups</option>
          <option value="closed">Closed — on the site, no sign-ups</option>
          <option value="archived">Archived — off the site</option>
        </select>
        {/* The one press that matters for the state it is in now. The dropdown
            can reach any state; this is the one an admin actually wants. */}
        <Button size="sm" variant={next.strong ? 'default' : 'outline'} disabled={update.isPending} onClick={() => setStatus(next.status)}>
          {next.label}
        </Button>
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
        <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
          <Pencil className="w-4 h-4 mr-1.5" />{editing ? 'Done' : 'Edit'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          Modules {open ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
        </Button>
      </div>
      {editing && <ProgramEditor program={program} onDone={() => setEditing(false)} />}
      {open && <ProgramSessions programId={program.id} instructors={instructors} />}
    </div>
  );
}

/** A blank creation form, kept in one place so opening and closing agree. */
const EMPTY_PROGRAM = {
  tag: '', title: '', description: '', startDate: '', format: 'Cohort', duration: '', capacity: '30',
};

function ProgramsTab({ instructors }: { instructors: { id: number; name: string; email: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: programs = [], isLoading } = useListPrograms();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_PROGRAM);

  const create = useCreateProgram({
    mutation: {
      onSuccess: (_created, variables) => {
        // Which button was pressed decides what the admin is told. "Saved" and
        // "live on the site" are very different things to a person adding a
        // programme, and the message is the only place they find out which.
        const published =
          (variables as { data?: { status?: string } } | undefined)?.data?.status === 'published';
        toast({
          title: published
            ? 'Program published — it is now on the public catalogue'
            : 'Program saved as a draft — nobody can see it yet',
        });
        closeCreate();
        qc.invalidateQueries({ queryKey: getListProgramsQueryKey() });
      },
      onError: () => toast({ title: 'Could not create program', variant: 'destructive' }),
    },
  });

  const canCreate = form.tag && form.title && form.description && form.startDate && form.duration;

  /** Put the panel away and forget what was typed, so it opens clean next time. */
  function closeCreate() {
    setShowCreate(false);
    setForm(EMPTY_PROGRAM);
  }

  function submit(status: 'draft' | 'published') {
    create.mutate({
      data: {
        tag: form.tag, title: form.title, description: form.description,
        startDate: form.startDate, format: form.format, duration: form.duration,
        capacity: Math.max(1, Number(form.capacity) || 30), status,
      },
    });
  }

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
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" disabled={!canCreate || create.isPending} onClick={() => submit('published')}>
              {create.isPending ? 'Saving...' : 'Publish'}
            </Button>
            <Button size="sm" variant="outline" disabled={!canCreate || create.isPending} onClick={() => submit('draft')}>
              Save as draft
            </Button>
            {/* A way out that does not create anything. Called Cancel, not
                Close: closing is what happens to a programme, and the two
                must not read as the same action. */}
            <Button size="sm" variant="ghost" disabled={create.isPending} onClick={closeCreate}>
              Cancel
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Publishing puts the program on the public catalogue straight away and opens sign-ups.
              A draft stays hidden until you publish it from its card. Cancel just closes this form.
            </p>
          </div>
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

/** One programme's cohort: everybody on it, and how they are getting on. */
function CohortSection({
  programme, rows, onStatus, pending,
}: {
  programme: { id: number; title: string; capacity: number; status: string };
  rows: { id: number; userName: string; userEmail: string; status: string }[];
  onStatus: (enrollmentId: number, status: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(true);
  const active = rows.filter(r => r.status === 'enrolled' || r.status === 'completed').length;

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center gap-3 p-5 text-left"
      >
        <div className="min-w-[200px] flex-1">
          <h3 className="font-semibold">{programme.title}</h3>
          <p className="text-xs text-muted-foreground">
            {active} of {programme.capacity} places taken · {rows.length} on this list ·{' '}
            {programStatusNote(programme.status)}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-border">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Nobody on this programme yet. Invite a cohort below.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="p-4">Learner</th><th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-4">
                      <p className="font-medium">{r.userName || r.userEmail}</p>
                      <p className="text-xs text-muted-foreground">{r.userEmail}</p>
                    </td>
                    <td className="p-4">
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        value={r.status}
                        disabled={pending}
                        onChange={ev => onStatus(r.id, ev.target.value)}
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
          )}
        </div>
      )}
    </section>
  );
}

/** People who asked for a place through the public form. */
function WaitlistSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: entries = [], isLoading } = useListWaitlist();
  const update = useUpdateWaitlistEntry({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListWaitlistQueryKey() }),
      onError: () => toast({ title: 'Could not update that entry', variant: 'destructive' }),
    },
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />;

  const counts = {
    waiting: entries.filter(e => e.status === 'waiting').length,
    invited: entries.filter(e => e.status === 'invited').length,
    declined: entries.filter(e => e.status === 'declined').length,
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Waitlist</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {entries.length === 0
          ? 'Nobody has asked for a place yet. The form is on the site under “Join the waitlist”.'
          : `${describeWaitlist(counts)} Invite them with the tool below, then mark them invited.`}
      </p>

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {entries.map(e => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium">{e.name}</p>
                <p className="text-xs text-muted-foreground">{e.email}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  {e.programTitle ?? 'Any future cohort'}
                  {e.note ? ` — ${e.note}` : ''}
                </p>
              </div>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={e.status}
                disabled={update.isPending}
                onChange={ev => update.mutate({ id: e.id, data: { status: ev.target.value as 'waiting' | 'invited' | 'declined' } })}
              >
                <option value="waiting">Waiting</option>
                <option value="invited">Invited</option>
                <option value="declined">Not this time</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Accounts on no programme at all.
 *
 * Everyone who signed up while the door was open. Listed rather than tidied
 * away automatically, because each one is a real person and deciding what
 * happens to them is not a job for a script.
 */
function UnattachedSection() {
  const { data: users = [], isLoading } = useListUnattachedUsers();

  if (isLoading || users.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#B45309]/40 bg-[#FFFBEB] p-5">
      <h3 className="flex items-center gap-2 font-semibold text-[#7C2D12]">
        <CircleAlert className="h-4 w-4" aria-hidden />
        {users.length} account{users.length === 1 ? '' : 's'} on no programme
      </h3>
      <p className="mt-0.5 text-xs text-[#7C2D12]/80">
        These people signed up when anyone could. Enrol them onto a programme with the tool below using
        their email address, or leave them — they can sign in but see nothing until they are on a cohort.
        Nothing here changes anybody on its own.
      </p>
      <ul className="mt-3 divide-y divide-[#B45309]/20">
        {users.map(u => (
          <li key={u.id} className="py-2 text-sm">
            <span className="font-medium">{u.name || '—'}</span>{' '}
            <span className="text-muted-foreground">{u.email}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Enrolments, arranged by programme.
 *
 * One flat table of every learner on every programme told an admin nothing they
 * were actually asking: a cohort is the unit of work here. Each programme now
 * carries its own list, its own count against its places, and the invitation
 * tool sits underneath them all.
 */
function EnrollmentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: enrollments = [], isLoading } = useListAllEnrollments();
  const { data: programmes = [] } = useListPrograms();
  const update = useUpdateEnrollment({
    mutation: {
      onSuccess: () => { toast({ title: 'Enrollment updated' }); qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() }); },
      onError: () => toast({ title: 'Could not update enrollment', variant: 'destructive' }),
    },
  });

  const setStatus = (id: number, status: string) =>
    update.mutate({ id, data: { status: status as 'enrolled' | 'waitlisted' | 'completed' | 'cancelled' } });

  if (isLoading) return <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />;

  return (
    <div className="space-y-6">
      <UnattachedSection />

      {programmes.length === 0 ? (
        <p className="text-muted-foreground">No programmes yet. Create one under Programs.</p>
      ) : (
        programmes.map(p => (
          <CohortSection
            key={p.id}
            programme={p}
            rows={enrollments.filter(e => e.programId === p.id)}
            onStatus={setStatus}
            pending={update.isPending}
          />
        ))
      )}

      <WaitlistSection />

      {/* Inviting a cohort belongs with the cohorts, not with the staff. */}
      <InviteLearners />
    </div>
  );
}

/* ---------- People tab ---------- */

function StaffRow({
  person, canAppoint, onChange, pending, isFounder,
}: {
  person: { id: number; name: string; email: string; role: string; programmes: { programId: number; programTitle: string; sessions: number }[] };
  canAppoint: boolean;
  onChange: (role: string) => void;
  pending: boolean;
  isFounder?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{person.name || '—'}</p>
        <p className="text-xs text-muted-foreground">{person.email}</p>
        {person.programmes.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground/80">
            {person.programmes
              .map(p => `${p.programTitle} (${p.sessions} module${p.sessions === 1 ? '' : 's'})`)
              .join(' · ')}
          </p>
        )}
      </div>
      <div className="text-right">
        <select
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          value={person.role}
          disabled={!canAppoint || pending || isFounder}
          onChange={e => onChange(e.target.value)}
        >
          <option value="learner">Learner</option>
          <option value="instructor">Facilitator</option>
          <option value="admin">Admin</option>
          <option value="superadmin">Super admin</option>
        </select>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isFounder ? 'Set up the Lab. This role cannot be changed.' : (ROLE_NOTES[person.role as keyof typeof ROLE_NOTES] ?? '')}
        </p>
      </div>
    </li>
  );
}

/**
 * The people who run the Lab.
 *
 * This used to be everyone with an account. On a cohort of fifty that is a wall
 * of learners an admin has to read past to find the two facilitators, and it
 * left no way to see who is actually responsible for what. Learners now live
 * under their programme, in Enrollments, where the question about them is
 * always "which cohort, and how are they doing".
 */
function PeopleTab({ selfId }: { selfId: number | undefined }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListStaff();
  const update = useUpdateUserRole({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Role updated' });
        qc.invalidateQueries({ queryKey: getListStaffQueryKey() });
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (err) => toast({
        title: 'Could not update role',
        description: (err as unknown as { error?: string })?.error,
        variant: 'destructive',
      }),
    },
  });

  if (isLoading || !data) return <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />;

  const canAppoint = canAppointStaff(data.you.role);
  const { administrators, facilitators } = groupStaff(data.staff);
  const teaching = facilitators.filter(f => f.programmes.length > 0);
  const unassigned = facilitators.filter(f => f.programmes.length === 0);

  const setRole = (id: number, role: string) =>
    update.mutate({ id, data: { role: role as 'learner' | 'instructor' | 'admin' | 'superadmin' } });

  return (
    <div className="space-y-6">
      <InviteFacilitator canInviteAdmin={canAppoint} />

      {!canAppoint && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Only a super admin can change what someone is allowed to do. You can see the team here and
          assign classes under Programs.
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Administrators</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Super admins appoint staff. Admins run everything else. Nobody can change their own role.
        </p>
        <ul className="mt-2 divide-y divide-border">
          {administrators.map(p => (
            <StaffRow
              key={p.id}
              person={p}
              canAppoint={canAppoint && p.id !== selfId}
              isFounder={p.id === data.founderId}
              pending={update.isPending}
              onChange={role => setRole(p.id, role)}
            />
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Facilitators</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shown with the programmes they are teaching. Assign classes under Programs.
        </p>

        {teaching.length === 0 && unassigned.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No facilitators yet. Invite one above.</p>
        )}

        <ul className="mt-2 divide-y divide-border">
          {teaching.map(p => (
            <StaffRow
              key={p.id}
              person={p}
              canAppoint={canAppoint && p.id !== selfId}
              isFounder={p.id === data.founderId}
              pending={update.isPending}
              onChange={role => setRole(p.id, role)}
            />
          ))}
        </ul>

        {unassigned.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Not teaching anything yet</p>
            <ul className="divide-y divide-border">
              {unassigned.map(p => (
                <StaffRow
                  key={p.id}
                  person={p}
                  canAppoint={canAppoint && p.id !== selfId}
                  isFounder={p.id === data.founderId}
                  pending={update.isPending}
                  onChange={role => setRole(p.id, role)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Learners are not listed here. They belong to a programme, and live under Enrollments.
      </p>
    </div>
  );
}

/* ---------- Simulation Studio tab ---------- */

function ProgrammeSimulations({ program }: { program: Program }) {
  const { data: sessions = [], isLoading } = useListProgramSessions(program.id);
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-display font-bold">{program.title}</h2>
      </div>
      <div className="divide-y divide-border">
        {isLoading ? (
          <div className="p-5 text-sm text-muted-foreground">Loading modules…</div>
        ) : sessions.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">No modules have been added to this programme.</div>
        ) : sessions.map(session => (
          <div key={session.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{session.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatSessionDate(session.startsAt)}</p>
              </div>
              <Button
                size="sm"
                variant={openSessionId === session.id ? 'secondary' : 'outline'}
                onClick={() => setOpenSessionId(openSessionId === session.id ? null : session.id)}
              >
                {openSessionId === session.id ? 'Close Studio' : 'Open Simulation Studio'}
              </Button>
            </div>
            {openSessionId === session.id && (
              <div className="mt-5 pt-5 border-t border-border">
                <SimulationStaffStudio sessionId={session.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SimulationsTab() {
  const { data: programs = [], isLoading } = useListPrograms();

  if (isLoading) {
    return <div className="h-32 bg-muted/40 rounded-2xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold">Simulation Studio</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a module to prepare and run its strategic communications simulation.
        </p>
      </div>
      {programs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create a programme and its modules before preparing a simulation.</p>
      ) : programs.map(program => (
        <ProgrammeSimulations key={program.id} program={program} />
      ))}
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
        <p className="text-muted-foreground">Manage programs, modules, enrollments, people, and class recordings.</p>
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
      {tab === 'Simulation Studio' && <SimulationsTab />}
      {tab === 'Enrollments' && <EnrollmentsTab />}
      {tab === 'People' && <PeopleTab selfId={user?.id} />}
      {tab === 'Recordings' && <RecordingsAdmin />}
    </div>
  );
}
