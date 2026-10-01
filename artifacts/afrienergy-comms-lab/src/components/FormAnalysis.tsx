import { useState } from 'react';
import {
  useGetFormAnalysis, getGetFormAnalysisQueryKey,
  type AnalysedQuestion, type PairedMovement, type QuestionSummary,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CouldNotLoad } from '@/components/CouldNotLoad';
import { ArrowUpRight, ArrowDownRight, Minus, Copy, FileText } from 'lucide-react';

/**
 * What the cohort said, and what changed between the two ends.
 *
 * The movement table is first and everything else is below it, because the
 * before-and-after is the only part that answers "did this work". The rest
 * answers "what did they think", which matters but is a different question and
 * a weaker claim.
 *
 * Every figure carries the number of answers behind it, and a movement built on
 * fewer than five answers either side says so on the figure itself. That
 * sentence travels from the server rather than being assembled here, so the
 * number somebody copies into a funder's report arrives with its own caveat
 * attached.
 */
export default function FormAnalysis({ programId, onBack }: {
  programId: number;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [showing, setShowing] = useState<'before' | 'after'>('after');

  const { data, isLoading, isError, refetch } = useGetFormAnalysis(programId, {
    query: { queryKey: getGetFormAnalysisQueryKey(programId) },
  });

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />;
  if (isError || !data) return <CouldNotLoad what="this programme's survey results" onRetry={() => refetch()} />;

  const stage = data.stages.find(s => s.stage === showing);
  const bySection = new Map<string, AnalysedQuestion[]>();
  for (const q of (stage?.questions ?? [])) {
    const list = bySection.get(q.section) ?? [];
    list.push(q);
    bySection.set(q.section, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold">What the cohort said</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.enrolled} enrolled ·{' '}
            {data.stages.map(s => `${s.filed} filed the ${s.stage === 'before' ? 'opening' : 'closing'} form`).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(data.report);
              toast({ title: 'Copied', description: 'Paste it straight into a report.' });
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />Copy the write-up
          </Button>
          <Button size="sm" variant="outline" onClick={onBack}>Back</Button>
        </div>
      </div>

      {/* The part that answers "did this work". */}
      <section>
        <h4 className="text-sm font-semibold">What changed, start to finish</h4>
        {data.pairs.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No question is asked at both ends yet. Give a question on each form the same pair key
            and its movement will appear here.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.pairs.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </ul>
        )}
      </section>

      {/* Everything else, one form at a time. */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Every question</h4>
          <div className="flex gap-1">
            {(['before', 'after'] as const).map(which => (
              <button
                key={which}
                type="button"
                onClick={() => setShowing(which)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  showing === which
                    ? 'border-[#C2410C] bg-[#C2410C] text-white'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {which === 'before' ? 'Opening' : 'Closing'}
              </button>
            ))}
          </div>
        </div>

        {stage && stage.filed === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nobody has filed this one yet.</p>
        ) : (
          <div className="mt-3 space-y-5">
            {[...bySection.entries()].map(([section, questions]) => (
              <div key={section}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
                  {section || 'Questions'}
                </p>
                <ul className="space-y-3">
                  {questions.map(q => <QuestionRow key={q.id} question={q} />)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PairRow({ pair }: { pair: PairedMovement }) {
  const change = pair.movement?.change ?? 0;
  const thin = pair.note.includes('too few');
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const tone = thin
    ? 'text-amber-800'
    : change > 0 ? 'text-emerald-700' : change < 0 ? 'text-rose-700' : 'text-muted-foreground';

  return (
    <li className="rounded-md border border-border bg-background p-3">
      <p className="text-sm">{pair.prompt}</p>
      <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${tone}`}>
        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        {pair.note}
      </p>
    </li>
  );
}

function QuestionRow({ question }: { question: AnalysedQuestion }) {
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <p className="text-sm">{question.prompt}</p>
      <Summary summary={question.summary} />
    </li>
  );
}

function Summary({ summary }: { summary: QuestionSummary }) {
  if (summary.count === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">Nobody answered this one.</p>;
  }

  if (summary.shape === 'numeric') {
    const top = Math.max(...(summary.spread ?? []).map(s => s.count), 1);
    return (
      <div className="mt-1.5">
        <p className="text-xs text-muted-foreground">
          Average <span className="font-semibold text-foreground">{summary.mean}</span>
          {' · '}lowest {summary.lowest}, highest {summary.highest}
          {' · '}{summary.count} answer{summary.count === 1 ? '' : 's'}
        </p>
        {/* The spread beside the mean, because "mean 5" from a cohort split
            between 0 and 10 is not a cohort that said 5. */}
        <div className="mt-1.5 flex items-end gap-0.5" aria-hidden>
          {(summary.spread ?? []).map(s => (
            <div key={s.value} className="flex flex-1 flex-col items-center gap-0.5">
              <div
                className="w-full rounded-sm bg-[#C2410C]/70"
                style={{ height: `${Math.max(3, (s.count / top) * 36)}px` }}
                title={`${s.count} chose ${s.value}`}
              />
              <span className="text-[10px] text-muted-foreground">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (summary.shape === 'tally') {
    return (
      <ul className="mt-1.5 space-y-1">
        {(summary.options ?? []).map(o => (
          <li key={o.option} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span>{o.option}</span>
              <span className="flex-shrink-0 text-muted-foreground">{o.count} · {o.pct}%</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-[#C2410C]/70" style={{ width: `${o.pct}%` }} />
            </div>
          </li>
        ))}
        <li className="text-[11px] text-muted-foreground">
          Of the {summary.count} who answered.
        </li>
      </ul>
    );
  }

  return (
    <div className="mt-1.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden />
        {summary.count} wrote something · typically {summary.medianWords} words
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {(summary.answers ?? []).map((answer, i) => (
          <li key={i} className="rounded border border-border/60 bg-muted/20 p-2 text-xs">
            {answer}
          </li>
        ))}
      </ul>
    </div>
  );
}
