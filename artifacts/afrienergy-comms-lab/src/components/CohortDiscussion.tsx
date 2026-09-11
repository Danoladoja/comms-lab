import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCohortDiscussion, useAddSubmissionComment,
  getGetCohortDiscussionQueryKey,
  type DiscussionPiece,
} from '@workspace/api-client-react';
import { apiReason, commentProblem } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, GraduationCap, Lock, MessageCircle, Sparkles, Users } from 'lucide-react';

/**
 * The cohort reading each other, once the blind work is done.
 *
 * Everything on this screen follows one decision: critique is anonymous because
 * it is a judgement, and a discussion is not a judgement. So pieces carry their
 * authors' names, comments carry their writers' names, and the critiques sitting
 * above them stay unsigned — those were written under a promise, and the promise
 * does not lapse when the exercise ends.
 */

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A facilitator's name in the room, marked as one.
 *
 * The room is a learner conversation and staff are guests in it. A tag does not
 * stop people deferring to the teacher — nothing does — but it at least means
 * they are deferring to a teacher rather than to a peer who sounded certain.
 */
export function StaffTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
      <GraduationCap className="h-3 w-3" aria-hidden />Facilitator
    </span>
  );
}

/**
 * Saying something in the room.
 *
 * Shared with the staff console, because a facilitator reading the room and a
 * learner reading the room should be typing into the same box — two boxes drift
 * apart, and one of them ends up being the one nobody fixed.
 */
export function CommentComposer({ submissionId, placeholder, onPosted }: {
  submissionId: number;
  placeholder: string;
  /** Which view to refresh; the two screens cache the room under different keys. */
  onPosted: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');

  const add = useAddSubmissionComment({
    mutation: {
      onSuccess: () => {
        setText('');
        onPosted();
      },
      onError: (err) => toast({
        title: 'Could not post that',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const problem = commentProblem(text);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label htmlFor={`say-${submissionId}`} className="sr-only">{placeholder}</label>
      <Textarea
        id={`say-${submissionId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={placeholder}
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          disabled={!!problem || add.isPending}
          onClick={() => add.mutate({ id: submissionId, data: { body: text.trim() } })}
        >
          {add.isPending ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </div>
  );
}

function Piece({ piece, sessionId }: { piece: DiscussionPiece; sessionId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelId = `piece-${piece.submissionId}`;

  return (
    <article className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {piece.authorName}
            {piece.mine && <span className="ml-2 text-xs font-medium text-muted-foreground">(yours)</span>}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Filed {when(piece.submittedAt)} · {piece.critiques.length} critique
            {piece.critiques.length === 1 ? '' : 's'} · {piece.comments.length} comment
            {piece.comments.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} className="border-t border-border px-5 py-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{piece.body}</p>

          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-medium text-foreground">AI: {piece.aiUseLabel}.</span>
              {piece.aiNote ? ` ${piece.aiNote}` : ''}
            </span>
          </p>

          {piece.critiques.length > 0 && (
            <section className="mt-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Critiques · unsigned
              </h4>
              <div className="space-y-3">
                {piece.critiques.map((c) => (
                  <p key={c.id} className="whitespace-pre-wrap rounded-lg bg-muted/40 px-4 py-3 text-sm leading-relaxed">
                    {c.comment}
                  </p>
                ))}
              </div>
            </section>
          )}

          {piece.comments.length > 0 && (
            <section className="mt-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Discussion
              </h4>
              <div className="space-y-3">
                {piece.comments.map((c) => (
                  <div key={c.id}>
                    <p className="text-xs font-semibold">
                      {c.authorName}
                      {c.staff && <StaffTag />}
                      <span className="ml-2 font-normal text-muted-foreground">{when(c.createdAt)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <CommentComposer
            submissionId={piece.submissionId}
            placeholder={piece.mine
              ? 'Answer your cohort, or say what you would do differently next time.'
              : `What did ${piece.authorName.split(' ')[0]} do that you would steal?`}
            onPosted={() => qc.invalidateQueries({ queryKey: getGetCohortDiscussionQueryKey(sessionId) })}
          />
        </div>
      )}
    </article>
  );
}

export function CohortDiscussion({ sessionId }: { sessionId: number }) {
  const { data, isLoading, error } = useGetCohortDiscussion(sessionId, {
    query: { queryKey: getGetCohortDiscussionQueryKey(sessionId), retry: false },
  });

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted/40" />;
  if (error || !data) {
    return <p className="py-4 text-sm text-muted-foreground">There is no cohort discussion for this module.</p>;
  }

  if (!data.open) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mb-1 font-semibold">The room opens once you have done the work</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{data.lockedReason}</p>
      </div>
    );
  }

  if (data.pieces.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
        <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mb-1 font-semibold">Nothing here yet</p>
        <p className="text-sm text-muted-foreground">You are early. Come back once more of the cohort has filed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Everyone's work for this module, names on. The critiques stay unsigned — they were written that way and
          that does not change. Read a few, and say something to somebody.
        </span>
      </p>
      {data.pieces.map((piece) => (
        <Piece key={piece.submissionId} piece={piece} sessionId={sessionId} />
      ))}
    </div>
  );
}
