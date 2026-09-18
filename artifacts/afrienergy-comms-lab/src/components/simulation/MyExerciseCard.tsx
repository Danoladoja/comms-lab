import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import {
  useGetMyStudioExercise,
  useBeginStudioExercise,
  type MyStudioExercise,
} from '@workspace/api-client-react';
import { apiReason, timeLeftNote, opensInNote } from '@workspace/domain';
import { formatDeadline as when } from '@/lib/dueDateText';
import { useToast } from '@/hooks/use-toast';
import { Target, Play, RotateCcw, CheckCircle2, Clock } from 'lucide-react';

/**
 * The invited learner's whole Studio, in one card.
 *
 * What it replaces: a form asking for a subject, an objective, a perspective, a
 * difficulty and a length. Five decisions put to the person least placed to
 * make them — a learner cannot know what they should be practising better than
 * the programme that is teaching them — and each submission a model call. Some
 * of the money went on exercises aimed at nothing in particular.
 *
 * So the objective arrives from the programme and the situation from the
 * invitation, and there is one button. What the learner still chooses is the
 * only thing that was ever theirs to choose: when to start.
 */
export default function MyExerciseCard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: exercise, isLoading } = useGetMyStudioExercise();

  const begin = useBeginStudioExercise({
    mutation: {
      onSuccess: (r) => navigate(`/studio/run/${r.runId}`),
      onError: (err) => toast({
        title: 'Could not start the exercise',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  if (isLoading) return <div className="mb-8 h-64 animate-pulse bg-white/[0.03] border border-white/10" />;

  /*
   * On a cohort, nothing sent yet.
   *
   * Their exercises come from the programme, so there is no form for them — and
   * without this line the Studio is simply blank, which reads as broken rather
   * than as waiting. It says who sends them, so there is somebody to ask.
   */
  if (!exercise?.hasInvitation) {
    if (!exercise?.awaiting) return null;
    return (
      <div className="mb-10 border border-white/15 bg-white/[0.03] p-6">
        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">Your exercise</p>
        <p className="text-sm text-white/75 leading-relaxed">
          Nothing to set up here — your exercises come from your programme, and your facilitator
          sends them. When one arrives it will be on this page, with the situation and what it is
          testing already written.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-10 border border-[#f97316]/30 bg-[#f97316]/[0.04] p-6"
    >
      <p className="text-[10px] uppercase tracking-widest text-[#f97316] mb-4">
        Your exercise
        {exercise.moduleTitle ? ` · ${exercise.moduleTitle}` : ''}
      </p>

      <Section icon={<Target className="w-4 h-4" aria-hidden />} label="What you are practising">
        {exercise.objective}
      </Section>

      {/* The situation, said plainly before they commit. Not a surprise: an
          exercise you cannot leave is one you should be able to see the shape
          of first. */}
      <Section icon={<Clock className="w-4 h-4" aria-hidden />} label="The situation you are given">
        {exercise.situation}
      </Section>

      <p className="text-xs text-white/40 mb-6">
        {exercise.durationMinutes} minutes · {exercise.difficulty} · everyone on your cohort is
        practising the same thing in a different crisis.
      </p>

      {/*
        The deadline, said to the person it applies to.

        An invitation can now be given a day and an hour after which it stops
        working. Told to nobody, that is not a deadline — it is an invitation
        that dies for no visible reason, and a learner who opens the Studio on
        Saturday to find Friday's exercise gone has been caught out rather than
        held to anything.
      */}
      {exercise.state === 'not-yet-open' && exercise.opensAt && (
        <p className="flex items-start gap-2 text-xs text-white/60 mb-6">
          <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
          <span>
            {opensInNote(exercise.opensAt as unknown as string, Date.now())}
            {' '}You can start it from{' '}
            {when(exercise.opensAt as unknown as string)}.
          </span>
        </p>
      )}

      {exercise.expiresAt && exercise.state === 'ready' && (
        <p className="flex items-start gap-2 text-xs text-amber-200/80 mb-6">
          <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
          <span>
            {timeLeftNote(exercise.expiresAt as unknown as string, Date.now())}
            {' '}Use it by{' '}
            {when(exercise.expiresAt as unknown as string)}.
          </span>
        </p>
      )}

      <Action exercise={exercise} pending={begin.isPending} onBegin={() => begin.mutate()} onResume={
        () => exercise.runId && navigate(`/studio/run/${exercise.runId}`)
      } />
    </motion.div>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40 mb-1.5">
        <span className="text-[#f97316]">{icon}</span>{label}
      </p>
      <p className="text-sm text-white/85 leading-relaxed">{children}</p>
    </div>
  );
}

function Action({ exercise, pending, onBegin, onResume }: {
  exercise: MyStudioExercise;
  pending: boolean;
  onBegin: () => void;
  onResume: () => void;
}) {
  if (exercise.state === 'in-progress') {
    return (
      <div>
        <button
          type="button"
          onClick={onResume}
          className="inline-flex items-center gap-2 bg-[#f97316] text-[#030811] px-6 py-3 text-[11px] font-bold uppercase tracking-widest"
        >
          <RotateCcw className="w-4 h-4" aria-hidden />Back to your exercise
        </button>
        {/* The sentence that makes "you cannot leave" fair rather than
            punitive: nothing was lost by the tab closing, and nothing is
            gained by closing it. */}
        <p className="mt-3 text-xs text-white/50">
          You are already in this one. Your answers are saved and the clock has been running since
          you started — closing the page did not lose anything, and it did not stop anything either.
        </p>
      </div>
    );
  }

  if (exercise.state === 'spent') {
    return (
      <p className="flex items-start gap-2 text-sm text-white/60">
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 flex-shrink-0" aria-hidden />
        {exercise.problem}
      </p>
    );
  }

  if (exercise.state === 'expired') {
    return <p className="text-sm text-amber-300/80">{exercise.problem}</p>;
  }

  // Not open yet: the button would only refuse, and a button that refuses
  // teaches somebody the Studio is broken rather than that they are early.
  if (exercise.state === 'not-yet-open') {
    return (
      <p className="text-sm text-white/60">
        Nothing to do yet — it opens on its own, and this page will show the button when it does.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={onBegin}
        className="inline-flex items-center gap-2 bg-[#f97316] text-[#030811] px-6 py-3 text-[11px] font-bold uppercase tracking-widest disabled:opacity-60"
      >
        <Play className="w-4 h-4" aria-hidden />
        {pending ? 'Writing your exercise…' : 'Begin'}
      </button>
      {/* Said before the button is pressed, not after. The one-way door is the
          point of the exercise, and somebody who discovers it afterwards has
          been tricked rather than tested. */}
      <p className="mt-3 text-xs text-white/50">
        The clock starts when you press this, and runs whether the page is open or not. You get one
        attempt, so start when you have {exercise.durationMinutes} clear minutes.
      </p>
    </div>
  );
}
