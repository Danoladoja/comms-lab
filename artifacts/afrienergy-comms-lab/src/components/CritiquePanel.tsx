import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetReviewQueue, useSubmitReview, useGetMyFeedback,
  getGetReviewQueueQueryKey, getGetMyFeedbackQueryKey,
  getListMyProgressQueryKey, getGetSessionAssignmentQueryKey,
  type RubricCriterion, type ReviewTarget,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2, Lock, MessagesSquare, PenLine, Quote, Users,
} from 'lucide-react';
import { apiReason } from '@workspace/domain';

/** Mirrors MIN_REVIEW_COMMENT_LENGTH on the server — the counter must agree with the validator. */
const MIN_COMMENT = 120;

/* ---------- Scoring one criterion ---------- */

function CriterionScorer({
  criterion, value, onChange, idPrefix,
}: {
  criterion: RubricCriterion;
  value: number | undefined;
  onChange: (score: number) => void;
  idPrefix: string;
}) {
  const groupId = `${idPrefix}-${criterion.id}`;
  return (
    <fieldset className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{criterion.label}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <p className="font-semibold text-sm" id={`${groupId}-label`}>{criterion.label}</p>
        <div className="flex gap-1.5" role="radiogroup" aria-labelledby={`${groupId}-label`}>
          {Array.from({ length: criterion.maxScore }, (_, i) => i + 1).map((score) => (
            <label
              key={score}
              className={`w-9 h-9 grid place-items-center rounded-lg border text-sm font-semibold cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 ${
                value === score
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <input
                type="radio"
                name={groupId}
                value={score}
                checked={value === score}
                onChange={() => onChange(score)}
                className="sr-only"
              />
              {score}
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{criterion.description}</p>
    </fieldset>
  );
}

/* ---------- Writing one critique ---------- */

function CritiqueForm({
  sessionId, target, rubric, onDone,
}: {
  sessionId: number;
  target: ReviewTarget;
  rubric: RubricCriterion[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');

  const submit = useSubmitReview({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Critique filed', description: 'Thank you — that is how everyone gets better.' });
        qc.invalidateQueries({ queryKey: getGetReviewQueueQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetMyFeedbackQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        setScores({});
        setComment('');
        onDone();
      },
      onError: (err) => toast({
        title: 'Could not file that critique',
        description: apiReason(err, 'Check every criterion is scored and your notes are long enough.'),
        variant: 'destructive',
      }),
    },
  });

  const allScored = rubric.every((c) => typeof scores[c.id] === 'number');
  const remaining = Math.max(0, MIN_COMMENT - comment.trim().length);
  const ready = allScored && remaining === 0;

  return (
    <div className="space-y-6">
      <figure className="rounded-xl border border-border bg-[#F4F0E8] p-5">
        <Quote className="w-4 h-4 text-[#C2410C] mb-2" aria-hidden />
        <blockquote className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {target.body}
        </blockquote>
        <figcaption className="text-xs text-muted-foreground mt-3">
          Filed {new Date(target.submittedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · author hidden
        </figcaption>
      </figure>

      <div className="space-y-4">
        {rubric.map((criterion) => (
          <CriterionScorer
            key={criterion.id}
            criterion={criterion}
            value={scores[criterion.id]}
            idPrefix={`critique-${target.submissionId}`}
            onChange={(score) => setScores((s) => ({ ...s, [criterion.id]: score }))}
          />
        ))}
      </div>

      <div>
        <label htmlFor={`critique-notes-${target.submissionId}`} className="block font-semibold text-sm mb-1.5">
          What would you change, and why?
        </label>
        <Textarea
          id={`critique-notes-${target.submissionId}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Quote the sentence you would cut. Name the claim that needs a source. Be the editor you wish you had."
          rows={6}
          aria-describedby={`critique-count-${target.submissionId}`}
        />
        <p
          id={`critique-count-${target.submissionId}`}
          className={`text-xs mt-1.5 ${remaining > 0 ? 'text-muted-foreground' : 'text-emerald-700'}`}
        >
          {remaining > 0
            ? `${remaining} more character${remaining === 1 ? '' : 's'} — scores without reasons do not help anyone`
            : 'Long enough to be useful'}
        </p>
      </div>

      <Button
        className="w-full font-bold"
        disabled={!ready || submit.isPending}
        onClick={() => submit.mutate({
          submissionId: target.submissionId,
          data: { scores, comment: comment.trim() },
        })}
      >
        {submit.isPending ? 'Filing...' : 'File this critique'}
      </Button>
    </div>
  );
}

/* ---------- The queue ---------- */

export function CritiqueQueue({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { data: queue, isLoading, error } = useGetReviewQueue(sessionId, {
    query: { queryKey: getGetReviewQueueQueryKey(sessionId), retry: false },
  });
  const [index, setIndex] = useState(0);

  if (isLoading) return <div className="h-40 bg-muted/40 rounded-xl animate-pulse" />;
  if (error || !queue) {
    return <p className="text-sm text-muted-foreground py-4">Peer critique is not set up for this module.</p>;
  }

  const done = Math.min(queue.reviewsGiven, queue.reviewsRequired);
  const target = queue.targets[Math.min(index, queue.targets.length - 1)];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          You owe <span className="font-semibold text-foreground">{queue.reviewsRequired}</span> critique
          {queue.reviewsRequired === 1 ? '' : 's'} for this module.
        </p>
        <div className="flex items-center gap-1.5" aria-label={`${done} of ${queue.reviewsRequired} critiques written`}>
          {Array.from({ length: queue.reviewsRequired }, (_, i) => (
            <span
              key={i}
              className={`w-6 h-1.5 rounded-full ${i < queue.reviewsGiven ? 'bg-emerald-600' : 'bg-muted'}`}
            />
          ))}
        </div>
      </div>

      {queue.reason === 'not-submitted' && (
        <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
          <PenLine className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden />
          <p className="font-semibold mb-1">File your own work first</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            The queue opens once you have submitted. Reading everyone else's answer before writing your own would not
            teach you much.
          </p>
        </div>
      )}

      {queue.reason === 'none-available' && (
        <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
          <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden />
          <p className="font-semibold mb-1">Nothing to critique yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            You are ahead of your cohort. Check back once more people have filed — you will get a nudge by email.
          </p>
        </div>
      )}

      {queue.reason === 'done' && queue.targets.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-3" aria-hidden />
          <p className="font-semibold mb-1">Critiques done</p>
          <p className="text-sm text-emerald-900/80">Your own feedback is unlocked below.</p>
        </div>
      )}

      {target && (
        <>
          {queue.reviewsGiven >= queue.reviewsRequired && (
            <p className="text-xs text-muted-foreground">
              You have written everything you owe. Anything from here is a gift to your cohort.
            </p>
          )}
          <CritiqueForm
            key={target.submissionId}
            sessionId={sessionId}
            target={target}
            rubric={queue.rubric}
            onDone={() => {
              setIndex(0);
              qc.invalidateQueries({ queryKey: getGetReviewQueueQueryKey(sessionId) });
            }}
          />
          {queue.targets.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setIndex((i) => (i + 1) % queue.targets.length)}
            >
              Show me a different submission
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Feedback received ---------- */

export function MyFeedbackPanel({ sessionId }: { sessionId: number }) {
  const { data, isLoading, error } = useGetMyFeedback(sessionId, {
    query: { queryKey: getGetMyFeedbackQueryKey(sessionId), retry: false },
  });

  if (isLoading) return <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />;
  if (error || !data) {
    return <p className="text-sm text-muted-foreground py-4">No feedback available for this module.</p>;
  }

  if (!data.unlocked) {
    const owed = data.reviewsRequired - data.reviewsGiven;
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
        <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden />
        <p className="font-semibold mb-1">Give to receive</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Write {owed} more critique{owed === 1 ? '' : 's'} and the feedback on your own work unlocks. Everyone's
          feedback depends on everyone showing up.
        </p>
      </div>
    );
  }

  if (data.reviews.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-6 text-center">
        <MessagesSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden />
        <p className="font-semibold mb-1">No critiques yet</p>
        <p className="text-sm text-muted-foreground">Your work is in the queue. Feedback usually lands within a day or two.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.reviews.map((review, i) => (
        <article key={review.id} className="rounded-xl border border-border p-5">
          <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="font-semibold text-sm">Critique {i + 1}</p>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {review.scorePct}% against the rubric
            </span>
          </header>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-4">
            {data.rubric.map((criterion) => (
              <div key={criterion.id}>
                <dt className="text-xs text-muted-foreground">{criterion.label}</dt>
                <dd className="text-sm font-semibold">
                  {review.scores[criterion.id] ?? '—'}
                  <span className="text-muted-foreground font-normal"> / {criterion.maxScore}</span>
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-sm leading-relaxed whitespace-pre-wrap">{review.comment}</p>
        </article>
      ))}
    </div>
  );
}
