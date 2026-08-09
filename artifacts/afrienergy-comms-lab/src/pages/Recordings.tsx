import { useMemo } from 'react';
import { Link } from 'wouter';
import { useListMySessions, useListMyProgress } from '@workspace/api-client-react';
import { toEmbedUrl } from '@/lib/embed';
import { PlayCircle, Video, ExternalLink, Clock } from 'lucide-react';

function formatDate(iso: string | null | undefined) {
  if (!iso) return 'Unscheduled';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Recordings library: every past session across the learner's programs, with the
 *  YouTube replay embedded when the learner attended live (server-gated). */
export default function Recordings() {
  const { data: sessions = [], isLoading } = useListMySessions();
  const { data: progress = [] } = useListMyProgress();

  const byProgram = useMemo(() => {
    const now = Date.now();
    const past = sessions.filter(s => {
      const start = s.startsAt ? new Date(s.startsAt as unknown as string).getTime() : null;
      return start !== null && now > start + s.durationMins * 60 * 1000;
    });
    const groups = new Map<number, { title: string; sessions: typeof past }>();
    for (const s of past) {
      const g = groups.get(s.programId) ?? { title: s.programTitle, sessions: [] };
      g.sessions.push(s);
      groups.set(s.programId, g);
    }
    return [...groups.entries()];
  }, [sessions]);

  return (
    <div className="container mx-auto px-4 md:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">Recordings library</h1>
        <p className="text-muted-foreground max-w-2xl">
          Rewatch the sessions you attended live. Replays stay available here for the whole program.
        </p>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map(i => <div key={i} className="aspect-video bg-card border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : byProgram.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center max-w-xl">
          <Video className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-bold mb-1">No recordings yet</h2>
          <p className="text-sm text-muted-foreground mb-4">Once your live sessions take place, their replays will collect here.</p>
          <Link href="/dashboard" className="text-sm font-semibold text-primary hover:underline">Go to my learning</Link>
        </div>
      ) : (
        <div className="space-y-12">
          {byProgram.map(([programId, group]) => (
            <section key={programId}>
              <h2 className="text-xl font-display font-bold mb-4">{group.title}</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {group.sessions.map(s => {
                  const attended = progress.find(p => p.sessionId === s.id)?.attendedLive ?? false;
                  const embed = s.recordingUrl ? toEmbedUrl(s.recordingUrl) : null;
                  return (
                    <article key={s.id} className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
                      {s.recordingUrl && embed ? (
                        embed.kind === 'iframe' ? (
                          <iframe
                            src={embed.src}
                            title={`${s.title} recording`}
                            className="w-full aspect-video bg-black"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                            allowFullScreen
                          />
                        ) : (
                          <video src={embed.src} controls className="w-full aspect-video bg-black" />
                        )
                      ) : (
                        <div className="aspect-video bg-[#07111E] text-[#F4F0E8] flex flex-col items-center justify-center text-center px-4">
                          <PlayCircle className="w-8 h-8 text-[#F4F0E8]/40 mb-2" />
                          <p className="text-xs text-[#F4F0E8]/70 max-w-[28ch]">
                            {attended
                              ? 'Recording coming soon. Your facilitator will upload it here.'
                              : 'Replays are reserved for learners who attended this session live.'}
                          </p>
                        </div>
                      )}
                      <div className="p-4 flex-1 flex flex-col">
                        <h3 className="font-semibold text-sm mb-1">{s.title}</h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />{formatDate(s.startsAt as unknown as string)} · {s.durationMins} min
                        </p>
                        {s.recordingUrl && (
                          <a
                            href={s.recordingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />Watch on YouTube
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
