import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionReadings, useSetSessionReadings,
  getGetSessionReadingsQueryKey,
} from '@workspace/api-client-react';
import { MAX_READINGS_PER_MODULE, displayHost } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, CircleAlert, ExternalLink } from 'lucide-react';

type Row = { title: string; url: string; note: string };

const emptyRow = (): Row => ({ title: '', url: '', note: '' });

/**
 * Further reading for a module, as the facilitator sees it.
 *
 * Saved as a whole list rather than row by row: the editor shows what the shelf
 * should look like, and Save makes it so. Rows that could not be saved are named
 * individually — "row 3 is not a web address" beats a single refusal that leaves
 * the facilitator hunting.
 */
export default function ReadingListEditor({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [problems, setProblems] = useState<{ index: number; message: string }[]>([]);

  const { data: readings, isLoading } = useGetSessionReadings(sessionId, {
    query: { queryKey: getGetSessionReadingsQueryKey(sessionId), retry: false },
  });

  useEffect(() => {
    if (!loaded && readings) {
      setRows(readings.length > 0 ? readings.map(r => ({ ...r })) : [emptyRow()]);
      setLoaded(true);
    }
  }, [readings, loaded]);

  const save = useSetSessionReadings({
    mutation: {
      onSuccess: (result) => {
        setProblems(result.problems ?? []);
        qc.invalidateQueries({ queryKey: getGetSessionReadingsQueryKey(sessionId) });
        if (result.problems?.length) {
          toast({
            title: 'Saved, with some rows skipped',
            description: 'The problems are listed under each row.',
          });
        } else {
          toast({ title: 'Reading list saved' });
        }
      },
      onError: () => toast({ title: 'Could not save the reading list', variant: 'destructive' }),
    },
  });

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const problemFor = (i: number) => problems.find(p => p.index === i)?.message;

  if (isLoading) return <div className="h-16 bg-muted/40 rounded-lg animate-pulse" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Reports, articles, datasets — anything worth a learner's time beyond the class. This is a shelf, not a
        hurdle: nothing here is graded, and it never affects whether someone can finish the module.
      </p>

      {rows.map((row, i) => {
        const problem = problemFor(i);
        return (
          <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-background">
            <div className="flex gap-2">
              <Input
                value={row.title}
                onChange={e => update(i, { title: e.target.value })}
                placeholder="What is it? e.g. Africa Energy Outlook 2026"
                className="text-sm"
                aria-label={`Title for reading ${i + 1}`}
              />
              <Button
                variant="ghost" size="icon"
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={() => setRows(rs => (rs.length === 1 ? [emptyRow()] : rs.filter((_, j) => j !== i)))}
                aria-label={`Remove reading ${i + 1}`}
              >
                <Trash2 className="w-4 h-4" aria-hidden />
              </Button>
            </div>

            <Input
              value={row.url}
              onChange={e => update(i, { url: e.target.value })}
              placeholder="https://..."
              className="text-sm font-mono"
              aria-label={`Link for reading ${i + 1}`}
            />

            <Input
              value={row.note}
              onChange={e => update(i, { note: e.target.value })}
              placeholder="Optional — why it is worth reading, or which part"
              className="text-sm"
              aria-label={`Note for reading ${i + 1}`}
            />

            {problem && (
              <p className="text-xs text-red-800 flex items-center gap-1.5">
                <CircleAlert className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />{problem}
              </p>
            )}
            {!problem && row.url.trim() && displayHost(row.url.trim()) && (
              <p className="text-xs text-muted-foreground">{displayHost(row.url.trim())}</p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length >= MAX_READINGS_PER_MODULE}
          onClick={() => setRows(rs => [...rs, emptyRow()])}
        >
          <Plus className="w-4 h-4 mr-1" aria-hidden />Add link
        </Button>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => { setProblems([]); save.mutate({ id: sessionId, data: { items: rows } }); }}
        >
          {save.isPending ? 'Saving...' : 'Save reading list'}
        </Button>
      </div>
    </div>
  );
}

/** Read-only rendering, shared by the learner's classroom tab. */
export function ReadingListView({ items }: { items: { title: string; url: string; note: string }[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Your facilitator has not added any further reading for this module yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i}>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="group block rounded-xl border border-border p-4 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold text-sm group-hover:text-primary transition-colors">
                  {item.title}
                </span>
                {item.note && <span className="block text-sm text-muted-foreground mt-1">{item.note}</span>}
                <span className="block text-xs text-muted-foreground mt-1.5">{displayHost(item.url)}</span>
              </span>
              <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
