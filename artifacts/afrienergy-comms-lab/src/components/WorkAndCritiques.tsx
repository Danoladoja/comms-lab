import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetModuleWork, useWithdrawSubmission, getGetModuleWorkQueryKey,
  type StaffPiece,
} from '@workspace/api-client-react';
import { apiReason } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, Eye, EyeOff, Flag, PenLine, UserX } from 'lucide-react';

/**
 * What the Lab's staff can see of a module's written work.
 *
 * Until this screen existed, nobody at the Lab could read any of it. Work left
 * the database by three doors — back to its author, anonymously to two peers,
 * and onto a public certificate if the learner asked — and staff were on none
 * of them. Which meant a facilitator could not tell whether the critiques were
 * any good, could not see a learner quietly drowning, could not settle an
 * argument about unfair feedback, and could not find somebody being unkind
 * behind anonymity the Lab itself had granted.
 *
 * Two flags appear here and nowhere else, and neither is a verdict. A piece may
 * be marked worth a look when almost all of it arrived in one paste after almost
 * no time — both of which have innocent explanations, which is exactly why it
 * raises an eyebrow instead of an alarm. A critique may be marked thin when it
 * barely clears the minimum or nearly repeats one the same person filed
 * elsewhere. They are there to tell a facilitator reading twenty pieces which
 * two to start with.
 */

function Flagged({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
      <Flag className="h-3 w-3" aria-hidden />{children}
    </span>
  );
}

function PieceCard({ piece, sessionId }: { piece: StaffPiece; sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const withdraw = useWithdrawSubmission({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: r.withdrawn ? 'Taken out of the discussion' : 'Back in the discussion',
          description: r.withdrawn
            ? 'The cohort can no longer see it. The work still counts and you still can.'
            : 'The cohort can see it again.',
        });
        qc.invalidateQueries({ queryKey: getGetModuleWorkQueryKey(sessionId) });
      },
      onError: (err) => toast({
        title: 'Could not change that',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const panelId = `work-${piece.submissionId}`;

  return (
    <article className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">{piece.authorName}</span>
            {piece.worthALook && <Flagged>Worth a look</Flagged>}
            {piece.withdrawn && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                <EyeOff className="h-3 w-3" aria-hidden />Out of the discussion
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {piece.critiques.length} critique{piece.critiques.length === 1 ? '' : 's'}
            {piece.critiques.some((c) => c.thin) && ' · some thin'} · AI: {piece.aiUseLabel}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-4 border-t border-border p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{piece.body}</p>

          <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {/* A sentence about what happened. Never a score about who wrote it. */}
              <span>{piece.provenance}</span>
            </p>
            <p className="mt-1.5">
              <span className="font-semibold text-foreground">Declared: {piece.aiUseLabel}.</span>
              {piece.aiNote ? ` ${piece.aiNote}` : ''}
            </p>
          </div>

          {piece.critiques.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Critiques received · signed here only
              </h4>
              <div className="space-y-2">
                {piece.critiques.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      {c.reviewerName}
                      <span className="font-normal text-muted-foreground">{c.scorePct}% against the rubric</span>
                      {c.thin && <Flagged>Thin</Flagged>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{c.comment}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* The remedy for a piece that turned out to be more personal than its
              author meant it to be. It leaves the discussion and nothing else. */}
          <Button
            size="sm"
            variant="outline"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate({
              id: piece.submissionId,
              data: { withdrawn: !piece.withdrawn },
            })}
          >
            {piece.withdrawn
              ? <><Eye className="mr-1.5 h-4 w-4" aria-hidden />Put back in the discussion</>
              : <><UserX className="mr-1.5 h-4 w-4" aria-hidden />Take out of the discussion</>}
          </Button>
        </div>
      )}
    </article>
  );
}

export default function WorkAndCritiques({ sessionId }: { sessionId: number }) {
  const { data, isLoading, error } = useGetModuleWork(sessionId, {
    query: { queryKey: getGetModuleWorkQueryKey(sessionId), retry: false },
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-muted/40" />;
  if (error || !data) {
    return <p className="text-xs text-muted-foreground">No task has been set for this module yet.</p>;
  }

  return (
    <div className="space-y-3">
      {(data.missing.length > 0 || data.owing.length > 0) && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          {data.missing.length > 0 && (
            <p className="mb-1">
              <span className="font-semibold">Not filed yet ({data.missing.length}):</span>{' '}
              <span className="text-muted-foreground">{data.missing.join(', ')}</span>
            </p>
          )}
          {data.owing.length > 0 && (
            <p>
              <span className="font-semibold">Critiques still owed:</span>{' '}
              <span className="text-muted-foreground">
                {data.owing.map((o) => `${o.name} (${o.given}/${data.reviewsRequired})`).join(', ')}
              </span>
            </p>
          )}
        </div>
      )}

      {data.pieces.length === 0
        ? <p className="text-xs text-muted-foreground">Nobody has filed anything for this module yet.</p>
        : data.pieces.map((piece) => (
          <PieceCard key={piece.submissionId} piece={piece} sessionId={sessionId} />
        ))}
    </div>
  );
}
