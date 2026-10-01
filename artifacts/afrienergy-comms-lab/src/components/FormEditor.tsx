import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAddFormQuestion, useUpdateFormQuestion, useDeleteFormQuestion,
  useReorderFormQuestions, useUpdateFormDetails,
  getListProgramFormsQueryKey,
  type FormQuestion, type ProgramFormSummary, type FormQuestionDraft,
} from '@workspace/api-client-react';
import { apiReason, sectionsOf, moved, canMove } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ChevronUp, ChevronDown, Trash2, Plus, Pencil } from 'lucide-react';

/**
 * Editing a programme's questions.
 *
 * The thing worth knowing before using this: once somebody has answered a
 * question, the server refuses any change that would alter what their answer
 * means — a different kind of question, an option removed, a rating scale
 * shortened, a slider narrowed. Those refusals come back as whole sentences
 * explaining what would break, and this screen shows them as they are rather
 * than translating them into "could not save".
 *
 * Wording changes always go through, because the commonest edit by far is a
 * typo somebody spotted after publishing.
 */
export default function FormEditor({ programId, form, onDone }: {
  programId: number;
  form: ProgramFormSummary;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: getListProgramFormsQueryKey(programId) });
  const fail = (title: string) => (err: unknown) => toast({
    title,
    // The server's sentence travels. Every refusal here names what would break
    // and what to do instead, and replacing that with "could not save" would
    // throw away the only useful part.
    description: apiReason(err, 'Try again in a moment.'),
    variant: 'destructive',
  });

  const add = useAddFormQuestion({
    mutation: { onSuccess: () => { setAdding(false); refresh(); }, onError: fail('Could not add it') },
  });
  const update = useUpdateFormQuestion({
    mutation: { onSuccess: () => { setEditing(null); refresh(); }, onError: fail('Could not change it') },
  });
  const remove = useDeleteFormQuestion({
    mutation: { onSuccess: () => refresh(), onError: fail('Could not remove it') },
  });
  const reorder = useReorderFormQuestions({
    mutation: { onSuccess: () => refresh(), onError: fail('Could not reorder them') },
  });
  const details = useUpdateFormDetails({
    mutation: { onSuccess: () => { toast({ title: 'Saved' }); refresh(); }, onError: fail('Could not save it') },
  });

  const questions = (form.questions ?? []) as FormQuestion[];
  const ids = questions.map(q => q.id);
  const sections = sectionsOf(questions as never);

  const move = (id: number, direction: 'up' | 'down') => {
    reorder.mutate({
      id: programId,
      stage: form.stage,
      data: { questionIds: moved(ids, id, direction) },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">
          Editing: {form.stage === 'before' ? 'Opening assessment' : 'Closing survey'}
        </h3>
        <Button size="sm" variant="outline" onClick={onDone}>Done</Button>
      </div>

      {form.published && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          This form is open to the cohort. You can still change it, but anything that would alter
          what an existing answer means — a different kind of question, an option removed, a scale
          shortened — will be refused, and the refusal will say why.
        </p>
      )}

      <TitleAndIntro
        title={form.title ?? ''}
        intro={form.intro ?? ''}
        busy={details.isPending}
        onSave={(title, intro) => details.mutate({ id: programId, stage: form.stage, data: { title, intro } })}
      />

      <div className="space-y-5">
        {sections.map((section, si) => (
          <div key={`${section.name}-${si}`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
              {section.name || 'No section'}
            </p>
            <ul className="space-y-2">
              {section.questions.map(q => {
                const at = ids.indexOf(q.id);
                const where = canMove(at, ids.length);
                return (
                  <li key={q.id} className="rounded-md border border-border bg-background p-3">
                    {editing === q.id ? (
                      <QuestionFields
                        initial={q}
                        busy={update.isPending}
                        onCancel={() => setEditing(null)}
                        onSave={data => update.mutate({ questionId: q.id, data })}
                      />
                    ) : (
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{q.prompt}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {q.kind}
                            {q.required ? ' · required' : ' · optional'}
                            {q.pairKey ? ` · paired as "${q.pairKey}"` : ''}
                          </p>
                        </div>
                        <div className="flex flex-shrink-0 gap-1">
                          <IconButton label="Move up" disabled={!where.up || reorder.isPending}
                            onClick={() => move(q.id, 'up')}><ChevronUp className="h-3.5 w-3.5" /></IconButton>
                          <IconButton label="Move down" disabled={!where.down || reorder.isPending}
                            onClick={() => move(q.id, 'down')}><ChevronDown className="h-3.5 w-3.5" /></IconButton>
                          <IconButton label="Edit" onClick={() => setEditing(q.id)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton label="Remove" disabled={remove.isPending} onClick={() => {
                            if (!confirm(`Remove "${q.prompt}"?`)) return;
                            remove.mutate({ questionId: q.id });
                          }}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="rounded-md border border-border bg-background p-3">
          <QuestionFields
            initial={{
              id: 0, kind: 'rating', prompt: '', help: '', required: true,
              config: { scale: 5, lowLabel: 'Poor', highLabel: 'Excellent' },
              pairKey: '', sortOrder: 0,
              section: sections[sections.length - 1]?.name ?? '',
            } as FormQuestion}
            busy={add.isPending}
            onCancel={() => setAdding(false)}
            onSave={data => add.mutate({ id: programId, stage: form.stage, data })}
          />
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />Add a question
        </Button>
      )}
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: {
  label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function TitleAndIntro({ title, intro, busy, onSave }: {
  title: string; intro: string; busy: boolean;
  onSave: (title: string, intro: string) => void;
}) {
  const [t, setT] = useState(title);
  const [i, setI] = useState(intro);
  const changed = t !== title || i !== intro;
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <label className="block text-xs text-muted-foreground">
        Title
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={t} onChange={e => setT(e.target.value)}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Introduction — what they read before the first question
        <textarea
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={i} onChange={e => setI(e.target.value)}
        />
      </label>
      {changed && (
        <Button size="sm" disabled={busy} onClick={() => onSave(t, i)}>Save the wording</Button>
      )}
    </div>
  );
}

/** The fields for one question, by kind. */
function QuestionFields({ initial, busy, onCancel, onSave }: {
  initial: FormQuestion;
  busy: boolean;
  onCancel: () => void;
  onSave: (data: FormQuestionDraft) => void;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [help, setHelp] = useState(initial.help);
  const [section, setSection] = useState(initial.section ?? '');
  const [required, setRequired] = useState(initial.required);
  const [pairKey, setPairKey] = useState(initial.pairKey ?? '');
  const [options, setOptions] = useState((initial.config?.options ?? []).join('\n'));
  const [scale, setScale] = useState(initial.config?.scale ?? 5);
  const [lowLabel, setLowLabel] = useState(initial.config?.lowLabel ?? '');
  const [highLabel, setHighLabel] = useState(initial.config?.highLabel ?? '');
  const [minLabel, setMinLabel] = useState(initial.config?.minLabel ?? '');
  const [maxLabel, setMaxLabel] = useState(initial.config?.maxLabel ?? '');
  const [wordsAtMost, setWordsAtMost] = useState(initial.config?.wordsAtMost ?? 150);
  const [wordsAtLeast, setWordsAtLeast] = useState(initial.config?.wordsAtLeast ?? 0);

  const config: FormQuestionDraft['config'] =
    kind === 'choice' || kind === 'multi'
      ? { options: options.split('\n').map(o => o.trim()).filter(Boolean) }
      : kind === 'rating'
        ? { scale: Number(scale), lowLabel, highLabel }
        : kind === 'slider'
          ? { min: 0, max: 10, step: 1, minLabel, maxLabel }
          : { wordsAtMost: Number(wordsAtMost), wordsAtLeast: Number(wordsAtLeast) };

  const field = 'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground';

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">
        The question
        <textarea rows={2} className={field} value={prompt} onChange={e => setPrompt(e.target.value)} />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          Kind
          <select className={field} value={kind} onChange={e => setKind(e.target.value as FormQuestion['kind'])}>
            <option value="rating">Rating — a few named steps</option>
            <option value="slider">Slider — drag along a line</option>
            <option value="choice">Choose one</option>
            <option value="multi">Choose several</option>
            <option value="short">Short written answer</option>
            <option value="long">Long written answer</option>
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Section
          <input className={field} value={section} onChange={e => setSection(e.target.value)} />
        </label>
      </div>

      {(kind === 'choice' || kind === 'multi') && (
        <label className="block text-xs text-muted-foreground">
          The options, one per line
          <textarea rows={4} className={field} value={options} onChange={e => setOptions(e.target.value)} />
        </label>
      )}

      {kind === 'rating' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs text-muted-foreground">
            Steps
            <input type="number" min={3} max={7} className={field} value={scale}
              onChange={e => setScale(Number(e.target.value))} />
          </label>
          <label className="block text-xs text-muted-foreground">
            The bottom means
            <input className={field} value={lowLabel} onChange={e => setLowLabel(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            The top means
            <input className={field} value={highLabel} onChange={e => setHighLabel(e.target.value)} />
          </label>
        </div>
      )}

      {kind === 'slider' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            The near end means (0)
            <input className={field} value={minLabel} onChange={e => setMinLabel(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            The far end means (10)
            <input className={field} value={maxLabel} onChange={e => setMaxLabel(e.target.value)} />
          </label>
        </div>
      )}

      {(kind === 'short' || kind === 'long') && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            At least this many words
            <input type="number" min={0} className={field} value={wordsAtLeast}
              onChange={e => setWordsAtLeast(Number(e.target.value))} />
          </label>
          <label className="block text-xs text-muted-foreground">
            At most this many words
            <input type="number" min={1} max={500} className={field} value={wordsAtMost}
              onChange={e => setWordsAtMost(Number(e.target.value))} />
          </label>
        </div>
      )}

      <label className="block text-xs text-muted-foreground">
        Help text under the question (optional)
        <input className={field} value={help} onChange={e => setHelp(e.target.value)} />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
          Must be answered
        </label>
        <label className="block text-xs text-muted-foreground">
          Pair key — the same key on both forms makes it a before-and-after
          <input className={field} value={pairKey} onChange={e => setPairKey(e.target.value)} />
        </label>
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" disabled={busy || !prompt.trim()}
          onClick={() => onSave({ kind, prompt, help, required, section, pairKey, config })}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
