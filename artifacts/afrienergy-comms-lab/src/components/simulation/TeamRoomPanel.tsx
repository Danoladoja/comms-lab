import { useEffect, useRef, useState } from 'react';
import {
  useGetTeamRoom, getGetTeamRoomQueryKey,
  useSendTeamRoomMessage, useVoteForTeamLeader,
  useSaveTeamRoomDraft, useNodTeamRoomDraft, usePostTeamRoomDraft,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiReason } from '@workspace/domain';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Users, Send, Loader2, ThumbsUp, Crown, Check, MessageSquare, PencilLine,
} from 'lucide-react';

/**
 * Where a team argues before it says anything.
 *
 * Replaces a single shared answer box that anyone could type into and whose
 * last save won — so a team's published position was whoever reached the
 * keyboard last, and the debrief was marking that as the team's judgement.
 *
 * Three things live in here and they are deliberately in one panel rather than
 * three tabs. During a session this is the only thing a participant is looking
 * at, and a tab is a place for something to be happening unseen: a vote closing
 * while you read the chat, or a draft rewritten under four nods you gave it.
 *
 *   - **The talk.** Plain, fast, theirs. Nothing is moderated and nothing is
 *     shown to another team.
 *   - **The vote**, for the first five minutes, with the clock on it.
 *   - **The draft**, once somebody speaks for them, with the tally of who is
 *     behind it and a send button that unlocks at seventy per cent.
 *
 * It polls rather than holding a socket open. Five seconds while the room is
 * doing something, because a message that lands five seconds late in a
 * forty-five minute exercise is a message that landed; a socket would be
 * tighter and is a second way for a live session to break.
 */
export default function TeamRoomPanel({ runId, tone }: {
  runId: number;
  tone: { accentText: string; panelBorder: string; btn: string; headerStyle: string };
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [typed, setTyped] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const { data: room, error } = useGetTeamRoom(runId, {
    query: {
      queryKey: getGetTeamRoomQueryKey(runId),
      refetchInterval: 5_000,
      // People read this with the window behind the video call they are on.
      refetchIntervalInBackground: true,
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: getGetTeamRoomQueryKey(runId) });
  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: apiReason(err, 'Try again.'), variant: 'destructive' });

  const say = useSendTeamRoomMessage({ mutation: { onSuccess: () => { setTyped(''); refresh(); }, onError: onError('Not sent') } });
  const vote = useVoteForTeamLeader({ mutation: { onSuccess: refresh, onError: onError('Vote not counted') } });
  const save = useSaveTeamRoomDraft({ mutation: { onSuccess: () => { setEditing(false); refresh(); }, onError: onError('Draft not saved') } });
  const nod = useNodTeamRoomDraft({ mutation: { onSuccess: refresh, onError: onError('Not counted') } });
  const post = usePostTeamRoomDraft({
    mutation: {
      onSuccess: () => { refresh(); toast({ title: 'Sent', description: "Your team's reply is in." }); },
      onError: onError('Not sent'),
    },
  });

  /*
    Follow the conversation, but only when it moves.

    Scrolling on every poll would yank the view out from under somebody reading
    back through what was said, which in a room arguing under a clock is
    exactly when they are doing it.
  */
  useEffect(() => {
    const count = room?.messages.length ?? 0;
    if (count !== lastCount.current) {
      lastCount.current = count;
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [room?.messages.length]);

  // The leader's own box follows the saved draft, except while they are typing
  // into it — otherwise a poll five seconds in deletes their sentence.
  useEffect(() => {
    if (!editing) setDraft(room?.draft ?? '');
  }, [room?.draft, editing]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <p className="text-sm text-white/60">{apiReason(error, 'Your team room could not be opened.')}</p>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/40" aria-hidden />
      </div>
    );
  }

  const here = room.members.filter((m) => m.present);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Where the team is up to. One line, always true, never scrolls away. */}
      <div className={cn('shrink-0 border-b px-5 py-3', tone.panelBorder)}>
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1.5">
          <Users className="w-3 h-3" aria-hidden />
          {room.teamName} · {here.length} here
        </p>
        <p className="text-sm text-white/85 leading-snug">{room.standing}</p>
        {/*
          Said plainly and said once. No other team can read this room, during
          or after — but a facilitator can, afterwards, and people are entitled
          to know that before they type rather than to find out when it is
          quoted back at them.
        */}
        <p className="mt-1.5 text-[11px] text-white/35">
          No other team sees this. Your facilitator can read it back after the session.
        </p>
        {room.watching && room.watching.length > 0 && (
          <p className="mt-1.5 text-[11px] text-amber-300/80">
            {room.watching.join(', ')} {room.watching.length === 1 ? 'is' : 'are'} sitting in right now.
          </p>
        )}
      </div>

      {room.electionOpen && !room.leaderId && (
        <Election room={room} tone={tone} onVote={(forUserId) => vote.mutate({ runId, data: { forUserId } })} />
      )}

      {/* The talk. Always open, from the first second — a team can argue about
          the crisis while it is still deciding who announces the answer. */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
        {room.messages.length === 0 && (
          <p className="text-xs text-white/30 text-center py-6">
            Nothing said yet. No other team sees this.
          </p>
        )}
        {room.messages.map((m) => (
          <div key={m.id} className={cn('flex flex-col max-w-[85%]', m.mine && 'ml-auto items-end')}>
            {!m.mine && <span className="text-[10px] text-white/40 mb-0.5 px-1">{m.name}</span>}
            <div
              className={cn(
                'px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
                m.mine ? 'bg-[#f97316]/20 text-white' : 'bg-white/[0.06] text-white/90',
              )}
            >
              {m.body}
            </div>
            <span className="text-[10px] text-white/25 mt-0.5 px-1">
              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>

      {room.draft && <DraftBlock
        room={room}
        tone={tone}
        onNod={() => nod.mutate({ runId, data: { version: room.draftVersion } })}
        nodding={nod.isPending}
      />}

      {room.iAmLeader && !room.posted && (
        <div className={cn('shrink-0 border-t px-5 py-4 space-y-2', tone.panelBorder)}>
          <p className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em]', tone.accentText)}>
            <PencilLine className="w-3 h-3" aria-hidden /> Your team's reply
          </p>
          <Textarea
            value={draft}
            onChange={(e) => { setEditing(true); setDraft(e.target.value); }}
            placeholder="Write what your team would actually send, and to whom."
            className={cn('resize-none bg-black/40 text-white font-mono text-sm p-3 rounded-none min-h-[90px]', tone.panelBorder)}
          />
          {/* Said before they type, not after they have lost four nods to it. */}
          {room.nodsHave > 0 && editing && draft !== room.draft && (
            <p className="text-[11px] text-amber-300/80">
              Saving this clears the {room.nodsHave} {room.nodsHave === 1 ? 'nod' : 'nods'} it already
              has — your team agreed to the words as they stand.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => save.mutate({ runId, data: { body: draft } })}
              disabled={save.isPending || draft === room.draft}
              className={cn('flex-1 h-10 rounded-none uppercase tracking-[0.15em] text-[10px] font-bold', tone.btn)}
            >
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save draft'}
            </Button>
            <Button
              onClick={() => post.mutate({ runId })}
              disabled={!room.mayPost || post.isPending}
              className="flex-1 h-10 rounded-none uppercase tracking-[0.15em] text-[10px] font-bold bg-emerald-400 text-[#030811] hover:bg-emerald-300 disabled:opacity-40"
            >
              {post.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5 mr-1.5" />Send it</>}
            </Button>
          </div>
          {/* Why the button is dark, in words. A disabled button that explains
              nothing is the thing people file a complaint about. */}
          {!room.mayPost && room.waitingOn && (
            <p className="text-[11px] text-white/45">{room.waitingOn}</p>
          )}
        </div>
      )}

      {room.posted && (
        <div className="shrink-0 border-t border-emerald-400/30 bg-emerald-400/[0.06] px-5 py-3">
          <p className="flex items-center gap-2 text-xs text-emerald-300">
            <Check className="w-3.5 h-3.5" aria-hidden /> Your team's reply is in. Keep talking — the next one is coming.
          </p>
        </div>
      )}

      {/* The message box, last, because it is the thing hands return to. */}
      <div className={cn('shrink-0 border-t p-3 flex gap-2', tone.panelBorder)}>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && typed.trim()) {
              e.preventDefault();
              say.mutate({ runId, data: { body: typed } });
            }
          }}
          placeholder="Message your team…"
          className="flex-1 bg-black/40 border border-white/15 text-white text-sm px-3 py-2.5 placeholder:text-white/25 focus:outline-none focus:border-white/30"
        />
        <Button
          onClick={() => say.mutate({ runId, data: { body: typed } })}
          disabled={!typed.trim() || say.isPending}
          className={cn('h-auto px-4 rounded-none', tone.btn)}
          aria-label="Send message"
        >
          {say.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * The first five minutes.
 *
 * Shown as a list of the people actually in the room, with the count beside
 * each, because the useful thing during a vote is seeing it move. Voting for
 * yourself is allowed and unremarkable — somebody has to, and a rule against
 * it would mean a team of two could never settle.
 */
function Election({ room, tone, onVote }: {
  room: { members: { userId: number; name: string; present: boolean; votes: number }[];
    electionMinutesLeft: number; myVoteFor: number | null };
  tone: { accentText: string; panelBorder: string };
  onVote: (userId: number) => void;
}) {
  const here = room.members.filter((m) => m.present);
  return (
    <div className={cn('shrink-0 border-b px-5 py-4', tone.panelBorder, 'bg-white/[0.02]')}>
      <p className={cn('flex items-center justify-between text-[10px] uppercase tracking-[0.2em] mb-3', tone.accentText)}>
        <span className="flex items-center gap-1.5"><Crown className="w-3 h-3" aria-hidden /> Who speaks for you</span>
        <span className="text-white/40">
          {room.electionMinutesLeft} min left
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {here.map((m) => (
          <button
            key={m.userId}
            type="button"
            onClick={() => onVote(m.userId)}
            className={cn(
              'px-3 py-1.5 text-xs border transition-colors',
              room.myVoteFor === m.userId
                ? 'border-[#f97316] bg-[#f97316]/15 text-white'
                : 'border-white/15 text-white/70 hover:border-white/35',
            )}
          >
            {m.name}
            {m.votes > 0 && <span className="ml-1.5 text-white/40">{m.votes}</span>}
          </button>
        ))}
      </div>
      {here.length === 0 && <p className="text-xs text-white/35">Waiting for your team to arrive.</p>}
    </div>
  );
}

/**
 * The draft, and who is behind it.
 *
 * Everyone sees the same words and the same tally. The nod button is the only
 * thing that changes by who is looking, and it goes away once given — a nod is
 * not a toggle, because a team watching a count go up and down while a clock
 * runs is a team arguing about the count.
 */
function DraftBlock({ room, tone, onNod, nodding }: {
  room: {
    draft: string; nodsHave: number; nodsNeeded: number; iHaveNodded: boolean;
    leaderName: string | null; posted: boolean;
    members: { userId: number; name: string; nodded: boolean; present: boolean }[];
  };
  tone: { accentText: string; panelBorder: string };
  onNod: () => void;
  nodding: boolean;
}) {
  const behind = room.members.filter((m) => m.nodded);
  const share = room.nodsNeeded === 0 ? 0 : Math.min(1, room.nodsHave / room.nodsNeeded);

  return (
    <div className={cn('shrink-0 border-t px-5 py-4 bg-white/[0.03]', tone.panelBorder)}>
      <p className={cn('text-[10px] uppercase tracking-[0.2em] mb-2', tone.accentText)}>
        {room.leaderName ? `${room.leaderName} drafted this` : 'The draft'}
      </p>
      <p className="text-sm text-white/90 font-mono leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto mb-3">
        {room.draft}
      </p>

      {/* The bar is the point of the rule made visible: how close the team is
          to being allowed to speak. */}
      <div className="h-1 bg-white/10 mb-2">
        <div
          className={cn('h-full transition-all', share >= 1 ? 'bg-emerald-400' : 'bg-[#f97316]')}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="text-[11px] text-white/50 mb-3">
        {room.nodsHave} of {room.nodsNeeded} agreed
        {behind.length > 0 && <span className="text-white/35"> · {behind.map((m) => m.name).join(', ')}</span>}
      </p>

      {!room.posted && (
        room.iHaveNodded ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="w-3.5 h-3.5" aria-hidden /> You are behind this
          </p>
        ) : (
          <Button
            onClick={onNod}
            disabled={nodding}
            className="h-9 w-full rounded-none uppercase tracking-[0.15em] text-[10px] font-bold bg-white/10 text-white hover:bg-white/20"
          >
            {nodding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><ThumbsUp className="w-3.5 h-3.5 mr-1.5" />I agree with this</>}
          </Button>
        )
      )}
    </div>
  );
}
