import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionNotes, useSetSessionNotes, getGetSessionNotesQueryKey,
} from '@workspace/api-client-react';
import { NOTES_LABELS, MAX_NOTES_CHARS, DEFAULT_NOTES_LABEL } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';

/**
 * Anything the facilitator wants the drafter to read beyond the deck — almost
 * always the transcript of the class, copied out of the recording on YouTube.
 *
 * This is the box that makes drafting worth using. A deck is headings and a
 * chart; the class is where someone explains why the tariff reform stalled, and
 * a quiz written from that is a quiz about the class rather than about the
 * slides. It also rescues the facilitator who never made a deck at all.
 *
 * Collapsed by default, because a pasted transcript is thousands of lines and
 * nobody wants to scroll past it to reach the quiz.
 */
export default function ClassMaterialPanel({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  const { data: notes } = useGetSessionNotes(sessionId, {
    query: { queryKey: getGetSessionNotesQueryKey(sessionId), retry: false },
  });

  // Once loaded, the box shows what is saved until the facilitator types.
  useEffect(() => {
    if (notes && body === null) {
      setBody(notes.body);
      setLabel(notes.label);
    }
  }, [notes, body]);

  const save = useSetSessionNotes({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSessionNotesQueryKey(sessionId) });
        toast({ title: 'Class material saved' });
      },
      onError: () => toast({ title: 'Could not save the class material', variant: 'destructive' }),
    },
  });

  const value = body ?? notes?.body ?? '';
  const chosenLabel = label ?? notes?.label ?? DEFAULT_NOTES_LABEL;
  const savedChars = notes?.chars ?? 0;
  const dirty = value !== (notes?.body ?? '') || chosenLabel !== (notes?.label ?? DEFAULT_NOTES_LABEL);

  return (
    <div className="border border-border rounded-lg bg-background">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          {open
            ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" aria-hidden />}
          <span className="text-sm font-medium truncate">
            {chosenLabel}
            {savedChars > 0 && (
              <span className="font-normal text-muted-foreground"> — {savedChars.toLocaleString()} characters saved</span>
            )}
          </span>
        </span>
        {savedChars === 0 && (
          <span className="text-xs text-muted-foreground flex-shrink-0">Optional, but it makes drafts far better</span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Paste the transcript of the class here. On YouTube, open the recording, click the three dots
            under the video, choose <span className="font-medium">Show transcript</span>, then copy and paste
            the whole thing. The drafter reads this alongside your slides and prefers it — it is where the
            teaching actually is.
          </p>

          <div className="flex items-center gap-2">
            <label htmlFor={`material-label-${sessionId}`} className="text-xs text-muted-foreground">
              This is a
            </label>
            <select
              id={`material-label-${sessionId}`}
              value={chosenLabel}
              onChange={e => setLabel(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-1 bg-background"
            >
              {NOTES_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <Textarea
            value={value}
            onChange={e => setBody(e.target.value.slice(0, MAX_NOTES_CHARS))}
            rows={8}
            className="text-sm font-mono"
            placeholder="Paste here…"
            aria-label="Class material"
          />

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Lock className="w-3 h-3 flex-shrink-0" aria-hidden />
            Only you and the admin can see this. Learners never do.
          </p>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={save.isPending || !dirty}
              onClick={() => save.mutate({ id: sessionId, data: { label: chosenLabel, body: value } })}
            >
              {save.isPending ? 'Saving…' : 'Save class material'}
            </Button>
            {value.length > 0 && (
              <span className="text-xs text-muted-foreground">{value.length.toLocaleString()} characters</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
