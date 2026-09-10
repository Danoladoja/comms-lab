import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionQuiz, useSubmitQuizAttempt,
  useGetSessionAssignment, useSubmitAssignment,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey, getListMyProgressQueryKey,
} from '@workspace/api-client-react';
import { apiReason } from '@workspace/domain';
import { deadlineNotice } from '@/lib/dueDateText';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, RotateCcw, CalendarClock, LockKeyhole } from 'lucide-react';

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
  const { data: quiz, isLoading, error } = useGetSessionQuiz(sessionId, {
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
  const closed = !!quiz?.closed;
  const allAnswered = questions.length > 0 && questions.every(q => answers[q.id] !== undefined);
  const reset = () => { setAnswers({}); setResult(null); };

  if (isLoading) return <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />;
  if (error) return <p className="text-sm text-muted-foreground py-4">This quiz is not available yet.</p>;

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
      <Deadline dueAt={quiz?.dueAt} closed={closed} />
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
        disabled={closed || !allAnswered || submit.isPending}
        onClick={() => submit.mutate({
          id: sessionId,
          data: { answers: questions.map(q => ({ questionId: q.id, answerIndex: answers[q.id] })) },
        })}
      >
        {closed ? 'Closed' : submit.isPending ? 'Grading...' : 'Submit answers'}
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

/** Assignment brief plus the submission box. Used in the dashboard dialog and
 *  inline in the classroom. */
export function AssignmentPanel({ sessionId, enabled = true, onSubmitted }: {
  sessionId: number; enabled?: boolean; onSubmitted?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: assignment, isLoading, error } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), enabled },
  });
  const [body, setBody] = useState<string | null>(null);
  const text = body ?? assignment?.mySubmission?.body ?? '';

  const submit = useSubmitAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Assignment submitted', description: 'Your response has been saved.' });
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

  const closed = !!assignment?.closed;

  if (isLoading) return <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />;
  if (error) return <p className="text-sm text-muted-foreground py-4">This assignment is not available yet.</p>;

  return (
    <div className="space-y-4">
      {assignment?.instructions && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-[#F4F0E8] border border-border rounded-lg px-3 py-2.5">
          {assignment.instructions}
        </p>
      )}
      <Deadline dueAt={assignment?.dueAt} closed={closed} />
      {assignment?.mySubmission && (
        <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Submitted {new Date(assignment.mySubmission.submittedAt).toLocaleString()}
          {closed ? '.' : ' — you can revise and resubmit.'}
        </p>
      )}
      <Textarea
        value={text}
        onChange={e => setBody(e.target.value)}
        placeholder={closed ? 'Submissions are closed for this assignment.' : 'Type your response here...'}
        rows={8}
        readOnly={closed}
      />
      <Button
        className="w-full font-bold"
        disabled={closed || !text.trim() || submit.isPending}
        onClick={() => submit.mutate({ id: sessionId, data: { body: text.trim() } })}
      >
        {closed
          ? 'Closed'
          : submit.isPending
            ? 'Submitting...'
            : assignment?.mySubmission ? 'Resubmit assignment' : 'Submit assignment'}
      </Button>
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
