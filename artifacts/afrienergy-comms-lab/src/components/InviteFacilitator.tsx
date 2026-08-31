import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListInvitations, useInviteFacilitator, useRevokeInvitation,
  useListPrograms, useListProgramSessions,
  getListInvitationsQueryKey, getListUsersQueryKey, getListProgramSessionsQueryKey,
} from '@workspace/api-client-react';
import { MAX_SESSIONS_PER_INVITE } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Mail, X, Check, Clock } from 'lucide-react';

/**
 * Inviting a facilitator instead of asking them to sign up.
 *
 * The people teaching here are senior practitioners giving their time for
 * nothing. This exists so the admin can do the whole setup — invite, role,
 * classes — in one action, and the facilitator's entire involvement is clicking
 * a link in their inbox.
 */
export default function InviteFacilitator({ canInviteAdmin = false }: { canInviteAdmin?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  // Only a super admin sees this choice, and the server checks again: an
  // invitation that could grant admin on the strength of a hidden form field
  // would be no protection at all.
  const [role, setRole] = useState<'instructor' | 'admin'>('instructor');
  const [programId, setProgramId] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);

  const { data: invitations = [] } = useListInvitations({
    query: { queryKey: getListInvitationsQueryKey(), retry: false },
  });
  const { data: programs = [] } = useListPrograms();
  const { data: sessions = [] } = useListProgramSessions(programId ?? 0, {
    query: {
      queryKey: getListProgramSessionsQueryKey(programId ?? 0),
      enabled: programId !== null,
      retry: false,
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
    qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
  };

  const invite = useInviteFacilitator({
    mutation: {
      onSuccess: () => {
        toast({
          title: 'Invitation sent',
          description: `${email} will arrive as a facilitator with their classes already assigned.`,
        });
        setEmail(''); setName(''); setChosen([]); refresh();
      },
      onError: (err) => toast({
        title: 'Could not send that invitation',
        description: (err as unknown as { error?: string })?.error,
        variant: 'destructive',
      }),
    },
  });

  const revoke = useRevokeInvitation({
    mutation: {
      onSuccess: () => { toast({ title: 'Invitation withdrawn' }); refresh(); },
      onError: (err) => toast({
        title: 'Could not withdraw it',
        description: (err as unknown as { error?: string })?.error,
        variant: 'destructive',
      }),
    },
  });

  const toggle = (id: number) =>
    setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : c.length >= MAX_SESSIONS_PER_INVITE ? c : [...c, id]));

  const pending = invitations.filter(i => !i.acceptedAt);
  const arrived = invitations.filter(i => i.acceptedAt);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {canInviteAdmin ? 'Invite a facilitator or admin' : 'Invite a facilitator'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            They get one email with one link. No password to invent, and they arrive in the role you
            choose — a facilitator with their classes already assigned, or an admin.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Their name"
            className="text-sm flex-1 min-w-[160px]"
            aria-label="Their name"
          />
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="their.name@organisation.org"
            className="text-sm flex-1 min-w-[240px]"
            aria-label="Email address"
          />
          {canInviteAdmin && (
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={role}
              onChange={e => setRole(e.target.value as 'instructor' | 'admin')}
              aria-label="Role"
            >
              <option value="instructor">Facilitator</option>
              <option value="admin">Admin</option>
            </select>
          )}
          <Button
            size="sm"
            disabled={!email.trim() || invite.isPending}
            onClick={() => invite.mutate({
              data: {
                email: email.trim(),
                role: canInviteAdmin ? role : 'instructor',
                sessionIds: role === 'admin' ? [] : chosen,
              },
            })}
          >
            <Mail className="w-4 h-4 mr-1.5" aria-hidden />
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>

        <div className={`space-y-2 border-t border-border pt-3 ${role === 'admin' ? 'hidden' : ''}`}>
          <p className="text-xs font-medium">
            Which classes will they teach?
            <span className="font-normal text-muted-foreground"> — optional, and you can assign more later</span>
          </p>

          <select
            value={programId ?? ''}
            onChange={e => setProgramId(e.target.value ? Number(e.target.value) : null)}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-background w-full max-w-sm"
            aria-label="Programme"
          >
            <option value="">Choose a programme…</option>
            {programs.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>

          {programId !== null && sessions.length === 0 && (
            <p className="text-xs text-muted-foreground">This programme has no classes yet.</p>
          )}

          {sessions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sessions.map(s => {
                const picked = chosen.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={picked}
                    className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
                      picked
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {picked && <Check className="w-3 h-3 inline mr-1" aria-hidden />}
                    {s.title}
                  </button>
                );
              })}
            </div>
          )}

          {chosen.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {chosen.length} class{chosen.length === 1 ? '' : 'es'} selected. A class that already has a
              facilitator by the time they accept is left alone.
            </p>
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            Invited, not yet arrived
          </h3>
          <ul className="divide-y divide-border">
            {pending.map(i => (
              <li key={i.id} className="py-2 flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{i.email}</span>
                  <span className="block text-xs text-muted-foreground">{i.summary}</span>
                </span>
                <Button
                  variant="ghost" size="sm"
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ id: i.id })}
                >
                  <X className="w-3.5 h-3.5 mr-1" aria-hidden />Withdraw
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {arrived.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {arrived.length} invited facilitator{arrived.length === 1 ? ' has' : 's have'} since joined. They
          appear in the list below.
        </p>
      )}
    </div>
  );
}
