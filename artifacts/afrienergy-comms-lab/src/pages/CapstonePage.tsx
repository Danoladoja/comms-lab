import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'wouter';
import {
  useGetMyCapstone, useSaveCapstoneDraft, useSubmitCapstone, useRemoveCapstoneFile,
  getGetMyCapstoneQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  capstoneSubmitProblem, listCapstoneFormats, MAX_CAPSTONE_UPLOAD_BYTES, apiReason,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CouldNotLoad } from '@/components/CouldNotLoad';
import {
  FileText, Paperclip, Send, Check, RotateCcw, Clock, Loader2, X, AlertTriangle,
} from 'lucide-react';

function words(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function when(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * The piece of work a programme ends on.
 *
 * Two things on this screen are deliberate.
 *
 * The draft saves itself. A learner writing nine hundred words in a browser tab
 * on a connection that drops is the one person this feature exists for, and
 * "you should have pressed save" is not an answer anybody accepts.
 *
 * The verdict is shown above the box, not below it. Somebody whose piece came
 * back is here to read what was wrong with it and write it again, in that
 * order, and burying the note under the thing they are rewriting means they
 * rewrite it without reading the note.
 */
export default function CapstonePage() {
  const params = useParams();
  const programId = Number(params.programId);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useGetMyCapstone(programId, {
    query: { queryKey: getGetMyCapstoneQueryKey(programId), enabled: Number.isFinite(programId) },
  });

  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedBody = data?.current?.body ?? '';

  // The box follows the server until the learner starts typing, so opening the
  // page on a second device shows what is actually saved.
  useEffect(() => { if (!touched) setBody(savedBody); }, [savedBody, touched]);

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetMyCapstoneQueryKey(programId) });

  const save = useSaveCapstoneDraft({
    mutation: {
      onSuccess: () => { setTouched(false); invalidate(); },
      onError: (err) => toast({
        title: 'Not saved',
        description: apiReason(err, 'Your work is still in the box. Try again.'),
        variant: 'destructive',
      }),
    },
  });

  const send = useSubmitCapstone({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: 'Sent', description: 'Your capstone is with the team. You will be told the outcome here.' });
      },
      onError: (err) => toast({ title: 'Not sent', description: apiReason(err, 'Try again.'), variant: 'destructive' }),
    },
  });

  const unattach = useRemoveCapstoneFile({
    mutation: { onSuccess: () => invalidate() },
  });

  /* Autosave, two seconds after they stop typing. */
  useEffect(() => {
    if (!touched || !data?.mayEdit) return;
    const t = setTimeout(() => save.mutate({ programId, data: { body } }), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, touched, data?.mayEdit]);

  async function attach(file: File) {
    if (file.size > MAX_CAPSTONE_UPLOAD_BYTES) {
      toast({
        title: 'Too large',
        description: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_CAPSTONE_UPLOAD_BYTES / 1024 / 1024}MB.`,
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/programs/${programId}/capstone/draft/file`, {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-filename': file.name,
          'x-file-type': file.type || '',
        },
        body: file,
        credentials: 'include',
      });
      if (!res.ok) {
        const said = await res.json().catch(() => ({}));
        throw new Error(said?.error ?? 'The upload was refused.');
      }
      await invalidate();
      toast({ title: 'Attached', description: file.name });
    } catch (e) {
      toast({ title: 'Not attached', description: String((e as Error).message), variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (isError) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <CouldNotLoad what="your capstone" onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isLoading) {
    return <div className="container mx-auto max-w-3xl px-4 py-16"><div className="h-64 bg-card border border-border rounded-2xl animate-pulse" /></div>;
  }
  if (!data) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-display font-bold mb-2">No capstone here</h1>
        <p className="text-sm text-muted-foreground mb-5">
          This programme has not set a capstone, or it has not been published yet.
        </p>
        <Link href="/dashboard" className="text-sm font-semibold text-primary hover:underline">Back to your dashboard</Link>
      </div>
    );
  }

  const c = data.capstone;
  const current = data.current ?? null;
  const decided = (data.history ?? []).filter((h) => h.status === 'returned' || h.status === 'approved');
  const lastVerdict = decided[0] ?? null;
  const approved = current?.status === 'approved';
  const waiting = current?.status === 'submitted';

  const problem = data.maySubmit
    ? capstoneSubmitProblem({
      body,
      wordsAtLeast: c.wordsAtLeast,
      wordsAtMost: c.wordsAtMost,
      dueAt: c.dueAt ?? null,
      nowMs: Date.now(),
      hasFile: Boolean(current?.filename),
    })
    : null;

  const count = words(body);
  const lengthNote = c.wordsAtLeast > 0 || c.wordsAtMost > 0
    ? `${count} words${c.wordsAtLeast > 0 ? ` · at least ${c.wordsAtLeast}` : ''}${c.wordsAtMost > 0 ? ` · at most ${c.wordsAtMost}` : ''}`
    : `${count} words`;

  return (
    <div className="container mx-auto max-w-3xl px-4 md:px-6 py-10">
      <div className="flex items-start gap-3 mb-2">
        <FileText className="w-5 h-5 text-primary mt-1 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Capstone</p>
          <h1 className="text-2xl md:text-3xl font-display font-bold leading-tight">{c.title}</h1>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground mt-4">{c.brief}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 text-xs text-muted-foreground">
        <span>Marked out of {c.maxScore}</span>
        {c.dueAt && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden /> Due {when(c.dueAt)}</span>}
        {(c.wordsAtLeast > 0 || c.wordsAtMost > 0) && (
          <span>{c.wordsAtLeast > 0 ? `${c.wordsAtLeast}` : '0'}–{c.wordsAtMost > 0 ? `${c.wordsAtMost}` : '∞'} words</span>
        )}
      </div>

      {/* The verdict, above the box they are about to rewrite in. */}
      {approved && (
        <div className="mt-6 border border-emerald-500/40 bg-emerald-500/[0.07] rounded-xl p-5">
          <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
            <Check className="w-4 h-4" aria-hidden /> Approved{current?.score !== null && current?.score !== undefined ? ` — ${current.score} out of ${c.maxScore}` : ''}
          </p>
          {current?.reviewNote && <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{current.reviewNote}</p>}
          <p className="text-xs text-muted-foreground mt-3">
            Your certificate is released once the closing survey is filed too.{' '}
            <Link href="/certificates" className="text-primary hover:underline">Check your certificates</Link>
          </p>
        </div>
      )}

      {waiting && (
        <div className="mt-6 border border-border bg-muted/40 rounded-xl p-5">
          <p className="flex items-center gap-2 font-bold"><Clock className="w-4 h-4 text-primary" aria-hidden /> Sent, and waiting to be read</p>
          <p className="text-sm text-muted-foreground mt-1">
            Filed {when(current?.submittedAt)}. You cannot change it while it is with the team.
          </p>
        </div>
      )}

      {!approved && !waiting && lastVerdict?.status === 'returned' && (
        <div className="mt-6 border border-amber-500/50 bg-amber-500/[0.08] rounded-xl p-5">
          <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
            <RotateCcw className="w-4 h-4" aria-hidden /> Sent back for rework
          </p>
          <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{lastVerdict.reviewNote}</p>
          <p className="text-xs text-muted-foreground mt-3">
            Attempt {lastVerdict.attempt} was read on {when(lastVerdict.reviewedAt)}. Write it again below.
          </p>
        </div>
      )}

      {/* The piece. */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <label htmlFor="capstone-body" className="text-sm font-semibold">Your piece</label>
          <span className="text-xs text-muted-foreground tabular-nums">{lengthNote}</span>
        </div>
        <Textarea
          id="capstone-body"
          value={body}
          disabled={!data.mayEdit}
          onChange={(e) => { setTouched(true); setBody(e.target.value); }}
          placeholder="Write it here, or paste it in. You can also attach a document below."
          className="min-h-[340px] leading-relaxed text-[15px]"
        />
        <p className="text-xs text-muted-foreground mt-1.5 h-4">
          {!data.mayEdit ? '' : save.isPending ? 'Saving…' : touched ? 'Unsaved changes' : current ? 'Saved' : ''}
        </p>
      </div>

      {/* The attachment. */}
      <div className="mt-5 border border-border rounded-xl p-4">
        {current?.filename ? (
          <div className="flex items-center gap-3 flex-wrap">
            <Paperclip className="w-4 h-4 text-primary shrink-0" aria-hidden />
            <a
              href={current.downloadPath ?? '#'}
              className="text-sm font-semibold text-primary hover:underline break-all"
            >
              {current.filename}
            </a>
            <span className="text-xs text-muted-foreground">
              {current.sizeBytes ? `${(current.sizeBytes / 1024).toFixed(0)} KB` : ''}
            </span>
            {data.mayEdit && (
              <button
                type="button"
                onClick={() => unattach.mutate({ programId })}
                className="ml-auto text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" aria-hidden /> Remove
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
            <span className="text-sm text-muted-foreground">
              Optional: attach the piece as a document ({listCapstoneFormats()}, up to {MAX_CAPSTONE_UPLOAD_BYTES / 1024 / 1024}MB).
            </span>
            {data.mayEdit && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.doc,.odt,.rtf,.txt,.md"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  className="ml-auto"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden /> : null}
                  {uploading ? 'Attaching…' : 'Attach a document'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Sending it. */}
      {data.maySubmit && (
        <div className="mt-6">
          <Button
            onClick={() => {
              if (touched) save.mutate({ programId, data: { body } });
              send.mutate({ programId });
            }}
            disabled={Boolean(problem) || send.isPending}
            className="h-12 px-7 font-bold"
          >
            {send.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden /> : <Send className="w-4 h-4 mr-2" aria-hidden />}
            Send it to be marked
          </Button>
          {/* The refusal is the same sentence the server would give, said before
              the button rather than after it. */}
          {problem && (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 mt-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> {problem}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Once it is sent you cannot change it until it comes back.
          </p>
        </div>
      )}

      {/* Everything that has already been decided. */}
      {decided.length > 1 && (
        <div className="mt-10 border-t border-border pt-6">
          <h2 className="text-sm font-semibold mb-3">Earlier attempts</h2>
          <ul className="space-y-3">
            {decided.slice(1).map((h) => (
              <li key={h.id} className="text-sm">
                <span className="font-semibold">Attempt {h.attempt}</span>
                <span className="text-muted-foreground"> · {h.status === 'approved' ? 'approved' : 'sent back'} on {when(h.reviewedAt)}</span>
                {h.reviewNote && <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{h.reviewNote}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
