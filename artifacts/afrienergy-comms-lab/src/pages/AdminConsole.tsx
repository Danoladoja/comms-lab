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
  useRemoveEnrollment,
  useListInvitations,
  useRevokeInvitation,
  useResendInvitation,
  getListInvitationsQueryKey,
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
  type Invitation,
} from '@workspace/api-client-react';
import {
  ROLE_NOTES,
  ROLE_LABELS,
  isStaffRole,
  satisfiesRole,
  findPeople,
  describeAppointment,
  MIN_SEARCH,
  daysWaiting,
  inviteWorthChasing,
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
  apiReason,
} from '@workspace/domain';
import CourseworkStudio from '@/components/CourseworkStudio';
import InviteFacilitator from '@/components/InviteFacilitator';
import InviteLearners from '@/components/InviteLearners';
import LiveSessionsAdmin from '@/components/LiveSessionsAdmin';
import RecordingsAdmin from '@/components/RecordingsAdmin';
import ProgramThumbnail from '@/components/ProgramThumbnail';
import { isMeasurableRecording } from '@/lib/embed';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronUp, Plus, Trash2, CircleAlert, Pencil, Clock, Send, X } from 'lucide-react';

const TABS = ['Programmes', 'Live Sessions', 'Enrolments', 'People', 'Recordings'] as const;
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
      onError: () => toast({ title: 'Could not update programme', variant: 'destructive' }),
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
      onError: () => toast({ title: 'Could not create programme', variant: 'destructive' }),
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

/**
 * The value that means "take this person off the programme entirely".
 *
 * Not a status — no enrolment is ever saved as this. It rides in the same menu
 * as the statuses because that menu is where an admin already goes to change
 * what somebody's place on a cohort is, and deleting the record is the far end
 * of that same question.
 */
const DELETE_CHOICE = '__delete';

/**
 * Invitations sent for this cohort that nobody has answered yet.
 *
 * These used to sit under People, stacked in with the facilitators and admins,
 * which meant a cohort of fifty buried the two members of staff an admin had
 * come to find — and gave no way at all to see who on *this* programme had not
 * turned up yet. An invited learner is a fact about a cohort, so it belongs
 * under the cohort.
 */
function InvitedLearners({
  invites, onResend, onWithdraw, pending,
}: {
  invites: Invitation[];
  onResend: (invite: Invitation) => void;
  onWithdraw: (invite: Invitation) => void;
  pending: boolean;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="border-t border-border bg-muted/20 p-5">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        Invited, not yet accepted
        <span className="font-normal text-muted-foreground">({invites.length})</span>
      </h4>
      <p className="mt-0.5 text-xs text-muted-foreground">
        They have a link in their inbox and no account here yet. They join the list above the
        moment they accept.
      </p>

      <ul className="mt-3 divide-y divide-border">
        {invites.map(i => {
          const days = daysWaiting(i.createdAt);
          const chase = inviteWorthChasing(i);
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium">{i.email}</p>
                <p className="text-xs text-muted-foreground">
                  {days === null
                    ? 'Invited'
                    : days === 0
                      ? 'Invited today'
                      : `Invited ${days} day${days === 1 ? '' : 's'} ago`}
                  {chase && (
                    <span className="ml-1.5 text-[#B45309]">· worth sending again</span>
                  )}
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                {/* Sending again is the ordinary case, so it reads as ordinary:
                    most unanswered invitations went to spam rather than being
                    refused. Withdrawing is the destructive one and looks it. */}
                <Button
                  variant="outline" size="sm"
                  disabled={pending}
                  onClick={() => onResend(i)}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Send again
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  onClick={() => onWithdraw(i)}
                >
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Withdraw
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One programme's cohort: everybody on it, and how they are getting on. */
function CohortSection({
  programme, rows, invites, onStatus, onRemove, onResend, onWithdraw, pending,
}: {
  programme: { id: number; title: string; capacity: number; status: string };
  rows: { id: number; userName: string; userEmail: string; status: string }[];
  invites: Invitation[];
  onStatus: (enrollmentId: number, status: string) => void;
  onRemove: (enrollmentId: number, who: string) => void;
  onResend: (invite: Invitation) => void;
  onWithdraw: (invite: Invitation) => void;
  pending: boolean;
}) {
  /*
   * Shut, until an admin asks.
   *
   * Open by default, four programmes of fifty put two hundred names on the
   * screen before anybody had asked a question about any of them, and the
   * counts — which are the thing you actually come here to read — were pushed
   * off the bottom. Closed, the page is the list of cohorts and how full each
   * one is, and the names are one click away.
   */
  const [open, setOpen] = useState(false);
  const active = rows.filter(r => r.status === 'enrolled' || r.status === 'completed').length;

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-3 p-5 text-left"
      >
        <div className="min-w-[200px] flex-1">
          <h3 className="font-semibold">{programme.title}</h3>
          <p className="text-xs text-muted-foreground">
            {active} of {programme.capacity} places taken · {rows.length} on this list
            {invites.length > 0 && ` · ${invites.length} invited, not yet accepted`} ·{' '}
            {programStatusNote(programme.status)}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="border-t border-border">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              {invites.length > 0
                ? 'Nobody has accepted yet. The invitations sent are below.'
                : 'Nobody on this programme yet. Invite a cohort below.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="p-4">Learner</th><th className="p-4">Their place on this programme</th>
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
                      {/*
                        One menu, because there is really only one question here:
                        what is this person's place on this programme? Removed
                        revokes access and keeps the record — that is the tool
                        for somebody taken off a cohort for cause. Deleting the
                        record is the separate, rarer thing, and it is worded as
                        what it does rather than as another status.

                        A controlled select makes the confirm safe: decline it
                        and React re-renders the original value, so a mis-click
                        changes nothing.
                      */}
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                        value={r.status}
                        disabled={pending}
                        aria-label={`Place of ${r.userName || r.userEmail} on ${programme.title}`}
                        onChange={ev => {
                          if (ev.target.value === DELETE_CHOICE) {
                            onRemove(r.id, r.userName || r.userEmail);
                          } else {
                            onStatus(r.id, ev.target.value);
                          }
                        }}
                      >
                        <optgroup label="On the programme">
                          <option value="enrolled">Enrolled</option>
                          <option value="waitlisted">Waitlisted</option>
                          <option value="completed">Completed</option>
                        </optgroup>
                        <optgroup label="Access revoked">
                          <option value="cancelled">Removed — keeps the record</option>
                        </optgroup>
                        <optgroup label="Careful">
                          <option value={DELETE_CHOICE}>Delete the record entirely…</option>
                        </optgroup>
                      </select>
                      {r.status === 'cancelled' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Removed. They can sign in but cannot open this programme, its classes or
                          its Studio work.
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <InvitedLearners
            invites={invites}
            onResend={onResend}
            onWithdraw={onWithdraw}
            pending={pending}
          />
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
  const { data: invitations = [] } = useListInvitations({
    query: { queryKey: getListInvitationsQueryKey(), retry: false },
  });
  const update = useUpdateEnrollment({
    mutation: {
      onSuccess: () => { toast({ title: 'Enrolment updated' }); qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() }); },
      onError: () => toast({ title: 'Could not update enrolment', variant: 'destructive' }),
    },
  });
  const remove = useRemoveEnrollment({
    mutation: {
      onSuccess: () => { toast({ title: 'Removed from the programme' }); qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() }); },
      onError: (err) => toast({
        title: 'Could not remove them',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const refreshInvites = () => qc.invalidateQueries({ queryKey: getListInvitationsQueryKey() });

  const resend = useResendInvitation({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Invitation sent again', description: 'The earlier link no longer works.' });
        refreshInvites();
      },
      onError: (err) => toast({
        title: 'Could not send it again',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const withdraw = useRevokeInvitation({
    mutation: {
      onSuccess: () => { toast({ title: 'Invitation withdrawn' }); refreshInvites(); },
      onError: (err) => toast({
        title: 'Could not withdraw it',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const setStatus = (id: number, status: string) =>
    update.mutate({ id, data: { status: status as 'enrolled' | 'waitlisted' | 'completed' | 'cancelled' } });

  const removeFromProgramme = (id: number, who: string) => {
    if (!confirm(`Delete ${who}'s record on this programme? Their work and progress on it go too, and this cannot be undone. To revoke their access but keep the record, choose "Removed" instead.`)) return;
    remove.mutate({ id });
  };

  const withdrawInvite = (invite: Invitation) => {
    if (!confirm(`Withdraw the invitation to ${invite.email}? Their link stops working. To give them another one instead, choose Send again.`)) return;
    withdraw.mutate({ id: invite.id });
  };

  // Learners only, and only the ones who have not arrived. A facilitator's
  // invitation is not a fact about a cohort, and an accepted one is a person in
  // the list above rather than a line in this one.
  const invitesFor = (programId: number) =>
    invitations.filter(i => i.role === 'learner' && !i.acceptedAt && i.programId === programId);

  // Invited before this console recorded which programme they were invited to,
  // or invited onto a programme that has since been deleted. Rare, but they are
  // real people with live links, and a list they cannot appear in is a list
  // that quietly loses them.
  const homeless = invitations.filter(i => i.role === 'learner' && !i.acceptedAt && !i.programId);

  const invitesPending = resend.isPending || withdraw.isPending;

  if (isLoading) return <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />;

  return (
    <div className="space-y-6">
      <UnattachedSection />

      {programmes.length === 0 ? (
        <p className="text-muted-foreground">No programmes yet. Create one under Programmes.</p>
      ) : (
        programmes.map(p => (
          <CohortSection
            key={p.id}
            programme={p}
            rows={enrollments.filter(e => e.programId === p.id)}
            invites={invitesFor(p.id)}
            onStatus={setStatus}
            onRemove={removeFromProgramme}
            onResend={(i) => resend.mutate({ id: i.id })}
            onWithdraw={withdrawInvite}
            pending={update.isPending || remove.isPending || invitesPending}
          />
        ))
      )}

      {homeless.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="p-5 pb-0">
            <h3 className="font-semibold">Invited, but not to a programme</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Either they were invited before the Lab recorded which cohort an invitation was for, or
              that programme has since been deleted. Withdraw them, or invite them again to a
              programme with the tool below.
            </p>
          </div>
          <InvitedLearners
            invites={homeless}
            onResend={(i) => resend.mutate({ id: i.id })}
            onWithdraw={withdrawInvite}
            pending={invitesPending}
          />
        </section>
      )}

      <WaitlistSection />

      {/* Inviting a cohort belongs with the cohorts, not with the staff. */}
      <InviteLearners />
    </div>
  );
}

/* ---------- People tab ---------- */

function StaffRow({
  person, canAppoint, onChange, onRemove, pending, isFounder,
}: {
  person: { id: number; name: string; email: string; role: string; programmes: { programId: number; programTitle: string; sessions: number }[] };
  canAppoint: boolean;
  onChange: (role: string) => void;
  onRemove: () => void;
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

      {/* Removing somebody from staff takes their access away and leaves the
          person alone: their account, their coursework and any certificate stay
          exactly where they are. Deleting a person outright is not offered,
          because it would take a learner's own record with it. */}
      {canAppoint && !isFounder && (
        <Button
          variant="ghost" size="sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={onRemove}
        >
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
          Remove
        </Button>
      )}
    </li>
  );
}

/**
 * Appointing somebody who is already here.
 *
 * Inviting is for a stranger. It is refused, correctly, for anybody with an
 * account: they cannot be invited to a place they already are. But the refusal
 * used to say "change their role in the list below", and the list below is the
 * staff list, which by design does not contain learners — so an admin trying to
 * promote an enrolled learner was sent to a list that could never contain them,
 * and the only route left was the database.
 *
 * A search rather than another list. The reason People stopped showing every
 * account is that a cohort of fifty buried the four people who run the place;
 * putting the fifty back to solve this would undo that.
 */
function AppointExisting({ people, selfId, pending, onAppoint }: {
  people: { id: number; name: string; email: string; role: string }[];
  selfId: number | undefined;
  pending: boolean;
  onAppoint: (person: { id: number; name: string; email: string; role: string }, role: string) => void;
}) {
  const [query, setQuery] = useState('');
  // Nobody appoints themselves — the server refuses it, so offering it here
  // would only produce an error the admin could have been spared.
  const matches = findPeople(query, people, { exclude: selfId ? [selfId] : [] });
  const searching = query.trim().length >= MIN_SEARCH;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-semibold">Already has an account?</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Somebody who is already on the Lab — a learner on one of your cohorts, say — cannot be
        invited, because they are already here. Find them by name or email address and appoint them
        instead. They keep their place on any programme.
      </p>

      <Input
        className="mt-3 max-w-md text-sm"
        placeholder="Type a name or an email address"
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label="Find somebody who already has an account"
      />

      {searching && matches.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nobody matches that. Check the spelling, or invite them above if they have never signed in.
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {matches.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium">{p.name || p.email || '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {p.email}
                  {' · '}
                  <span className="capitalize">{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</span>
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="hidden max-w-[260px] text-xs text-muted-foreground sm:block">
                  {describeAppointment(p, 'admin')}
                </span>
                <Button
                  size="sm" variant="outline"
                  disabled={pending || p.role === 'instructor'}
                  onClick={() => onAppoint(p, 'instructor')}
                >
                  Make facilitator
                </Button>
                <Button
                  size="sm"
                  disabled={pending || p.role === 'admin' || p.role === 'superadmin'}
                  onClick={() => onAppoint(p, 'admin')}
                >
                  Make admin
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
function PeopleTab({ selfId, everybody }: {
  selfId: number | undefined;
  everybody: { id: number; name: string; email: string; role: string }[];
}) {
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
        description: apiReason(err, 'Try again in a moment.'),
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

  /**
   * Take somebody off the staff.
   *
   * This makes them a learner again rather than deleting anything. A person who
   * facilitated a cohort has learners' work attached to them, and somebody who
   * was made an admin may also be enrolled on a programme; erasing the account
   * would take all of that with it.
   */
  const removeFromStaff = (person: { id: number; name: string; email: string; role: string }) => {
    const who = person.name || person.email;
    const what = person.role === 'instructor' ? 'a facilitator' : 'an administrator';
    if (!confirm(`Remove ${who} as ${what}? They keep their account and anything they have done, but lose access to the console and the teaching area.`)) return;
    setRole(person.id, 'learner');
  };

  /** Appointing a person who is already on the Lab, from the search below. */
  const appoint = (person: { id: number; name: string; email: string; role: string }, role: string) => {
    const who = person.name || person.email;
    const what = role === 'admin' ? 'an admin' : 'a facilitator';
    if (!confirm(`Make ${who} ${what}? ${describeAppointment(person, role)}`)) return;
    setRole(person.id, role);
  };

  return (
    <div className="space-y-6">
      <InviteFacilitator canInviteAdmin={canAppoint} />

      {canAppoint && (
        <AppointExisting
          people={everybody}
          selfId={selfId}
          pending={update.isPending}
          onAppoint={appoint}
        />
      )}

      {!canAppoint && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Only a super admin can change what someone is allowed to do. You can see the team here and
          assign classes under Programmes.
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
              onRemove={() => removeFromStaff(p)}
            />
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Facilitators</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Shown with the programmes they are teaching. Assign classes under Programmes.
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
              onRemove={() => removeFromStaff(p)}
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
                  onRemove={() => removeFromStaff(p)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Learners are not listed here. They belong to a programme, and live under Enrolments. To make
        one of them staff, find them in “Already has an account?” above.
      </p>
    </div>
  );
}

/* ---------- Console ---------- */

export default function AdminConsole() {
  const { role, user, isLoading } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('Programmes');
  const isStaffAdmin = satisfiesRole(role, ['admin']);
  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: isStaffAdmin } });
  const instructors = users.filter(u => isStaffRole(u.role));

  if (!isLoading && !isStaffAdmin) {
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
        <p className="text-muted-foreground">Manage programmes, modules, enrolments, people and class recordings.</p>
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

      {tab === 'Programmes' && <ProgramsTab instructors={instructors} />}
      {tab === 'Live Sessions' && <LiveSessionsAdmin />}
      {tab === 'Enrolments' && <EnrollmentsTab />}
      {tab === 'People' && <PeopleTab selfId={user?.id} everybody={users} />}
      {tab === 'Recordings' && <RecordingsAdmin />}
    </div>
  );
}
