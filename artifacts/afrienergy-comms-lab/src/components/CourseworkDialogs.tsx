import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionQuiz, useSubmitQuizAttempt,
  useGetSessionAssignment, useSubmitAssignment, useClaimLatePass,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey, getListMyProgressQueryKey,
} from '@workspace/api-client-react';
import {
  apiReason, AI_USE_CHOICES, MAX_AI_NOTE_CHARS, disclosureProblem, type AiUse,
  latePassOffer, latePassBalance, LATE_PASS_HOURS, isNotFound as isMissing, isRefused,
  countWords, meetsWordMinimum, wordCountNotice, submitButtonLabel,
} from '@workspace/domain';
import { deadlineNotice } from '@/lib/dueDateText';
import { useWritingProvenance } from '@/hooks/useWritingProvenance';
import { useDraft } from '@/hooks/useDraft';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, RotateCcw, CalendarClock, LockKeyhole, LifeBuoy, Clock3 } from 'lucide-react';
import { CouldNotLoad } from '@/components/CouldNotLoad';

/**
 * The deadline, as a learner sees it.
 *
 * Whether the door is shut is the server's answer, carried in `closed` — never
 * a sum done here. A laptop clock an hour out would otherwise hand one learner
 * an extra hour and rob another of one, and neither would know why.
 */
function Deadline({ dueAt, closed }: { dueAt?: string | null; closed?: boolean }) {
  const line = deadlineNotice(dueAt, !!closed);
  if (!line) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs font-medium ${closed ? 'text-[#B45309]' : 'text-muted-foreground'}`}>
      {closed
        ? <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        : <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span>{line}</span>
    </p>
  );
}

/* ---------- Quiz ---------- */

/** The quiz experience itself: questions, grading result, retake. Used in the
 *  dialog on the dashboard and inline in the classroom. */
export function QuizPanel({ sessionId, enabled = true }: { sessionId: number; enabled?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: quiz, isLoading, error, refetch } = useGetSessionQuiz(sessionId, {
    query: { queryKey: getGetSessionQuizQueryKey(sessionId), enabled },
  });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ scorePct: number; passed: boolean; correctCount: number; totalQuestions: number } | null>(null);

  const submit = useSubmitQuizAttempt({
    mutation: {
      onSuccess: (r) => {
        setResult(r);
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getGetSessionQuizQueryKey(sessionId) });
      },
      onError: (err) => toast({
        title: 'Could not submit the quiz',
        // When the refusal is the deadline, the learner should read the reason
        // rather than a shrug — the server says it plainly, so pass it on.
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const questions = quiz?.questions ?? [];
  // `closed` is the ordinary deadline. Whether the learner can still answer is a
  // different question: a late pass covers the whole module, so one spent on the
  // written task reopens this quiz too, and the server is the one that decides.
  const pastDue = !!quiz?.closed;
  const pass = quiz?.latePass;
  const shut = pastDue && pass?.state !== 'in-use';
  const allAnswered = questions.length > 0 && questions.every(q => answers[q.id] !== undefined);
  const reset = () => { setAnswers({}); setResult(null); };

  if (isLoading) return <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />;
  /*
    Three answers, not two. A 404 means there is no quiz; a 403 means there is
    one and this learner may not have it yet, and the Lab has already written
    the reason; anything else means we could not ask.
  */
  if (error) {
    if (isMissing(error)) {
      return <p className="text-sm text-muted-foreground py-4">This quiz is not available yet.</p>;
    }
    if (isRefused(error)) return <Shut reason={apiReason(error, 'This module is not open yet.')} />;
    return <CouldNotLoad what="this quiz" onRetry={() => refetch()} compact />;
  }

  if (result) {
    return (
      <div className="text-center py-6">
        {result.passed
          ? <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          : <XCircle className="w-12 h-12 text-[#C2410C] mx-auto mb-3" />}
        <p className="text-3xl font-display font-bold mb-1">{result.scorePct}%</p>
        <p className="text-sm text-muted-foreground mb-5">
          {result.correctCount} of {result.totalQuestions} correct · {result.passed ? 'Passed. Well done!' : 'Not passed yet. You can retake it as many times as you like.'}
        </p>
        <div className="flex justify-center gap-2">
          {!result.passed && (
            <Button size="sm" variant="outline" onClick={reset}>
              <RotateCcw className="w-4 h-4 mr-1.5" />Retake quiz
            </Button>
          )}
          {result.passed && <Button size="sm" onClick={reset}>Done</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Pass mark {quiz?.passMark ?? 70}%, unlimited retakes
        {quiz?.bestScore != null && ` · best score so far ${quiz.bestScore}%`}
      </p>
      <Deadline dueAt={quiz?.dueAt} closed={pastDue} />

      {pass && (
        <LatePassCard
          sessionId={sessionId}
          piece="quiz"
          state={pass.state}
          left={pass.left}
          canClaim={pass.canClaim}
          windowEnd={pass.windowEnd}
          opens={pass.opens}
        />
      )}

      {questions.map((q, qi) => (
        <fieldset key={q.id}>
          <legend className="font-medium text-sm mb-2">{qi + 1}. {q.prompt}</legend>
          <div className="space-y-1.5">
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                className={`flex items-center gap-2.5 border rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                  answers[q.id] === oi ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
              >
                <input
                  type="radio"
                  name={`q-${sessionId}-${q.id}`}
                  checked={answers[q.id] === oi}
                  onChange={() => setAnswers({ ...answers, [q.id]: oi })}
                  className="accent-[#F97316]"
                />
                {opt}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Button
        className="w-full font-bold"
        disabled={shut || !allAnswered || submit.isPending}
        onClick={() => submit.mutate({
          id: sessionId,
          data: { answers: questions.map(q => ({ questionId: q.id, answerIndex: answers[q.id] })) },
        })}
      >
        {shut ? 'Closed' : submit.isPending ? 'Grading...' : 'Submit answers'}
      </Button>
    </div>
  );
}

export function QuizDialog({ sessionId, moduleTitle, open, onOpenChange }: {
  sessionId: number; moduleTitle: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Module quiz</DialogTitle>
          <DialogDescription>{moduleTitle}</DialogDescription>
        </DialogHeader>
        {open && <QuizPanel sessionId={sessionId} />}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Assignment ---------- */

/**
 * How did you use AI on this?
 *
 * Asked of everyone, every time, and answered in four seconds. The Lab does not
 * run a detector: detectors disagree with each other, produce a percentage
 * people read as a fact, and flag writers working in a second language more
 * often than fluent natives — which, for this cohort, would mean accusing the
 * people writing most carefully. Declaring your tools is a newsroom habit now,
 * and teaching it is worth more than catching anybody.
 */
function AiDisclosure({ sessionId, use, note, onUse, onNote, disabled }: {
  sessionId: number;
  use: AiUse | '';
  note: string;
  onUse: (v: AiUse) => void;
  onNote: (v: string) => void;
  disabled?: boolean;
}) {
  const name = `ai-use-${sessionId}`;
  return (
    <fieldset className="rounded-xl border border-border bg-muted/30 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">Did you use AI on this piece?</legend>
      <p className="mb-3 text-xs text-muted-foreground">
        Every answer here is fine, including “it wrote a draft”. Nothing is marked down for it — saying so is the
        professional habit we are after.
      </p>
      <div className="space-y-1.5">
        {AI_USE_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              use === choice.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={use === choice.value}
              onChange={() => onUse(choice.value)}
              className="accent-[#F97316]"
            />
            {choice.label}
          </label>
        ))}
      </div>
      <label htmlFor={`${name}-note`} className="mt-3 mb-1.5 block text-xs font-medium">
        {use === 'other' ? 'Say in a line what that was' : 'Anything to add? (optional)'}
      </label>
      <Textarea
        id={`${name}-note`}
        value={note}
        onChange={(e) => onNote(e.target.value.slice(0, MAX_AI_NOTE_CHARS))}
        rows={2}
        placeholder="e.g. I asked it to check two tariff figures, then verified both against the regulator's site."
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Your cohort sees this alongside your piece in the discussion.
      </p>
    </fieldset>
  );
}

/**
 * The way back in, once the deadline has gone.
 *
 * Deliberate, and priced out loud. A learner who submitted late and found a
 * pass silently spent would have lost something scarce without being asked —
 * so this says what it costs, including the cost nobody thinks of: a piece that
 * lands after the cohort has finished critiquing tends to get no critiques.
 */
function LatePassCard({ sessionId, piece, state, left, canClaim, windowEnd, opens }: {
  sessionId: number;
  /** Which of the module's two deadlines this card is standing in front of. */
  piece: 'quiz' | 'assignment';
  state: string;
  left: number;
  canClaim: boolean;
  windowEnd?: string | null;
  /** What spending one would open. Absent from an older server: assume the piece in hand. */
  opens?: 'quiz' | 'assignment' | 'both';
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const claim = useClaimLatePass({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: 'Late pass used',
          description: `You have until ${new Date(r.windowEnd ?? '').toLocaleString()} to ${
            piece === 'quiz' ? 'answer this quiz' : 'file this one'
          }.`,
        });
        // One pass opens both doors, so both panels have to be told. Refreshing
        // only the one in front of the learner left the other still saying
        // "closed", which is exactly the moment somebody spends a second pass
        // on a module they had already paid for.
        qc.invalidateQueries({ queryKey: getGetSessionAssignmentQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetSessionQuizQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
      },
      onError: (err) => toast({
        title: 'Could not use a late pass',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const until = windowEnd
    ? new Date(windowEnd).toLocaleString(undefined, {
      weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    })
    : '';

  if (state === 'in-use') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-start gap-1.5 text-sm font-semibold text-emerald-900">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Late pass in use — you have until {until}.
        </p>
        <p className="mt-1 text-xs text-emerald-900/80">
          {latePassBalance(2 - left)}{' '}
          {piece === 'quiz'
            // Only said where it is true: a module with no written task has
            // nothing else for the pass to cover.
            ? opens === 'both' ? 'It covers this module\u2019s written task as well.' : ''
            : 'File as soon as you can: your cohort may already have finished critiquing.'}
        </p>
      </div>
    );
  }

  if (state === 'available' && canClaim) {
    return (
      <div className="rounded-xl border border-[#FDBA74] bg-[#FFF7ED] p-4">
        <p className="flex items-start gap-1.5 text-sm font-semibold text-[#9A3412]">
          <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          The deadline has passed — but you have a late pass.
        </p>
        <p className="mt-1.5 text-xs text-[#9A3412]/90">{latePassOffer(2 - left, opens ?? piece)}</p>
        <Button
          size="sm"
          className="mt-3 font-bold"
          disabled={claim.isPending}
          onClick={() => claim.mutate({ id: sessionId, data: { piece } })}
        >
          {claim.isPending ? 'Using…' : `Use a late pass · ${LATE_PASS_HOURS} more hours`}
        </Button>
      </div>
    );
  }

  if (state === 'none-left' || state === 'too-late') {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <p className="flex items-start gap-1.5 text-sm font-semibold">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state === 'none-left'
            ? 'The deadline has passed and both your late passes are gone.'
            : 'The deadline has passed, and the extra time a late pass buys has run out.'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Talk to your facilitator — this is exactly the sort of thing they would rather hear about early.
        </p>
      </div>
    );
  }

  // Still open. A quiet count, so nobody discovers the allowance only in a panic.
  if (state === 'not-needed' && left > 0) {
    return <p className="text-xs text-muted-foreground">{latePassBalance(2 - left)}</p>;
  }
  return null;
}

/** Assignment brief plus the submission box. Used in the dashboard dialog and
 *  inline in the classroom. */
export function AssignmentPanel({ sessionId, enabled = true, onSubmitted }: {
  sessionId: number; enabled?: boolean; onSubmitted?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: assignment, isLoading, error, refetch } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), enabled },
  });
  // Saved as it is typed, so switching tabs or a phone reclaiming the tab
  // cannot destroy an hour's writing.
  const draft = useDraft(`assignment.${sessionId}`, assignment?.mySubmission?.body ?? '');
  const text = draft.text;
  const [aiUse, setAiUse] = useState<AiUse | ''>('');
  const [aiNote, setAiNote] = useState('');
  const provenance = useWritingProvenance(sessionId);

  const submit = useSubmitAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Assignment submitted', description: 'Your response has been saved.' });
        draft.clear();
        provenance.clear();
        qc.invalidateQueries({ queryKey: getListMyProgressQueryKey() });
        qc.invalidateQueries({ queryKey: getGetSessionAssignmentQueryKey(sessionId) });
        onSubmitted?.();
      },
      onError: (err) => toast({
        title: 'Could not submit the assignment',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  // `closed` means the ordinary deadline has gone. Whether the learner can
  // still file is a different question: a spent late pass reopens the door for
  // 48 hours, and the server is the one that decides.
  const pass = assignment?.latePass;
  const canFile = !assignment?.closed || pass?.state === 'in-use';
  const shut = !canFile;
  // The same check the server runs, so the button explains itself before the
  // learner presses it rather than after.
  const disclosureIssue = disclosureProblem(aiUse, aiNote);
  // And the same for length. The count runs from the first keystroke: a floor
  // discovered on pressing Submit reads as a punishment for having finished.
  const minWords = assignment?.minWords ?? 0;
  const words = countWords(text);
  const longEnough = meetsWordMinimum(words, minWords);

  if (isLoading) return <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />;
  if (error) {
    if (isMissing(error)) {
      return <p className="text-sm text-muted-foreground py-4">This assignment is not available yet.</p>;
    }
    /*
      The one that was sending learners in circles.

      A module shut against somebody answers 403 with a sentence saying which
      module to finish first. That was falling through to "could not load this
      assignment" with a Retry button — so a learner who was locked out saw a
      technical fault, pressed Retry, got it again, and reported that they
      could not submit their written task. Nothing was broken and nothing they
      could press would have helped.
    */
    if (isRefused(error)) {
      return <Shut reason={apiReason(error, 'This module is not open to you yet.')} />;
    }
    return <CouldNotLoad what="this assignment" onRetry={() => refetch()} compact />;
  }

  return (
    <div className="space-y-4">
      {assignment?.instructions && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted border border-border rounded-lg px-3 py-2.5">
          {assignment.instructions}
        </p>
      )}
      <Deadline dueAt={assignment?.dueAt} closed={!!assignment?.closed} />

      {pass && (
        <LatePassCard
          sessionId={sessionId}
          piece="assignment"
          state={pass.state}
          left={pass.left}
          canClaim={pass.canClaim}
          windowEnd={pass.windowEnd}
          opens={pass.opens}
        />
      )}

      {draft.restored && !shut && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>We kept what you had written. Nothing is filed until you press Submit.</span>
        </p>
      )}

      {assignment?.mySubmission && (
        <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Submitted {new Date(assignment.mySubmission.submittedAt).toLocaleString()}
          {assignment.mySubmission.late && ' · on a late pass'}
          {shut ? '.' : ' — you can revise and resubmit.'}
        </p>
      )}
      <Textarea
        value={text}
        onChange={e => { draft.setText(e.target.value); provenance.onType(); }}
        onPaste={e => provenance.onPaste(e.clipboardData.getData('text'))}
        placeholder={shut ? 'Submissions are closed for this assignment.' : 'Type your response here...'}
        rows={8}
        readOnly={shut}
        aria-describedby={minWords > 0 ? `assignment-count-${sessionId}` : undefined}
      />

      {minWords > 0 && !shut && (
        <p
          id={`assignment-count-${sessionId}`}
          className={`text-xs ${longEnough ? 'text-emerald-700' : 'text-muted-foreground'}`}
        >
          {wordCountNotice(words, minWords)}
        </p>
      )}

      {!shut && (
        <AiDisclosure
          sessionId={sessionId}
          use={aiUse}
          note={aiNote}
          onUse={setAiUse}
          onNote={setAiNote}
        />
      )}

      {/*
        The button says what it is waiting for.

        A disabled button is silent: it does not answer a click, shows no
        message, and went on reading "Submit assignment" while refusing to do
        it. So a learner two hundred words short saw a button that looked
        broken, pressed it, got nothing, and reported that they could not hand
        their work in — with every check on this screen explained in small grey
        type somewhere else on the page, and none of it on the control they
        were actually looking at.
      */}
      <Button
        className="w-full font-bold"
        disabled={shut || !text.trim() || !longEnough || !!disclosureIssue || submit.isPending}
        onClick={() => submit.mutate({
          id: sessionId,
          data: {
            body: text.trim(),
            aiUse: aiUse as AiUse,
            aiNote: aiNote.trim(),
            ...provenance.read(),
          },
        })}
      >
        {submitButtonLabel({
          shut,
          words,
          wordsRequired: minWords,
          empty: !text.trim(),
          disclosureProblem: disclosureIssue,
          sending: submit.isPending,
          resubmitting: !!assignment?.mySubmission,
        })}
      </Button>
      {!shut && !!text.trim() && !!disclosureIssue && (
        <p className="text-xs text-muted-foreground">{disclosureIssue}</p>
      )}
    </div>
  );
}

export function AssignmentDialog({ sessionId, moduleTitle, open, onOpenChange }: {
  sessionId: number; moduleTitle: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { data: assignment } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), enabled: open },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{assignment?.title ?? 'Assignment'}</DialogTitle>
          <DialogDescription>{moduleTitle}</DialogDescription>
        </DialogHeader>
        {open && <AssignmentPanel sessionId={sessionId} onSubmitted={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A door that is shut, saying so.
 *
 * Deliberately not an error: nothing has gone wrong, and there is no Retry,
 * because pressing it again is exactly what a learner in this position was
 * doing before. The sentence comes from the Lab, which knows whether the
 * programme moves module by module or a week at a time and names the thing to
 * finish accordingly.
 */
function Shut({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
      <LockKeyhole className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden />
      <div>
        <p className="text-sm font-medium">Not open to you yet</p>
        <p className="text-sm text-muted-foreground mt-0.5">{reason}</p>
      </div>
    </div>
  );
}
