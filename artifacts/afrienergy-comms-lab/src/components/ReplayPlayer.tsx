import { toEmbedUrl } from '@workspace/domain';

/**
 * A recording, playing where it was opened.
 *
 * Deliberately not the learner's player: this one counts nothing. Staff check a
 * recording to see that the right hour ended up in the right module and that it
 * is not silent for the first four minutes, and none of that should be recorded
 * against anybody's progress.
 *
 * What it does share with the learner's player is the only rule that matters
 * here — that the video stays inside the Lab. Sending anyone out to YouTube to
 * check a link means leaving the console, losing the list they were working
 * through, and coming back to find their place again.
 */
export default function ReplayPlayer({ recordingUrl, title }: {
  recordingUrl: string;
  title: string;
}) {
  const embed = toEmbedUrl(recordingUrl);

  if (!embed) {
    // Nothing recognises this link, so there is nothing to play. Saying so is
    // more use than a player that shows a grey square.
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        This link is not one the Lab can play — it is not YouTube, Vimeo, Loom or a video file. Learners will not
        be able to watch it either, so it is worth replacing with an unlisted YouTube link.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[#07111E]">
      {embed.kind === 'iframe' ? (
        <iframe
          src={embed.src}
          title={title}
          className="w-full aspect-video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <video src={embed.src} controls className="w-full aspect-video" title={title} />
      )}
    </div>
  );
}
