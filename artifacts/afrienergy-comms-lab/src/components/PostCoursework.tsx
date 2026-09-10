import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCourseworkPostState, usePostCoursework,
  getGetCourseworkPostStateQueryKey, getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey,
  getGetSessionReadingsQueryKey, getGetSessionSlidesQueryKey,
} from '@workspace/api-client-react';
import { apiReason } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Send, Loader, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

/**
 * Posting a module's coursework to the cohort.
 *
 * Saving used to be publishing: questions appeared on every learner's dashboard
 * the moment they were saved, half-written. Now a new quiz or task is private
 * until this button is pressed, and this button is the only thing in the Lab
 * that emails a cohort about coursework.
 *
 * All four pieces — quiz, task, slides, reading list — go in one press and one
 * letter. From a learner's side this is one event, "this week's module is up",
 * and somebody who receives four emails a minute apart about one class learns
 * to ignore all four.
 *
 * There is no unpost. An email cannot be recalled, so a button claiming to take
 * it back would be lying to the person pressing it — coursework that went out
 * too early is fixed by editing it, which nobody is prevented from doing.
 */
export default function PostCoursework({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: state } = useGetCourseworkPostState(sessionId, {
    query: { queryKey: getGetCourseworkPostStateQueryKey(sessionId), retry: false },
  });

  const post = usePostCoursework({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: result.posted.length > 1 ? 'Posted — it is all live' : 'Posted to the cohort',
          description: !result.mailConfigured
            ? 'It is live on their dashboards. No mail provider is set up, so nobody was emailed.'
            : result.emailed === 0
              ? 'It is live on their dashboards. Nobody is enrolled yet, so no email went out.'
              : `${result.emailed} learner${result.emailed === 1 ? '' : 's'} emailed`
                + (result.failed > 0 ? `, ${result.failed} could not be reached.` : '.'),
          variant: result.failed > 0 ? 'destructive' : undefined,
        });
        qc.invalidateQueries({ queryKey: getGetCourseworkPostStateQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetSessionQuizQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetSessionAssignmentQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetSessionReadingsQueryKey(sessionId) });
        qc.invalidateQueries({ queryKey: getGetSessionSlidesQueryKey(sessionId) });
      },
      onError: (err) => toast({
        title: 'Nothing was posted',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  if (!state) return null;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      state.canPost ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20'
    }`}>
      <p className="flex items-start gap-2 text-xs">
        {state.canPost
          ? <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          : <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className={state.canPost ? 'font-medium' : 'text-muted-foreground'}>{state.summary}</span>
      </p>

      {state.canPost && (
        <Button
          size="sm"
          className="mt-2.5"
          disabled={post.isPending}
          onClick={() => {
            // The one confirmation in the studio, because this is the one
            // action here that reaches other people and cannot be undone.
            if (!confirm(`${state.summary}\n\nPost it now?`)) return;
            post.mutate({ id: sessionId });
          }}
        >
          {post.isPending
            ? <><Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Posting…</>
            : <><Send className="mr-1.5 h-4 w-4" aria-hidden />Post to the cohort</>}
        </Button>
      )}

      {!state.canPost && state.quizPostedAt && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          Posted {new Date(state.quizPostedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.
          Edits from here on do not send another email.
        </p>
      )}
    </div>
  );
}
