import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSessionSlides, useDeleteSessionSlides, useSetSlidesVisibility,
  getGetSessionSlidesQueryKey,
} from '@workspace/api-client-react';
import { MAX_SLIDE_UPLOAD_BYTES } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Trash2, Eye, EyeOff, CircleAlert, Loader } from 'lucide-react';

/**
 * The facilitator's slide deck for one module.
 *
 * Uploading it does two jobs: learners get something to read alongside the
 * recording, and the coursework drafter gets something to work from. The panel
 * says which of those a given file can actually do — a PDF is perfectly good
 * reading material and useless for drafting, and that is worth knowing before
 * someone clicks Draft and waits.
 */

const ACCEPT = '.pptx,.pdf,.txt,.md';

function prettySize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SlideDeckPanel({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: deck, isLoading } = useGetSessionSlides(sessionId, {
    query: { queryKey: getGetSessionSlidesQueryKey(sessionId), retry: false },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: getGetSessionSlidesQueryKey(sessionId) });

  const remove = useDeleteSessionSlides({
    mutation: {
      onSuccess: () => { toast({ title: 'Slides removed' }); refresh(); },
      onError: () => toast({ title: 'Could not remove the slides', variant: 'destructive' }),
    },
  });

  const setVisibility = useSetSlidesVisibility({
    mutation: {
      onSuccess: () => refresh(),
      onError: () => toast({ title: 'Could not change who can see the slides', variant: 'destructive' }),
    },
  });

  // Sent as raw bytes rather than a form, which is what the endpoint expects.
  const upload = async (file: File) => {
    if (file.size > MAX_SLIDE_UPLOAD_BYTES) {
      toast({
        title: 'That file is too large',
        description: `Keep it under ${Math.round(MAX_SLIDE_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        variant: 'destructive',
      });
      return;
    }
    setUploading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${base}/api/sessions/${sessionId}/slides`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': file.name,
          'x-file-type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(body.error ?? 'Upload failed');
      }
      toast({ title: 'Slides uploaded' });
      refresh();
    } catch (err) {
      toast({
        title: 'Could not upload the slides',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (isLoading) return <div className="h-20 bg-muted/40 rounded-lg animate-pulse" />;

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />

      {!deck ? (
        <div className="border border-dashed border-border rounded-lg p-5 text-center">
          <FileText className="w-7 h-7 text-muted-foreground mx-auto mb-2" aria-hidden />
          <p className="text-sm font-medium mb-1">No slides yet</p>
          <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
            Upload the deck and learners can read it alongside the recording. A <strong>.pptx</strong> can also be
            used to draft the quiz and task — export from Google Slides or PowerPoint.
          </p>
          <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading
              ? <><Loader className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />Uploading…</>
              : <><Upload className="w-4 h-4 mr-1.5" aria-hidden />Upload slides</>}
          </Button>
        </div>
      ) : (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{deck.filename}</p>
              <p className="text-xs text-muted-foreground">
                {prettySize(deck.sizeBytes)}
                {deck.hasReadableText && ` · ${deck.textChars.toLocaleString()} characters of text`}
              </p>
            </div>
            <Button
              variant="ghost" size="icon"
              className="text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => { if (confirm('Remove these slides?')) remove.mutate({ id: sessionId }); }}
              aria-label="Remove slides"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </Button>
          </div>

          {!deck.canDraft && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <CircleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
              <span>
                {deck.hasReadableText
                  ? 'There is too little text here to draft coursework from — mostly headings and images. Learners can still read it.'
                  : 'No text could be read from this file, so it cannot be used for drafting. Learners can still read it. Upload the .pptx to enable drafting.'}
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${deck.downloadPath}`} target="_blank" rel="noreferrer">
                <FileText className="w-4 h-4 mr-1.5" aria-hidden />Open
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={setVisibility.isPending}
              onClick={() => setVisibility.mutate({
                id: sessionId,
                data: { visibleToLearners: !deck.visibleToLearners },
              })}
            >
              {deck.visibleToLearners
                ? <><Eye className="w-4 h-4 mr-1.5" aria-hidden />Learners can see this</>
                : <><EyeOff className="w-4 h-4 mr-1.5" aria-hidden />Hidden from learners</>}
            </Button>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Replace'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
