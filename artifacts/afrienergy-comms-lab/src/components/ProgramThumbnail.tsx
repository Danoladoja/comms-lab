import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
  ACCEPTED_IMAGE_LABEL,
  ACCEPTED_IMAGE_MIME,
  MAX_THUMBNAIL_BYTES,
  checkThumbnail,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';

/**
 * Choosing the picture that fronts a programme in the catalogue.
 *
 * The file is checked in the browser before it is sent — the same function the
 * server uses, reading the same leading bytes. Not as a security measure: the
 * server checks again and only the server's answer counts. It is so somebody
 * who picks the wrong file is told in the moment rather than after waiting for
 * three megabytes to cross a Lagos mobile connection.
 *
 * Existing images are shown by URL rather than re-fetched as bytes, so opening
 * the editor on a programme that already has a picture costs one cached image
 * request and nothing else.
 */

type Props = {
  /** Null while a programme is still being created and has no id yet. */
  programId: number | null;
  thumbnailUrl: string | null | undefined;
  onChanged: (thumbnailUrl: string | null) => void;
};

export function ProgramThumbnail({ programId, thumbnailUrl, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Shown the instant a file is picked, so the image does not appear to lag. */
  const [preview, setPreview] = useState<string | null>(null);

  const shown = preview ?? thumbnailUrl ?? null;

  async function upload(file: File) {
    setProblem(null);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkThumbnail(bytes);
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }

    setBusy(true);
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);

    try {
      const res = await fetch(`/api/programs/${programId}/thumbnail`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': file.name.slice(0, 200),
        },
        body: bytes,
        credentials: 'include',
      });

      if (!res.ok) {
        // The server says `message` when it knows what went wrong and `error`
        // when something failed unexpectedly. Reading only the first left an
        // admin staring at "try again" while the real cause sat in the other
        // field.
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        setProblem(body?.message ?? body?.error ?? 'That image could not be saved. Try again.');
        setPreview(null);
        URL.revokeObjectURL(localPreview);
        return;
      }

      const program = (await res.json()) as { thumbnailUrl?: string | null };
      // Hand back the server's URL and drop the local preview: from here the
      // real image is what everything else in the app will be showing.
      onChanged(program.thumbnailUrl ?? null);
      setPreview(null);
      URL.revokeObjectURL(localPreview);
    } catch {
      setProblem('That image could not be saved. Check your connection and try again.');
      setPreview(null);
      URL.revokeObjectURL(localPreview);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    setProblem(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/programs/${programId}/thumbnail`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setProblem('That image could not be removed. Try again.');
        return;
      }
      onChanged(null);
    } catch {
      setProblem('That image could not be removed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (programId === null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-medium text-foreground">Thumbnail</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create the draft first, then add a picture from the Edit button. A programme needs to exist
          before an image can be attached to it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium text-foreground">Thumbnail</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Shown on the programme card in the catalogue. {ACCEPTED_IMAGE_LABEL}, up to{' '}
        {(MAX_THUMBNAIL_BYTES / 1024 / 1024).toFixed(0)}MB. A wide picture works best.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="h-24 w-40 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImagePlus className="h-6 w-6" aria-hidden />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIME}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {shown ? 'Replace image' : 'Upload image'}
          </Button>

          {shown && !busy && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-3 text-xs font-medium text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

export default ProgramThumbnail;
