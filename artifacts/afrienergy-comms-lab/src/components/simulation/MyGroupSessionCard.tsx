import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useGetMyGroupSession, getGetMyGroupSessionQueryKey } from '@workspace/api-client-react';
import { Users, Clock, DoorOpen, FileText } from 'lucide-react';

/**
 * The only thing that tells a learner their cohort has a group session.
 *
 * A group session has no join code and sends no invitation: the cohort is the
 * room. That is the right design and it left a hole — the timer was putting
 * people into teams at three o'clock and nobody had any way to find out. This
 * card is the way.
 *
 * It says very little before the session starts, on purpose. Not the crisis,
 * not the teams, not what it is testing. A cohort that reads the brief the
 * night before is being tested on preparation, which is a different exercise
 * and one they can already practise on their own.
 *
 * It refreshes on a slow loop rather than waiting to be reloaded, because the
 * moment that matters — the door opening — happens on the server's clock while
 * this page is already sitting open.
 */
export default function MyGroupSessionCard() {
  const [, navigate] = useLocation();
  const { data: session, isLoading } = useGetMyGroupSession({
    query: {
      queryKey: getGetMyGroupSessionQueryKey(),
      /*
       * Fast while it is about to open or already running, slow otherwise.
       * Waiting for a session that starts tomorrow does not need a request
       * every fifteen seconds, and a learner staring at the screen at 14:59
       * should not have to reload to get in.
       */
      refetchInterval: (query) => {
        const data = query.state.data as { state?: string } | undefined;
        if (!data) return 60_000;
        if (data.state === 'finished') return false;
        return data.state === 'live' ? 15_000 : 60_000;
      },
      // The door opens on the server's clock whether this tab is the one being
      // looked at or not, and a learner waiting for it is very likely reading
      // something else while they wait.
      refetchIntervalInBackground: true,
    },
  });

  if (isLoading || !session?.hasSession) return null;

  const finished = session.state === 'finished';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-10 border p-6 ${
        session.mayEnter
          ? 'border-emerald-400/40 bg-emerald-400/[0.06]'
          : 'border-white/15 bg-white/[0.03]'
      }`}
    >
      <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-300 mb-3">
        <Users className="w-3.5 h-3.5" aria-hidden />
        Your cohort · group exercise
      </p>

      <h3 className="text-lg font-bold text-white mb-2">{session.title || 'A group exercise'}</h3>

      {/* One sentence, written on the server so it is true at every point on the
          clock — including the minute before it opens, when there is no team to
          name yet. */}
      <p className="text-sm text-white/75 leading-relaxed mb-5">{session.note}</p>

      {session.mayEnter && session.runId ? (
        <div>
          <button
            type="button"
            onClick={() => navigate(`/studio/run/${session.runId}`)}
            className="inline-flex items-center gap-2 bg-emerald-400 text-[#030811] px-6 py-3 text-[11px] font-bold uppercase tracking-widest"
          >
            <DoorOpen className="w-4 h-4" aria-hidden />Go in
          </button>
          {/* Said plainly, because it is the thing that makes the exercise what
              it is. Nobody is at the front of this room. */}
          <p className="mt-3 text-xs text-white/50">
            Nobody is running this one. The story moves on the clock whether your team has answered
            or not, and it ends itself.
          </p>
        </div>
      ) : finished && session.runId ? (
        <button
          type="button"
          onClick={() => navigate(`/studio/run/${session.runId}`)}
          className="inline-flex items-center gap-2 border border-white/20 text-white px-6 py-3 text-[11px] font-bold uppercase tracking-widest hover:bg-white/5"
        >
          <FileText className="w-4 h-4" aria-hidden />Read your team's debrief
        </button>
      ) : (
        <p className="flex items-center gap-2 text-xs text-white/40">
          <Clock className="w-3.5 h-3.5" aria-hidden />
          The door opens by itself. Nothing to accept, nothing to type.
        </p>
      )}
    </motion.div>
  );
}
