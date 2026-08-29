import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionQuiz, useUpsertSessionQuiz,
  useGetSessionAssignment, useUpsertSessionAssignment,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2 } from 'lucide-react';

type EditableQuestion = { prompt: string; options: string[]; correctIndex: number };

const emptyQuestion = (): EditableQuestion => ({ prompt: '', options: ['', '', '', ''], correctIndex: 0 });

export type SeedQuestion = { prompt: string; options: string[]; correctIndex: number; rationale?: string };

export function QuizEditor({ sessionId, seed, seedVersion = 0 }: {
  sessionId: number;
  /** A drafted quiz to load in for editing. Never saved until the facilitator saves it. */
  seed?: SeedQuestion[];
  seedVersion?: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: quiz, isLoading } = useGetSessionQuiz(sessionId, {
    query: { queryKey: getGetSessionQuizQueryKey(sessionId), retry: false },
  });
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rationales, setRationales] = useState<(string | undefined)[]>([]);
  const seenSeed = useRef(0);

  useEffect(() => {
    if (!loaded && quiz) {
      setQuestions(quiz.questions.map(q => ({
        prompt: q.prompt,
        options: [...q.options],
        correctIndex: q.correctIndex ?? 0,
      })));
      setLoaded(true);
    }
  }, [quiz, loaded]);

  // A new draft replaces whatever is on screen — it is unsaved either way.
  useEffect(() => {
    if (seed && seedVersion > seenSeed.current) {
      seenSeed.current = seedVersion;
      setQuestions(seed.map(q => ({
        prompt: q.prompt,
        options: [...q.options, '', '', '', ''].slice(0, Math.max(4, q.options.length)),
        correctIndex: q.correctIndex,
      })));
      setRationales(seed.map(q => q.rationale));
      setLoaded(true);
    }
  }, [seed, seedVersion]);

  const save = useUpsertSessionQuiz({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Quiz saved' });
        qc.invalidateQueries({ queryKey: getGetSessionQuizQueryKey(sessionId) });
      },
      onError: () => toast({ title: 'Could not save the quiz', variant: 'destructive' }),
    },
  });

  const update = (i: number, patch: Partial<EditableQuestion>) =>
    setQuestions(qs => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const valid = questions.every(q =>
    q.prompt.trim() && q.options.filter(o => o.trim()).length >= 2 && q.options[q.correctIndex]?.trim(),
  );

  if (isLoading) return <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Multiple choice, learners need 70% to pass and can retake freely. Tick the correct answer for each question.
      </p>
      {questions.map((q, i) => (
        <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-background">
          <div className="flex gap-2">
            <Input
              value={q.prompt}
              onChange={e => update(i, { prompt: e.target.value })}
              placeholder={`Question ${i + 1}`}
              className="text-sm"
            />
            <Button
              variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          {rationales[i] && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
              <span className="font-semibold">Why this answer: </span>{rationales[i]}
            </p>
          )}
          {q.options.map((opt, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${sessionId}-${i}`}
                checked={q.correctIndex === oi}
                onChange={() => update(i, { correctIndex: oi })}
                className="accent-[#F97316] flex-shrink-0"
                title="Correct answer"
              />
              <Input
                value={opt}
                onChange={e => update(i, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })}
                placeholder={`Answer ${oi + 1}${q.correctIndex === oi ? ' (correct)' : ''}`}
                className="text-sm"
              />
            </div>
          ))}
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setQuestions(qs => [...qs, emptyQuestion()])}>
          <Plus className="w-4 h-4 mr-1" />Add question
        </Button>
        <Button
          size="sm"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({
            id: sessionId,
            data: {
              questions: questions.map(q => {
                const kept = q.options.map((o, oi) => ({ text: o.trim(), oi })).filter(o => o.text);
                return {
                  prompt: q.prompt.trim(),
                  options: kept.map(o => o.text),
                  correctIndex: kept.findIndex(o => o.oi === q.correctIndex),
                };
              }),
            },
          })}
        >
          {save.isPending ? 'Saving...' : 'Save quiz'}
        </Button>
      </div>
    </div>
  );
}

export function AssignmentEditor({ sessionId, seed, seedVersion = 0 }: {
  sessionId: number;
  seed?: { title: string; instructions: string };
  seedVersion?: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: assignment, isLoading } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), retry: false },
  });
  const [title, setTitle] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const seenSeed = useRef(0);

  useEffect(() => {
    if (seed && seedVersion > seenSeed.current) {
      seenSeed.current = seedVersion;
      setTitle(seed.title);
      setInstructions(seed.instructions);
    }
  }, [seed, seedVersion]);

  const titleValue = title ?? assignment?.title ?? '';
  const instructionsValue = instructions ?? assignment?.instructions ?? '';

  const save = useUpsertSessionAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Assignment saved' });
        qc.invalidateQueries({ queryKey: getGetSessionAssignmentQueryKey(sessionId) });
      },
      onError: () => toast({ title: 'Could not save the assignment', variant: 'destructive' }),
    },
  });

  if (isLoading) return <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        One written assignment per module. Submitting it counts toward module completion.
      </p>
      <Input
        value={titleValue}
        onChange={e => setTitle(e.target.value)}
        placeholder="Assignment title (e.g. Draft a 200-word narrative brief)"
        className="text-sm"
      />
      <Textarea
        value={instructionsValue}
        onChange={e => setInstructions(e.target.value)}
        placeholder="Instructions for the learner"
        rows={4}
      />
      <Button
        size="sm"
        disabled={!titleValue.trim() || save.isPending}
        onClick={() => save.mutate({ id: sessionId, data: { title: titleValue.trim(), instructions: instructionsValue } })}
      >
        {save.isPending ? 'Saving...' : 'Save assignment'}
      </Button>
    </div>
  );
}
