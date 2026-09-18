import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionQuiz, useUpsertSessionQuiz,
  useGetSessionAssignment, useUpsertSessionAssignment,
  useReplaceDraftQuestion, useDraftMoreQuestions, useDraftWrittenTask,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey,
  getGetCourseworkDraftHistoryQueryKey,
} from '@workspace/api-client-react';
import {
  originFor, resolveOrigin, MAX_QUIZ_QUESTIONS, roomForMoreQuestions, type CourseworkOrigin,
  apiReason, dueDateFromInput, dueDateInputValue,
  MIN_TASK_WORDS, MIN_CRITIQUE_WORDS, DEFAULT_REVIEWS_REQUIRED,
} from '@workspace/domain';
import { deadlineSummary } from '@/lib/dueDateText';
import DateTimeField from '@/components/DateTimeField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { SaveAndClose } from '@/components/EditorSection';
import { Plus, Trash2, RefreshCw, Loader, Sparkles, X, CalendarClock } from 'lucide-react';


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

export function QuizEditor({ sessionId, seed, seedVersion = 0, onSaved, onDrafted, suggestedDueAt }: {
  sessionId: number;
  /** A drafted quiz to load in for editing. Never saved until the facilitator saves it. */
  seed?: SeedQuestion[];
  seedVersion?: number;
  /** Called once the save has actually landed, so the panel can shut itself. */
  onSaved?: () => void;
  /**
   * Called when drafted questions land in the editor unsaved, so whatever is
   * holding it knows there is something here to lose.
   */
  onDrafted?: () => void;
  /**
   * The deadline the Lab would pick, on a programme taught week by week.
   *
   * Offered only for a quiz that has never been saved. After that the saved
   * date is the answer, including when the saved date is deliberately none —
   * a facilitator who clears a deadline should not find it back tomorrow.
   */
  suggestedDueAt?: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: quiz, isLoading } = useGetSessionQuiz(sessionId, {
    query: { queryKey: getGetSessionQuizQueryKey(sessionId), retry: false },
  });
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [due, setDue] = useState<string | null>(null);
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
        // Only now — a panel that shut on the click would hide a save that
        // then failed, and the facilitator would walk away from lost work.
        onSaved?.();
      },
      onError: () => toast({ title: 'Could not save the quiz', variant: 'destructive' }),
    },
  });

  const closeAsk = () => { setAsk(null); setGuidance(''); };

  const afterDraft = (problems: string[] | undefined, notes: string[] | undefined, title: string) => {
    onDrafted?.();
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

  // What has been typed this sitting, otherwise what is saved, otherwise — only
  // for a quiz that does not exist yet — the Lab's suggestion.
  const dueValue = due ?? dueDateInputValue(quiz ? quiz.dueAt : suggestedDueAt);

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

      <DateTimeField
        id={`quiz-due-${sessionId}`}
        label="Answers close"
        value={dueValue}
        onChange={setDue}
        summary={deadlineSummary(dueDateFromInput(dueValue))}
      />
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
        <SaveAndClose
          onSave={() => save.mutate({
            id: sessionId,
            data: {
              dueAt: dueDateFromInput(dueValue),
              questions: questions.map(q => {
                const clean = tidy(q);
                return { ...clean, origin: originAtSave(clean, q) };
              }),
            },
          })}
          onClose={() => onSaved?.()}
          saving={save.isPending}
          disabled={!valid}
        />
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

export function AssignmentEditor({ sessionId, seed, seedVersion = 0, onSaved, onDrafted, suggestedDueAt, canDraft = false }: {
  sessionId: number;
  seed?: { title: string; instructions: string };
  seedVersion?: number;
  /** Called once the save has actually landed, so the panel can shut itself. */
  onSaved?: () => void;
  /**
   * Called when a draft lands in the boxes and has not been saved, so whatever
   * is holding this editor knows there is something here to lose.
   */
  onDrafted?: () => void;
  /** As on the quiz: offered only for a task that has never been saved. */
  suggestedDueAt?: string | null;
  /**
   * Is there class material to draft from?
   *
   * The button is shown either way. A drafting button that appears only once
   * some other condition is met is a button nobody knows exists, which is how
   * the drafter came to look as though it did not write tasks at all.
   */
  canDraft?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  /** Open when the facilitator is typing what the task should be about. */
  const [ask, setAsk] = useState(false);
  const [guidance, setGuidance] = useState('');
  const [drafterSaid, setDrafterSaid] = useState<{ problems: string[]; notes: string[] }>({ problems: [], notes: [] });
  const { data: assignment, isLoading } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), retry: false },
  });
  const [title, setTitle] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  // The drafted task this started as, so an untouched draft can be told apart
  // from one a facilitator rewrote.
  const [draftedFrom, setDraftedFrom] = useState<{ title: string; instructions: string } | null>(null);
  /**
   * How many critiques this module asks for.
   *
   * It had no control at all, and the editor sent no value — so the server
   * filled in the house default on every save and a module deliberately set to
   * one critique silently became two. On screen now, so it is visible before it
   * is changed and so the save carries what is actually set.
   */
  const [reviews, setReviews] = useState<number | null>(null);
  const [due, setDue] = useState<string | null>(null);
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
  // Same fall-back shape as the two above: what has been typed this sitting,
  // otherwise whatever is saved.
  const dueValue = due ?? dueDateInputValue(assignment ? assignment.dueAt : suggestedDueAt);
  const reviewsValue = reviews ?? assignment?.reviewsRequired ?? DEFAULT_REVIEWS_REQUIRED;

  const save = useUpsertSessionAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Assignment saved' });
        qc.invalidateQueries({ queryKey: getGetSessionAssignmentQueryKey(sessionId) });
        onSaved?.();
      },
      onError: () => toast({ title: 'Could not save the assignment', variant: 'destructive' }),
    },
  });

  /**
   * Ask the drafter for the brief, and nothing else.
   *
   * What is in the boxes goes with the request, so this is "write something
   * other than this" rather than a blank page — and pressing it on a task you
   * have already written is a redo, not a duplicate.
   */
  const draft = useDraftWrittenTask({
    mutation: {
      onSuccess: (result) => {
        setDrafterSaid({ problems: result.problems ?? [], notes: result.notes ?? [] });
        qc.invalidateQueries({ queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId) });
        if (!result.assignment) {
          // Nothing usable came back. The boxes are left exactly as they were:
          // a failed draft must never eat what a facilitator had written.
          toast({
            title: 'Nothing came back',
            description: result.problems?.[0] ?? 'Try again in a moment.',
            variant: 'destructive',
          });
          return;
        }
        setTitle(result.assignment.title);
        setInstructions(result.assignment.instructions);
        setDraftedFrom({ title: result.assignment.title, instructions: result.assignment.instructions });
        onDrafted?.();
        setAsk(false);
        setGuidance('');
        toast({
          title: 'Task drafted',
          description: 'Read it before saving. Nothing has been saved yet.',
        });
      },
      onError: (err) => toast({
        title: 'Could not draft the task',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  if (isLoading) return <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />;

  const hasTask = !!(titleValue.trim() || instructionsValue.trim());

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          One written assignment per module. Submitting it counts toward module completion.
          {' '}Learners must write at least {MIN_TASK_WORDS} words, and {MIN_CRITIQUE_WORDS} on each
          critique — so do not set a brief asking for less than {MIN_TASK_WORDS}.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={draft.isPending}
          onClick={() => { setAsk(!ask); setGuidance(''); }}
          aria-expanded={ask}
        >
          <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
          {hasTask ? 'Redo this task' : 'Draft this task'}
        </Button>
      </div>

      {ask && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs font-medium">
            What should the task be about?
            <span className="font-normal text-muted-foreground"> — optional</span>
          </p>
          <Input
            value={guidance}
            onChange={e => setGuidance(e.target.value.slice(0, 500))}
            placeholder="e.g. make it about the financing section, and ask for a script rather than a lede"
            className="text-sm"
            aria-label="Guidance for the drafter"
          />
          {hasTask && (
            <p className="text-xs text-muted-foreground">
              What is in the boxes below goes with the request, and the drafter is asked for
              something other than it. Nothing is replaced until a draft actually comes back.
            </p>
          )}
          {!canDraft && (
            <p className="text-xs text-[#9A3412]">
              There is no class material to draft from yet. Upload the deck or paste the
              transcript above first — either on its own is enough.
            </p>
          )}
          <Button
            size="sm"
            disabled={draft.isPending || !canDraft}
            onClick={() => draft.mutate({
              id: sessionId,
              data: {
                current: hasTask
                  ? { title: titleValue.trim(), instructions: instructionsValue.trim() }
                  : null,
                guidance: guidance.trim() || undefined,
              },
            })}
          >
            {draft.isPending
              ? <><Loader className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />Drafting…</>
              : hasTask ? 'Write a different one' : 'Draft it'}
          </Button>
        </div>
      )}

      {drafterSaid.problems.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
          <p className="mb-1 font-semibold text-red-900">The drafter could not finish</p>
          <ul className="list-disc space-y-0.5 pl-4 text-red-900/90">
            {drafterSaid.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {drafterSaid.notes.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs">
          <p className="mb-1 font-semibold">Worth a second look</p>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {drafterSaid.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

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
      <div className="rounded-lg border border-border bg-background px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`assignment-reviews-${sessionId}`} className="text-xs font-medium">
            Critiques each learner owes
          </label>
          <select
            id={`assignment-reviews-${sessionId}`}
            value={reviewsValue}
            onChange={e => setReviews(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {reviewsValue === 0
            ? 'Nobody critiques anybody on this one.'
            : `Filing the task and writing ${reviewsValue} critique${reviewsValue === 1 ? '' : 's'} is what completes the module.`}
          {' '}Lowering it never un-completes anybody; raising it only applies to work filed from now on.
        </p>
      </div>

      <DateTimeField
        id={`assignment-due-${sessionId}`}
        label="Submissions close"
        value={dueValue}
        onChange={setDue}
        summary={deadlineSummary(dueDateFromInput(dueValue))}
      />
      <SaveAndClose
        saving={save.isPending}
        disabled={!titleValue.trim()}
        onClose={() => onSaved?.()}
        onSave={() => save.mutate({
          id: sessionId,
          data: {
            title: titleValue.trim(),
            instructions: instructionsValue,
            dueAt: dueDateFromInput(dueValue),
            // Sent explicitly, so the value on screen is the value saved. The
            // server also keeps what is there when this is missing — an older
            // browser must not reset it either.
            reviewsRequired: reviewsValue,
            origin: assignmentOrigin(
              { title: titleValue.trim(), instructions: instructionsValue.trim() },
              draftedFrom,
              assignment ? { title: assignment.title.trim(), instructions: assignment.instructions.trim() } : null,
              (assignment?.origin ?? null) as CourseworkOrigin | null,
            ),
          },
        })}
      />
    </div>
  );
}
