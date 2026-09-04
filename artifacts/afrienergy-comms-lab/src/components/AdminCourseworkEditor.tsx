import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionQuiz, useUpsertSessionQuiz,
  useGetSessionAssignment, useUpsertSessionAssignment,
  useReplaceDraftQuestion, useDraftMoreQuestions,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey,
  getGetCourseworkDraftHistoryQueryKey,
} from '@workspace/api-client-react';
import {
  originFor, resolveOrigin, MAX_QUIZ_QUESTIONS, roomForMoreQuestions, type CourseworkOrigin,
  apiReason,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, RefreshCw, Loader, Sparkles, X } from 'lucide-react';

type Seed = { prompt: string; options: string[]; correctIndex: number };

/**
 * A row's identity, independent of its position.
 *
 * Redoing a question takes half a minute, and in that time the facilitator may
 * delete a different row. Matching the answer back by position would then
 * overwrite whichever question had slid into that slot — possibly a hand-written
 * one, with nothing saved and no undo.
 */
let nextUid = 0;
const uid = () => `q${++nextUid}`;

type EditableQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  /** Why the drafter says this answer is right. Shown to the facilitator only. */
  rationale?: string;
  /**
   * The drafted version this question started as, kept alongside the question
   * itself rather than in a parallel array — deleting question two used to
   * shift every rationale below it onto the wrong question.
   *
   * It is also how "drafted" is told apart from "drafted then edited" at save
   * time, which is the difference worth recording.
   */
  seed?: Seed | null;
  /** What the database already says about a question loaded from it. */
  savedOrigin?: CourseworkOrigin;
  savedSnapshot?: Seed;
};

const emptyQuestion = (): EditableQuestion => ({ id: uid(), prompt: '', options: ['', '', '', ''], correctIndex: 0 });

export type SeedQuestion = { prompt: string; options: string[]; correctIndex: number; rationale?: string };

function fromSeed(q: SeedQuestion): EditableQuestion {
  return {
    id: uid(),
    prompt: q.prompt,
    options: [...q.options, '', '', '', ''].slice(0, Math.max(4, q.options.length)),
    correctIndex: q.correctIndex,
    rationale: q.rationale,
    seed: { prompt: q.prompt, options: [...q.options], correctIndex: q.correctIndex },
  };
}

/** What is actually saved: blank options dropped, and the key moved to match. */
function tidy(q: EditableQuestion) {
  const kept = q.options.map((o, oi) => ({ text: o.trim(), oi })).filter(o => o.text);
  return {
    prompt: q.prompt.trim(),
    options: kept.map(o => o.text),
    correctIndex: kept.findIndex(o => o.oi === q.correctIndex),
  };
}

/**
 * What to record about where a question came from, using the best evidence to
 * hand.
 *
 * A question drafted in this sitting is compared with the draft. One loaded from
 * the database keeps what was recorded before unless it has since been changed —
 * and a hand-written question stays hand-written however often it is reworded,
 * because nothing was ever generated for it.
 */
function originAtSave(clean: Seed, q: EditableQuestion): CourseworkOrigin {
  return resolveOrigin({
    againstDraft: q.seed ? originFor(clean, q.seed) : null,
    savedOrigin: q.savedOrigin,
    // originFor returns 'drafted' precisely when the two are identical.
    unchangedSinceSaved: !!q.savedSnapshot && originFor(clean, q.savedSnapshot) === 'drafted',
  });
}

/** The quiz as the drafter needs to see it, to avoid asking the same thing twice. */
function asExisting(questions: EditableQuestion[]) {
  return questions.map(q => ({ prompt: q.prompt.trim(), options: q.options.map(o => o.trim()).filter(Boolean) }));
}

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
  const seenSeed = useRef(0);

  // Which question is being redone, or 'more' when asking for additions.
  const [ask, setAsk] = useState<number | 'more' | null>(null);
  const [guidance, setGuidance] = useState('');
  const [wanted, setWanted] = useState(2);

  useEffect(() => {
    if (!loaded && quiz) {
      setQuestions(quiz.questions.map(q => ({
        id: uid(),
        prompt: q.prompt,
        options: [...q.options],
        correctIndex: q.correctIndex ?? 0,
        savedOrigin: (q.origin ?? 'manual') as CourseworkOrigin,
        savedSnapshot: { prompt: q.prompt, options: [...q.options], correctIndex: q.correctIndex ?? 0 },
      })));
      setLoaded(true);
    }
  }, [quiz, loaded]);

  // A new draft replaces whatever is on screen — it is unsaved either way.
  useEffect(() => {
    if (seed && seedVersion > seenSeed.current) {
      seenSeed.current = seedVersion;
      setQuestions(seed.map(fromSeed));
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

  const closeAsk = () => { setAsk(null); setGuidance(''); };

  const afterDraft = (problems: string[] | undefined, notes: string[] | undefined, title: string) => {
    qc.invalidateQueries({ queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId) });
    const aside = [...(problems ?? []), ...(notes ?? [])];
    toast({ title, description: aside.length ? aside.join(' ') : 'Nothing is saved until you save the quiz.' });
  };

  // Which row the in-flight redo belongs to, by identity rather than position.
  const redoingId = useRef<string | null>(null);

  const redo = useReplaceDraftQuestion({
    mutation: {
      onSuccess: (result, vars) => {
        const fresh = result.questions?.[0];
        const index = vars.data.replaceIndex;
        const targetId = redoingId.current;
        if (!fresh) {
          toast({
            title: 'No replacement came back',
            description: result.problems?.join(' ') || 'Try again, or reword the question yourself.',
            variant: 'destructive',
          });
          return;
        }
        let landed = false;
        setQuestions(qs => qs.map(q => {
          if (q.id !== targetId) return q;
          landed = true;
          return fromSeed(fresh);
        }));
        closeAsk();
        if (!landed) {
          toast({
            title: 'That question was deleted while the replacement was being written',
            description: 'Nothing was changed.',
            variant: 'destructive',
          });
          return;
        }
        afterDraft(result.problems, result.notes, `Question ${index + 1} redone`);
      },
      onError: (err) => toast({
        title: 'Could not redo that question',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const more = useDraftMoreQuestions({
    mutation: {
      onSuccess: (result) => {
        const fresh = result.questions ?? [];
        if (fresh.length === 0) {
          toast({
            title: 'No new questions came back',
            description: result.problems?.join(' ') || 'The material may not cover enough new ground.',
            variant: 'destructive',
          });
          return;
        }
        setQuestions(qs => [...qs, ...fresh.map(fromSeed)]);
        closeAsk();
        afterDraft(result.problems, result.notes, `${fresh.length} question${fresh.length === 1 ? '' : 's'} added`);
      },
      onError: (err) => toast({
        title: 'Could not draft more questions',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const update = (i: number, patch: Partial<EditableQuestion>) =>
    setQuestions(qs => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const valid = questions.every(q =>
    q.prompt.trim() && q.options.filter(o => o.trim()).length >= 2 && q.options[q.correctIndex]?.trim(),
  );
  const written = questions.filter(q => q.prompt.trim()).length;
  const room = roomForMoreQuestions(written);
  const busy = redo.isPending || more.isPending;

  if (isLoading) return <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />;

  const askPanel = (mode: 'replace' | 'more') => (
    <div className="border border-primary/40 bg-primary/5 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium">
          {mode === 'replace' ? 'What should be different about it?' : 'What should the new questions cover?'}
          <span className="font-normal text-muted-foreground"> — optional</span>
        </p>
        <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={closeAsk} aria-label="Cancel">
          <X className="w-3.5 h-3.5" aria-hidden />
        </Button>
      </div>

      <Input
        value={guidance}
        onChange={e => setGuidance(e.target.value.slice(0, 500))}
        placeholder={mode === 'replace'
          ? 'e.g. ask about who pays, not what it costs'
          : 'e.g. nothing on the financing section yet'}
        className="text-sm"
        aria-label="Guidance for the drafter"
      />

      {mode === 'more' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">How many?</span>
          {[1, 2, 3, 4].filter(n => n <= room).map(n => (
            <Button
              key={n}
              size="sm"
              variant={wanted === n ? 'default' : 'outline'}
              className="h-7 w-7 p-0"
              onClick={() => setWanted(n)}
            >
              {n}
            </Button>
          ))}
        </div>
      )}

      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          const existing = asExisting(questions);
          if (mode === 'replace' && typeof ask === 'number') {
            redoingId.current = questions[ask]?.id ?? null;
            redo.mutate({ id: sessionId, data: { existing, replaceIndex: ask, guidance: guidance.trim() || undefined } });
          } else {
            more.mutate({ id: sessionId, data: { existing, wanted: Math.min(wanted, room), guidance: guidance.trim() || undefined } });
          }
        }}
      >
        {busy
          ? <><Loader className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden />Drafting…</>
          : mode === 'replace' ? 'Redo this question' : 'Draft them'}
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Multiple choice, learners need 70% to pass and can retake freely. Tick the correct answer for each question.
      </p>
      {questions.map((q, i) => (
        <div key={q.id} className="space-y-2">
          <div className="border border-border rounded-lg p-3 space-y-2 bg-background">
            <div className="flex gap-2">
              <Input
                value={q.prompt}
                onChange={e => update(i, { prompt: e.target.value })}
                placeholder={`Question ${i + 1}`}
                className="text-sm"
              />
              <Button
                variant="ghost" size="icon"
                className="text-muted-foreground hover:text-primary flex-shrink-0"
                disabled={busy}
                onClick={() => { setAsk(ask === i ? null : i); setGuidance(''); }}
                title="Redo this question"
                aria-label={`Redo question ${i + 1}`}
              >
                <RefreshCw className={`w-4 h-4 ${redo.isPending && ask === i ? 'animate-spin' : ''}`} aria-hidden />
              </Button>
              <Button
                variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => setQuestions(qs => qs.filter((_, j) => j !== i))}
                aria-label={`Remove question ${i + 1}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden />
              </Button>
            </div>
            {!q.rationale && q.savedOrigin === 'drafted' && (
              <p className="text-xs text-amber-800">
                Saved exactly as drafted — nobody has changed a word of this one.
              </p>
            )}
            {q.rationale && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                <span className="font-semibold">Why this answer: </span>{q.rationale}
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
          {ask === i && askPanel('replace')}
        </div>
      ))}

      {ask === 'more' && askPanel('more')}

      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant="outline" onClick={() => setQuestions(qs => [...qs, emptyQuestion()])}>
          <Plus className="w-4 h-4 mr-1" aria-hidden />Add question
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={room === 0 || busy}
          onClick={() => { setAsk(ask === 'more' ? null : 'more'); setGuidance(''); setWanted(Math.min(2, room) || 1); }}
        >
          <Sparkles className="w-4 h-4 mr-1" aria-hidden />Draft more
        </Button>
        <Button
          size="sm"
          disabled={!valid || save.isPending}
          onClick={() => save.mutate({
            id: sessionId,
            data: {
              questions: questions.map(q => {
                const clean = tidy(q);
                return { ...clean, origin: originAtSave(clean, q) };
              }),
            },
          })}
        >
          {save.isPending ? 'Saving...' : 'Save quiz'}
        </Button>
        {room === 0 && (
          <span className="text-xs text-muted-foreground">
            {MAX_QUIZ_QUESTIONS} is as long as a quiz should be.
          </span>
        )}
      </div>
    </div>
  );
}

type TaskText = { title: string; instructions: string };

const sameTask = (a: TaskText, b: TaskText) => a.title === b.title && a.instructions === b.instructions;

/**
 * Where the written task came from, using the best evidence to hand.
 *
 * The stored origin has to be read back and respected, or every save after a
 * page reload would claim a person wrote a task the model wrote — the exact
 * question this field exists to answer, answered wrongly, and in the direction
 * that hides how little was reviewed.
 */
function assignmentOrigin(
  current: TaskText,
  draftedThisSitting: TaskText | null,
  saved: TaskText | null,
  savedOrigin: CourseworkOrigin | null,
): CourseworkOrigin {
  return resolveOrigin({
    againstDraft: draftedThisSitting
      ? (sameTask(current, draftedThisSitting) ? 'drafted' : 'edited')
      : null,
    savedOrigin,
    unchangedSinceSaved: !!saved && sameTask(current, saved),
  });
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
  // The drafted task this started as, so an untouched draft can be told apart
  // from one a facilitator rewrote.
  const [draftedFrom, setDraftedFrom] = useState<{ title: string; instructions: string } | null>(null);
  const seenSeed = useRef(0);

  useEffect(() => {
    if (seed && seedVersion > seenSeed.current) {
      seenSeed.current = seedVersion;
      setTitle(seed.title);
      setInstructions(seed.instructions);
      setDraftedFrom({ title: seed.title, instructions: seed.instructions });
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
        onClick={() => save.mutate({
          id: sessionId,
          data: {
            title: titleValue.trim(),
            instructions: instructionsValue,
            origin: assignmentOrigin(
              { title: titleValue.trim(), instructions: instructionsValue.trim() },
              draftedFrom,
              assignment ? { title: assignment.title.trim(), instructions: assignment.instructions.trim() } : null,
              (assignment?.origin ?? null) as CourseworkOrigin | null,
            ),
          },
        })}
      >
        {save.isPending ? 'Saving...' : 'Save assignment'}
      </Button>
    </div>
  );
}
