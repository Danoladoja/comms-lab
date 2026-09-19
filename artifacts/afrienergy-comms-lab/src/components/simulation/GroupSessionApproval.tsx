import { useState } from 'react';
import {
  useListGroupSessions,
  usePlanGroupSession,
  useEditGroupSession,
  useApproveGroupSession,
  getListGroupSessionsQueryKey,
  useListProgramSessions,
  getListProgramSessionsQueryKey,
  type GroupSession,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiReason, sessionDateTimeFromInput, sessionDateTimeInput } from '@workspace/domain';
import { useToast } from '@/hooks/use-toast';
import { Users, Clock, AlertTriangle, CheckCircle2, Loader2, DoorOpen, PhoneCall } from 'lucide-react';

/**
 * Planning a group session, and reading it before anybody else can.
 *
 * The gate the whole design rests on. An unfacilitated session cannot be steered
 * once it starts — there is nobody at the front of the room to soften a beat
 * that lands wrong — so the reading has to happen before rather than during.
 *
 * What this screen refuses to do is imply more vetting than it can deliver. A
 * beat that lands on every team is shown in the words it will use. A beat that
 * lands on one team is shown as what it is for, and says so, because its wording
 * quotes a learner who has not answered yet and cannot exist in advance.
 */
export default function GroupSessionApproval({ programmes }: { programmes: { id: number; title: string }[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [programId, setProgramId] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: sessions = [] } = useListGroupSessions({
    query: {
      queryKey: getListGroupSessionsQueryKey(),
      /*
        Fast while a room is open, slow otherwise.

        The one minute this screen has to be live is the first five of a
        session, when knowing who is not in the room is still actionable. The
        rest of the time a session's state changes over days.
      */
      refetchInterval: (query) => {
        const rows = query.state.data as { state?: string }[] | undefined;
        return rows?.some((r) => r.state === 'live') ? 15_000 : 60_000;
      },
      // An admin watching who has turned up has their phone in their hand and
      // this window behind something else.
      refetchIntervalInBackground: true,
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: getListGroupSessionsQueryKey() });

  const plan = usePlanGroupSession({
    mutation: {
      onSuccess: (s) => {
        setOpenId(s.id);
        refresh();
        toast({ title: 'Session drafted', description: 'Read it before anybody else can.' });
      },
      onError: (err) => toast({
        title: 'Could not plan the session',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const open = sessions.find((s) => s.id === openId) ?? null;

  return (
    <div className="p-5 bg-white/[0.02] border border-white/10 relative">
      <div className="absolute top-0 left-0 w-1 h-full bg-[#f97316]" />
      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-1">
        <Users className="w-4 h-4 text-[#f97316]" aria-hidden /> Group session
      </h3>
      <p className="text-xs text-white/50 mb-4">
        One crisis, several teams inside it, nobody at the front of the room. Nothing reaches the
        cohort until you have read it.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <select
          className="flex-1 bg-[#030811] border border-white/20 text-white px-3 py-2 text-sm"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
        >
          <option value="">Choose a programme…</option>
          {programmes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <button
          type="button"
          disabled={!programId || plan.isPending}
          onClick={() => plan.mutate({ data: { programId: Number(programId) } })}
          className="bg-[#f97316] text-[#030811] px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest disabled:opacity-50 inline-flex items-center gap-2"
        >
          {plan.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          {plan.isPending ? 'Writing it…' : 'Plan a session'}
        </button>
      </div>

      {sessions.length > 0 && (
        <ul className="mt-4 divide-y divide-white/10 border-t border-white/10">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpenId(openId === s.id ? null : s.id)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{s.title || 'Untitled session'}</span>
                  <span className="block text-xs text-white/40">
                    {s.learners} on the cohort · {s.teams.length} teams · {s.durationMinutes} min
                  </span>
                </span>
                <StateChip state={s.state} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <SessionSheet session={open} onChanged={refresh} />}
    </div>
  );
}

function StateChip({ state }: { state: GroupSession['state'] }) {
  const look: Record<GroupSession['state'], string> = {
    draft: 'bg-white/10 text-white/60',
    scheduled: 'bg-[#f97316]/20 text-[#f97316]',
    live: 'bg-emerald-500/20 text-emerald-300',
    finished: 'bg-white/5 text-white/40',
  };
  const says: Record<GroupSession['state'], string> = {
    draft: 'Not read yet', scheduled: 'Approved', live: 'Running', finished: 'Finished',
  };
  return (
    <span className={`flex-none px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${look[state]}`}>
      {says[state]}
    </span>
  );
}

function SessionSheet({ session, onChanged }: { session: GroupSession; onChanged: () => void }) {
  const { toast } = useToast();
  const [when, setWhen] = useState(
    session.scheduledAt ? sessionDateTimeInput(session.scheduledAt as unknown as string) : '',
  );

  const edit = useEditGroupSession({
    mutation: {
      onSuccess: () => onChanged(),
      onError: (err) => toast({
        title: 'Could not change it',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const approve = useApproveGroupSession({
    mutation: {
      onSuccess: () => {
        onChanged();
        toast({ title: 'Session approved', description: 'The cohort can be told. It starts itself.' });
      },
      onError: (err) => toast({
        title: 'Not approved',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const toggle = (id: string, enabled: boolean) =>
    edit.mutate({ id: session.id, data: { objectives: [{ id, enabled }] } });

  return (
    <div className="mt-5 border-t border-white/10 pt-5 space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">The crisis</p>
        <p className="text-sm text-white/80 leading-relaxed">{session.openingBrief}</p>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">The teams</p>
        <div className="flex flex-wrap gap-2">
          {session.teams.map((t) => (
            <span key={t.id} className="border border-white/15 px-2.5 py-1 text-xs text-white/70">
              {t.name} <span className="text-white/35">· {t.roleName}</span>
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
          What it will test — the debriefs are written against these
        </p>
        <ul className="space-y-2">
          {session.objectives.map((o) => (
            <li key={o.id} className="flex gap-3 border border-white/10 p-3">
              <input
                type="checkbox"
                className="mt-1 flex-none"
                checked={o.enabled}
                disabled={!session.mayEdit || edit.isPending}
                aria-label={`Test: ${o.text}`}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              <span className={o.enabled ? '' : 'opacity-45'}>
                <span className="block text-sm font-medium text-white">{o.text}</span>
                <span className="block text-xs text-white/50 mt-0.5">{o.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">What happens, and when</p>
        <ol className="space-y-2">
          {session.beats.map((b) => (
            <li key={b.id} className="flex gap-3">
              <span className="flex-none w-12 pt-0.5 font-mono text-xs text-[#f97316] tabular-nums">
                {b.atMinute}m
              </span>
              <span className="min-w-0 border-l border-white/10 pl-3 pb-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{b.title}</span>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                    b.scope === 'all' ? 'bg-[#f97316]/20 text-[#f97316]' : 'bg-teal-400/15 text-teal-300'
                  }`}>
                    {b.scope === 'all' ? 'All teams' : 'One team'}
                  </span>
                </span>
                <span className="block text-xs text-white/70 mt-1 leading-relaxed">{b.content}</span>
                {/* The sentence that keeps the approval honest. */}
                <span className="block text-[11px] text-white/35 mt-1">{b.approvalNote}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <label className="block text-xs text-white/50">
          When it runs
          <input
            type="datetime-local"
            className="mt-1 block bg-[#030811] border border-white/20 text-white px-2 py-2 text-sm"
            value={when}
            disabled={!session.mayEdit}
            onChange={(e) => {
              setWhen(e.target.value);
              const iso = sessionDateTimeFromInput(e.target.value);
              if (iso) edit.mutate({ id: session.id, data: { scheduledAt: iso } });
            }}
          />
        </label>
      </div>

      {/* Which module it is. This is what gets the cohort reminded, and it is
          the only lever there is: the session cannot be rescheduled, so
          everything has to happen before it opens. */}
      <ModuleLink session={session} onPick={(id) => edit.mutate({ id: session.id, data: { sessionId: id } })} />

      {/* While it is running, who is not in the room. */}
      <WhoIsMissing session={session} />

      {session.problem && (
        <div className="flex gap-2 border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-none mt-0.5" aria-hidden />
          <span>{session.problem}</span>
        </div>
      )}

      {session.mayEdit ? (
        <div>
          <button
            type="button"
            disabled={!!session.problem || approve.isPending}
            onClick={() => {
              if (!confirm(
                'Make this live? The cohort can be told, teams are assigned when it starts, and it '
                + 'cannot be edited afterwards.',
              )) return;
              approve.mutate({ id: session.id });
            }}
            className="bg-[#f97316] text-[#030811] px-6 py-3 text-[11px] font-bold uppercase tracking-widest disabled:opacity-40"
          >
            {approve.isPending ? 'Approving…' : 'Make it live'}
          </button>
          <p className="mt-2 text-xs text-white/40">
            Until you press this, nobody on the cohort can see that this session exists.
          </p>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-xs text-white/50">
          <CheckCircle2 className="w-4 h-4 flex-none mt-0.5 text-emerald-400" aria-hidden />
          Approved. The cohort has been told what they are turning up to, so it cannot be edited now —
          cancel it and plan another rather than changing this one underneath them.
        </p>
      )}

      <p className="flex items-center gap-2 text-[11px] text-white/35">
        <Clock className="w-3.5 h-3.5" aria-hidden />
        Runs for {session.durationMinutes} minutes and ends itself. No one has to be there to drive it.
      </p>

      {session.sessionDebrief && <SharedDebrief debrief={session.sessionDebrief} />}
    </div>
  );
}

/**
 * The read across every team, which only an admin gets.
 *
 * This is the genuinely new thing a group exercise produces. Each team saw one
 * side of the crisis and is judged on that side; nobody who was in the room can
 * see where two teams' versions of events failed to line up, because nobody was
 * in more than one team. That gap is where the teaching is, so it is given the
 * most room on the page rather than being tucked under a heading.
 */
function SharedDebrief({ debrief }: { debrief: NonNullable<GroupSession['sessionDebrief']> }) {
  return (
    <div className="border-t border-white/10 pt-6">
      <p className="text-[10px] uppercase tracking-widest text-[#f97316] mb-2">
        Across the whole room · yours alone
      </p>
      <h4 className="text-base font-bold text-white leading-snug mb-3">{debrief.headline}</h4>
      {debrief.whatHappened && (
        <p className="text-sm text-white/75 leading-relaxed mb-6">{debrief.whatHappened}</p>
      )}

      {debrief.contradictions.length > 0 && (
        <div className="mb-6 border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-[10px] uppercase tracking-widest text-amber-300 mb-2">
            Where two teams did not tell the same story
          </p>
          <ul className="space-y-2">
            {debrief.contradictions.map((line, i) => (
              <li key={i} className="text-sm text-amber-100/85 leading-relaxed">{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Against what it tested</p>
        <ul className="space-y-3">
          {debrief.byObjective.map((item, i) => (
            <li key={i} className="border-l-2 border-white/15 pl-3">
              <p className="text-sm font-medium text-white">{item.objective}</p>
              <p className="text-sm text-white/65 leading-relaxed mt-0.5">{item.verdict}</p>
            </li>
          ))}
        </ul>
      </div>

      {debrief.recommendations.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">What to teach next</p>
          <ul className="space-y-1.5">
            {debrief.recommendations.map((line, i) => (
              <li key={i} className="text-sm text-white/75 leading-relaxed">— {line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Which module this session is.
 *
 * A group session cannot be rescheduled and should not be — one room, one
 * moment, and a clock nobody controls is the exercise. So the only thing that
 * can be done about somebody missing it is done beforehand, and being a module
 * is almost all of it: the Lab's reminder job reads modules and emails every
 * enrolled learner the day before and the hour before. A group session was
 * invisible to it and sent nothing at all.
 *
 * Choosing one also sets the module's date to this session's, so the cohort is
 * never emailed for one time and let in at another.
 */
function ModuleLink({ session, onPick }: {
  session: GroupSession;
  onPick: (id: number | null) => void;
}) {
  const { data: modules = [] } = useListProgramSessions(session.programId, {
    query: { queryKey: getListProgramSessionsQueryKey(session.programId) },
  });
  const simulations = modules.filter((m: { kind?: string }) => m.kind === 'simulation');

  if (!session.mayEdit) {
    return (
      <p className="text-xs text-white/50">
        {session.moduleTitle
          ? `This session is ${session.moduleTitle}. The cohort is reminded the day before, an hour before, and again the moment it opens.`
          : 'This session is not a module, so nobody is reminded about it. It can only be made one while it is still a draft.'}
      </p>
    );
  }

  if (simulations.length === 0) {
    return (
      <p className="text-xs text-white/45 leading-relaxed">
        Nobody will be reminded about this. To have the Lab email the cohort the day before, an hour
        before and the moment it opens, add a module to the programme and choose{' '}
        <span className="text-white/70">Simulation exercise</span> instead of Live class, then come
        back and pick it here.
      </p>
    );
  }

  return (
    <label className="block text-xs text-white/50">
      Which module this is
      <select
        className="mt-1 block w-full bg-[#030811] border border-white/20 text-white px-2 py-2 text-sm"
        value={session.sessionId ?? ''}
        onChange={(e) => onPick(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Not a module — nobody is reminded</option>
        {simulations.map((m: { id: number; title: string }) => (
          <option key={m.id} value={m.id}>{m.title}</option>
        ))}
      </select>
      <span className="mt-1.5 block text-[11px] text-white/45 leading-relaxed">
        {session.sessionId
          ? 'The cohort is emailed the day before, an hour before, and the moment the door opens. Turning up counts towards the programme, and the module after this one waits on it.'
          : 'Nobody is told this is happening except by you. A group session sends no invitation of its own.'}
      </span>
    </label>
  );
}

/**
 * Who has not walked in.
 *
 * The session cannot be paused and cannot be run again, so this is the last
 * useful thing anybody can do about it: ring the three people who are not here,
 * in the first five minutes, while being late still costs them less than
 * missing it.
 *
 * Refreshed on its own short loop, including when the tab is not the one being
 * looked at — an admin watching this has almost certainly got their phone in
 * their hand and this window behind something else.
 */
function WhoIsMissing({ session }: { session: GroupSession }) {
  const missing = session.missing ?? [];
  const entered = session.entered ?? 0;
  const expected = session.expected ?? 0;
  if (session.state !== 'live' || expected === 0) return null;

  return (
    <div className="border border-white/10 bg-white/[0.02] p-4">
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 mb-2">
        <DoorOpen className="w-3.5 h-3.5" aria-hidden />
        {entered} of {expected} are in
      </p>
      {missing.length === 0 ? (
        <p className="text-xs text-white/60">Everybody turned up.</p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-xs text-white/60 mb-3 leading-relaxed">
            <PhoneCall className="w-3.5 h-3.5 flex-none" aria-hidden />
            It will not wait for them and it is not run again. Ringing them now is the only thing
            that helps.
          </p>
          <ul className="space-y-1">
            {missing.map((m) => (
              <li key={m.userId} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-white/85 truncate">{m.name}</span>
                <a href={`mailto:${m.email}`} className="text-white/35 hover:text-[#f97316] truncate">
                  {m.email}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
