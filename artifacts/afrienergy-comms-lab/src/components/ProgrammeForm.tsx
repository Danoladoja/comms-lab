import { useMemo, useState } from 'react';
import {
  useGetProgramForm, useFileProgramForm, getGetProgramFormQueryKey,
  type FormQuestion, type FormAnswer, type FormFault,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  countWords, answerProblem, answeredCount, faultSummary, sectionsOf, sectionHeading,
  LAB_COLOURS, LAB_TAGLINE,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * The opening assessment and the closing survey, as a learner meets them.
 *
 * Three decisions in here are about not wasting people's goodwill.
 *
 * Every fault is shown at once and each is attached to its own question, so
 * nobody files, is bounced, scrolls to find out why, fixes one thing and is
 * bounced again. This form is compulsory and holds a certificate, so a
 * frustrating one is not merely annoying — it is the Lab withholding something
 * somebody earned, behind an obstacle of its own making.
 *
 * The word count is live and counts down rather than up. "63 of 80" tells you
 * where you stand; "63 words" makes you do arithmetic against a limit you have
 * scrolled past.
 *
 * And the whole thing is checked in the browser with the same functions the
 * server uses, from @workspace/domain. Not for security — the server checks
 * again and is the only one that counts — but so that what the page says is
 * wrong and what the server says is wrong can never be two different lists.
 */
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * The Lab's masthead, the one from the letters.
 *
 * A learner meets four of the Lab's emails and this survey inside a fortnight.
 * Arriving as two different-looking things from the same organisation reads as
 * carelessness at best, and the plainer one reads as something forged — which
 * matters more here than anywhere, because this page asks people to be candid
 * about their own experience.
 *
 * The colours come from @workspace/domain so the letter and this cannot drift
 * into two near-identical oranges. The name is set in type beside the logo for
 * the same reason the email does it: an image that fails to load must not take
 * the Lab's name with it.
 */
function Masthead({ title, intro }: { title: string; intro: string }) {
  return (
    <div style={{ background: LAB_COLOURS.ink }} className="px-6 py-6 sm:px-8">
      <div className="flex items-center gap-3">
        <img
          src={`${basePath}/logo-white.png`}
          alt=""
          width={456}
          height={160}
          className="h-8 w-auto"
        />
        <span className="sr-only">Ananse Comms Lab</span>
      </div>
      <p
        className="mt-3 text-[11px] uppercase tracking-[0.08em]"
        style={{ color: LAB_COLOURS.creamLight, opacity: 0.75 }}
      >
        {LAB_TAGLINE}
      </p>
      <h2 className="mt-4 font-display text-xl font-bold" style={{ color: LAB_COLOURS.creamLight }}>
        {title}
      </h2>
      {intro && (
        <p className="mt-1.5 max-w-2xl text-sm" style={{ color: LAB_COLOURS.creamLight, opacity: 0.85 }}>
          {intro}
        </p>
      )}
    </div>
  );
}

export default function ProgrammeForm({ programId, stage, onFiled, preview }: {
  programId: number;
  stage: 'before' | 'after';
  onFiled?: () => void;
  /**
   * Render these questions instead of fetching, and file nothing.
   *
   * For an admin reading a draft before publishing it. Deliberately the same
   * component rather than a second one that looks like it: a preview built
   * separately is a preview that stops being true, and the whole point of it is
   * to show exactly what a learner will meet.
   */
  preview?: { title: string; intro: string; questions: FormQuestion[] } | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<number, FormAnswer>>({});
  const [faults, setFaults] = useState<FormFault[]>([]);
  /** Only show faults once they have tried. Scolding before they start is rude. */
  const [tried, setTried] = useState(false);

  const { data: fetched, isLoading } = useGetProgramForm(programId, stage, {
    query: { queryKey: getGetProgramFormQueryKey(programId, stage), enabled: !preview },
  });

  // One shape whether it came from the server or from a draft being read.
  const data = preview
    ? { published: true, filed: false, title: preview.title, intro: preview.intro,
        questions: preview.questions, filedAt: null }
    : fetched;

  const file = useFileProgramForm({
    mutation: {
      onSuccess: () => {
        toast({
          title: stage === 'after' ? 'Thank you — that is filed' : 'Thank you',
          description: stage === 'after'
            ? 'Your certificate is no longer waiting on anything.'
            : 'We read these before the first class.',
        });
        qc.invalidateQueries({ queryKey: getGetProgramFormQueryKey(programId, stage) });
        onFiled?.();
      },
      onError: (err) => {
        // The server returns every fault; show them against their questions
        // rather than as one toast nobody can act on.
        const body = (err as { response?: { data?: { faults?: FormFault[]; error?: string } } })?.response?.data;
        if (body?.faults?.length) {
          setFaults(body.faults);
          setTried(true);
        }
        toast({
          title: 'Not filed yet',
          description: body?.error ?? 'Something went wrong. Try again in a moment.',
          variant: 'destructive',
        });
      },
    },
  });

  const questions = (data?.questions ?? []) as FormQuestion[];
  const given = useMemo(() => Object.values(answers), [answers]);
  const sections = useMemo(() => sectionsOf(questions as never), [questions]);
  // Numbered across the whole form rather than restarting each section, so
  // "question 14" means one thing when somebody writes to ask about it.
  const numberOf = useMemo(
    () => new Map(questions.map((q, i) => [q.id, i + 1])),
    [questions],
  );
  const progress = useMemo(
    () => answeredCount(questions as never, given as never),
    [questions, given],
  );

  const set = (questionId: number, patch: Partial<FormAnswer>) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? { questionId }), questionId, ...patch },
    }));
    setFaults(prev => prev.filter(f => f.questionId !== questionId));
  };

  if (!preview && isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />;
  if (!data?.published) return null;

  if (data.filed) {
    return (
      <section className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {data.title} — filed
        </p>
        <p className="mt-1 text-xs text-emerald-900">
          Thank you. {stage === 'after'
            ? 'Nothing is waiting on you now.'
            : 'We read every one of these before the programme starts.'}
        </p>
      </section>
    );
  }

  const faultFor = (id: number) => faults.find(f => f.questionId === id)?.problem
    ?? (tried
      ? answerProblem(
        questions.find(q => q.id === id) as never,
        answers[id] as never,
      ) ?? undefined
      : undefined);

  return (
    <section
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: LAB_COLOURS.rule, background: LAB_COLOURS.cream }}
    >
      <Masthead title={data.title ?? ''} intro={data.intro ?? ''} />

      <div className="space-y-5 bg-white p-6 sm:p-8" style={{ color: LAB_COLOURS.ink }}>
      {preview && (
        <p
          className="rounded-md px-3 py-2 text-xs"
          style={{ background: LAB_COLOURS.creamLight, color: LAB_COLOURS.muted }}
        >
          You are reading the draft exactly as a learner will see it. Nothing here can be filed.
        </p>
      )}
      <p className="text-xs" style={{ color: LAB_COLOURS.muted }}>
        {progress.answered} of {progress.required} questions answered.
        {stage === 'after' && !preview && ' Your certificate is waiting on this.'}
      </p>

      {tried && faults.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {faultSummary(faults as never)}
        </p>
      )}

      {/*
        Grouped into its sections rather than one unbroken column of twenty.
        A long form read as a single list is one people abandon halfway and
        answer carelessly in the second half; named parts say where you are and
        how much is left.
      */}
      <div className="space-y-8">
        {sections.map((section, si) => (
          <div key={`${section.name}-${si}`} className="space-y-5">
            {section.name && (
              <div className="pb-1.5" style={{ borderBottom: `2px solid ${LAB_COLOURS.accent}` }}>
                <p
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: LAB_COLOURS.accent }}
                >
                  {sectionHeading(si, sections.length, section.name)}
                </p>
              </div>
            )}
            <ol className="space-y-6">
              {section.questions.map(q => (
                <li key={q.id} className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">
                      <span className="text-muted-foreground">{numberOf.get(q.id)}. </span>
                      {q.prompt}
                      {!q.required && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
                      )}
                    </p>
                    {q.help && <p className="mt-0.5 text-xs text-muted-foreground">{q.help}</p>}
                  </div>

                  <QuestionBody question={q} answer={answers[q.id]} onChange={patch => set(q.id, patch)} />

                  {faultFor(q.id) && (
                    <p className="text-xs text-destructive">{faultFor(q.id)}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-3 pt-4"
        style={{ borderTop: `1px solid ${LAB_COLOURS.rule}` }}
      >
        <Button
          disabled={file.isPending || !!preview}
          style={{ background: LAB_COLOURS.accent, color: LAB_COLOURS.ink }}
          onClick={() => {
            setTried(true);
            // Checked here first so an obviously incomplete form does not need
            // a round trip to say so.
            const local = questions
              .map(q => ({ q, problem: answerProblem(q as never, answers[q.id] as never) }))
              .filter(x => x.problem)
              .map(x => ({ questionId: x.q.id, prompt: x.q.prompt, problem: x.problem as string }));
            if (local.length > 0) { setFaults(local); return; }
            file.mutate({ id: programId, stage, data: { answers: given } });
          }}
        >
          {preview ? 'File it' : file.isPending ? 'Filing…' : 'File it'}
        </Button>
        <p className="text-xs" style={{ color: LAB_COLOURS.muted }}>
          {preview
            ? 'This button does nothing while you are reading the draft.'
            : 'You can file this once. Nothing here is marked, and nobody is scored on it.'}
        </p>
      </div>
      </div>
    </section>
  );
}

/** The question itself, by kind. */
function QuestionBody({ question, answer, onChange }: {
  question: FormQuestion;
  answer: FormAnswer | undefined;
  onChange: (patch: Partial<FormAnswer>) => void;
}) {
  const c = question.config ?? {};

  if (question.kind === 'slider') {
    const min = c.min ?? 0;
    const max = c.max ?? 10;
    const step = c.step ?? 1;
    // Undefined until they touch it, so an untouched slider is not silently
    // recorded as the number it happens to be sitting on.
    const value = answer?.number;
    return (
      <div className="max-w-xl">
        <input
          type="range"
          className="w-full"
          style={{ accentColor: LAB_COLOURS.accent }}
          min={min}
          max={max}
          step={step}
          value={value ?? Math.round((min + max) / 2)}
          onChange={e => onChange({ number: Number(e.target.value) })}
          aria-label={question.prompt}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{c.minLabel}</span>
          <span className={value === undefined || value === null ? 'italic' : 'font-semibold text-foreground'}>
            {value === undefined || value === null ? 'Drag to answer' : value}
          </span>
          <span>{c.maxLabel}</span>
        </div>
      </div>
    );
  }

  if (question.kind === 'rating') {
    const scale = c.scale ?? 5;
    const picked = answer?.number;
    return (
      <div className="max-w-xl">
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: scale }, (_, i) => i + 1).map(step => (
            <button
              key={step}
              type="button"
              aria-pressed={picked === step}
              aria-label={`${step} of ${scale}`}
              className={`h-9 w-9 rounded-md border text-sm font-medium transition ${
                picked === step
                  ? 'text-white'
                  : 'bg-white hover:opacity-80'
              }`}
              style={picked === step
                ? { background: LAB_COLOURS.accent, borderColor: LAB_COLOURS.accent }
                : { borderColor: LAB_COLOURS.rule }}
              onClick={() => onChange({ number: step })}
            >
              {step}
            </button>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{c.lowLabel}</span>
          <span>{c.highLabel}</span>
        </div>
      </div>
    );
  }

  if (question.kind === 'choice') {
    return (
      <div className="space-y-1.5">
        {(c.options ?? []).map(option => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={answer?.text === option}
              onChange={() => onChange({ text: option })}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.kind === 'multi') {
    const picked = answer?.choices ?? [];
    const most = c.pickAtMost;
    return (
      <div className="space-y-1.5">
        {(c.options ?? []).map(option => {
          const on = picked.includes(option);
          // Stop them at the ceiling rather than letting them pick seven and
          // be told afterwards that three was the limit.
          const full = !on && most !== undefined && picked.length >= most;
          return (
            <label
              key={option}
              className={`flex items-center gap-2 text-sm ${full ? 'text-muted-foreground' : ''}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={full}
                onChange={() => onChange({
                  choices: on ? picked.filter(p => p !== option) : [...picked, option],
                })}
              />
              {option}
            </label>
          );
        })}
        {most !== undefined && (
          <p className="text-xs text-muted-foreground">
            {picked.length} of {most} picked.
          </p>
        )}
      </div>
    );
  }

  // Written answers, with the count the learner actually needs.
  const text = answer?.text ?? '';
  const words = countWords(text);
  const most = c.wordsAtMost ?? (question.kind === 'short' ? 60 : 300);
  const least = c.wordsAtLeast ?? 0;
  const over = words > most;
  const under = question.required && words < least;

  return (
    <div className="max-w-2xl">
      <textarea
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        rows={question.kind === 'short' ? 2 : 5}
        value={text}
        onChange={e => onChange({ text: e.target.value })}
        aria-label={question.prompt}
      />
      <p className={`mt-1 text-xs ${over || under ? 'text-destructive' : 'text-muted-foreground'}`}>
        {words} of {most} words
        {least > 0 && words < least && ` · at least ${least} needed`}
        {over && ` · ${words - most} over`}
      </p>
    </div>
  );
}
