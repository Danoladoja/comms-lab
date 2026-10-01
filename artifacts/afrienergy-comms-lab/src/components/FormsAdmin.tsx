import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPrograms, getListProgramsQueryKey,
  useListProgramForms, getListProgramFormsQueryKey,
  useCreateStandardForm, useSetFormPublished,
  type ProgramFormSummary,
} from '@workspace/api-client-react';
import { apiReason } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList, CheckCircle2, AlertTriangle, Eye, EyeOff, Pencil, BarChart3 } from 'lucide-react';
import FormEditor from '@/components/FormEditor';
import FormAnalysis from '@/components/FormAnalysis';

/**
 * The two forms a programme asks, and whether they are open.
 *
 * Publishing the closing survey is the most consequential button an admin has
 * on this screen: from that moment certificates wait on it for the whole
 * cohort. So the button says what it does in those words, the form is refused
 * if it is not in a state to be filed, and the count of who has filed sits
 * beside it rather than a tab away.
 */
export default function FormsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: programmes = [], isLoading } = useListPrograms({
    query: { queryKey: getListProgramsQueryKey() },
  });
  const [programId, setProgramId] = useState<number | null>(null);
  /**
   * Which screen is showing: the two cards, one form's questions, or the
   * results. One at a time rather than three panels stacked, because editing a
   * form and reading its results are different jobs done on different days.
   */
  const [open, setOpen] = useState<{ what: 'editor'; stage: 'before' | 'after' } | { what: 'analysis' } | null>(null);

  const chosen = useMemo(() => {
    if (programId !== null) return programId;
    const live = programmes.find(p => p.status === 'published') ?? programmes[0];
    return live?.id ?? null;
  }, [programId, programmes]);

  const { data } = useListProgramForms(chosen as number, {
    query: { queryKey: getListProgramFormsQueryKey(chosen as number), enabled: chosen !== null },
  });

  const refresh = () => {
    if (chosen !== null) qc.invalidateQueries({ queryKey: getListProgramFormsQueryKey(chosen) });
  };

  const create = useCreateStandardForm({
    mutation: {
      onSuccess: () => {
        toast({
          title: 'Form created as a draft',
          description: 'Nobody can see it yet. Read it through, then publish it.',
        });
        refresh();
      },
      onError: (err) => toast({
        title: 'Could not create it',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const publish = useSetFormPublished({
    mutation: {
      onSuccess: (r) => { toast({ title: r.published ? 'Published' : 'Back to a draft', description: r.note }); refresh(); },
      onError: (err) => toast({
        title: 'Could not change it',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />;
  if (programmes.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no programmes yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-bold">Asking the cohort</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Two forms per programme. The opening assessment tells you where people are starting from
          and what they came for; the closing survey tells you what changed. The same sliders appear
          on both, which is what lets you report a movement rather than a satisfaction score.
        </p>
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Which programme?
        <select
          className="mt-1 block w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={chosen ?? ''}
          onChange={e => setProgramId(Number(e.target.value))}
        >
          {programmes.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </label>

      {data && open?.what === 'analysis' && (
        <FormAnalysis programId={chosen as number} onBack={() => setOpen(null)} />
      )}

      {data && open?.what === 'editor' && (() => {
        const form = data.forms.find(f => f.stage === open.stage);
        if (!form?.exists) return null;
        return <FormEditor programId={chosen as number} form={form} onDone={() => setOpen(null)} />;
      })()}

      {data && open === null && (
        <>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setOpen({ what: 'analysis' })}>
            <BarChart3 className="mr-1.5 h-3.5 w-3.5" aria-hidden />See what they said
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.forms.map(form => (
            <FormCard
              key={form.stage}
              form={form}
              enrolled={data.enrolled}
              busy={create.isPending || publish.isPending}
              onCreate={() => create.mutate({ id: chosen as number, stage: form.stage })}
              onEdit={() => setOpen({ what: 'editor', stage: form.stage })}
              onPublish={(published) => {
                if (published && form.stage === 'after' && !confirm(
                  'Publish the closing survey?\n\n'
                  + 'From now on every learner on this programme needs to file it before their '
                  + 'certificate is issued. They will see that on their dashboard straight away.',
                )) return;
                publish.mutate({ id: chosen as number, stage: form.stage, data: { published } });
              }}
            />
          ))}
        </div>
        </>
      )}
    </div>
  );
}

function FormCard({ form, enrolled, busy, onCreate, onPublish, onEdit }: {
  form: ProgramFormSummary;
  enrolled: number;
  busy: boolean;
  onCreate: () => void;
  onPublish: (published: boolean) => void;
  onEdit: () => void;
}) {
  const opening = form.stage === 'before';
  const name = opening ? 'Opening assessment' : 'Closing survey';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4 text-[#C2410C]" aria-hidden />{name}
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          !form.exists ? 'bg-muted text-muted-foreground'
            : form.published ? 'bg-emerald-100 text-emerald-900'
              : 'bg-amber-100 text-amber-900'
        }`}>
          {!form.exists ? 'Not set up' : form.published ? 'Open' : 'Draft'}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {opening
          ? 'Asked before the programme starts. Where they are now, and what they came for.'
          : 'Asked at the end. Compulsory — certificates wait on it once it is open.'}
      </p>

      {!form.exists ? (
        <div className="mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={onCreate}>
            Start from the Lab's standard questions
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Creates it as a draft that nobody can see, so you can read it through first.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">{form.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {form.questionCount} question{form.questionCount === 1 ? '' : 's'}
            {form.published && ` · ${form.tally}`}
          </p>

          {form.published && enrolled > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.round((form.filed / enrolled) * 100)}%` }}
              />
            </div>
          )}

          {form.problem && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {form.problem}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />Edit the questions
            </Button>
            {form.published ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onPublish(false)}
              >
                <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />Take it back to a draft
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !!form.problem}
                onClick={() => onPublish(true)}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {opening ? 'Open it to the cohort' : 'Open it — certificates will wait on it'}
              </Button>
            )}
          </div>

          {form.published && form.filed === enrolled && enrolled > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Everyone has filed it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
