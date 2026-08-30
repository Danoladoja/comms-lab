import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDraftCourseworkFromSlides, useGetSessionSlides, useGetSessionNotes,
  useGetCourseworkDraftHistory,
  getGetSessionSlidesQueryKey, getGetSessionNotesQueryKey, getGetCourseworkDraftHistoryQueryKey,
  type DraftQuestion,
} from '@workspace/api-client-react';
import { draftDisclaimer, MIN_USABLE_SLIDE_CHARS } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import SlideDeckPanel from '@/components/SlideDeckPanel';
import ClassMaterialPanel from '@/components/ClassMaterialPanel';
import { QuizEditor, AssignmentEditor } from '@/components/AdminCourseworkEditor';
import ReadingListEditor from '@/components/ReadingListEditor';
import { Sparkles, Loader, CircleAlert, Lightbulb, History, Scissors } from 'lucide-react';

/**
 * Everything a facilitator does to prepare one module: the material, and the
 * coursework that comes out of it.
 *
 * Drafting fills the two editors below and saves nothing. The facilitator reads,
 * corrects and saves — which matters, because a quiz key that is wrong fails
 * learners silently at 70%, and a brief nobody read wastes a cohort's week.
 * Anything the drafter had to repair, or wants a second look at, is shown rather
 * than swallowed.
 */
export default function CourseworkStudio({ sessionId }: { sessionId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [questions, setQuestions] = useState<DraftQuestion[] | undefined>();
  const [assignment, setAssignment] = useState<{ title: string; instructions: string } | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [source, setSource] = useState<{ description: string; chars: number; truncated: boolean } | null>(null);
  const [version, setVersion] = useState(0);

  const { data: deck } = useGetSessionSlides(sessionId, {
    query: { queryKey: getGetSessionSlidesQueryKey(sessionId), retry: false },
  });
  const { data: material } = useGetSessionNotes(sessionId, {
    query: { queryKey: getGetSessionNotesQueryKey(sessionId), retry: false },
  });
  const { data: history } = useGetCourseworkDraftHistory(sessionId, {
    query: { queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId), retry: false },
  });

  // Either source can carry a draft on its own, so the button is live as soon as
  // there is enough of anything to read.
  const deckChars = deck?.textChars ?? 0;
  const materialChars = material?.chars ?? 0;
  const canDraft = deckChars + materialChars >= MIN_USABLE_SLIDE_CHARS;
  const lastRun = history?.[0];

  const draft = useDraftCourseworkFromSlides({
    mutation: {
      onSuccess: (result) => {
        setQuestions(result.questions?.length ? result.questions : undefined);
        setAssignment(result.assignment ?? undefined);
        setProblems(result.problems ?? []);
        setNotes(result.notes ?? []);
        setSource(result.source ?? null);
        setVersion(v => v + 1);
        qc.invalidateQueries({ queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId) });
        toast({
          title: 'Draft ready',
          description: 'Check every answer before saving. Nothing has been saved yet.',
        });
      },
      onError: (err) => toast({
        title: 'Could not draft from this material',
        description: (err as unknown as { error?: string })?.error,
        variant: 'destructive',
      }),
    },
  });

  return (
    <div className="space-y-5 border-t border-border pt-4">
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Class material</h4>
        <SlideDeckPanel sessionId={sessionId} />
        <ClassMaterialPanel sessionId={sessionId} />
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coursework</h4>
          <Button
            size="sm"
            variant="outline"
            disabled={!canDraft || draft.isPending}
            onClick={() => draft.mutate({ id: sessionId })}
          >
            {draft.isPending
              ? <><Loader className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />Drafting…</>
              : <><Sparkles className="w-4 h-4 mr-1.5" aria-hidden />Draft the coursework</>}
          </Button>
        </div>

        {!canDraft && (
          <p className="text-xs text-muted-foreground mb-3">
            Upload a .pptx above, or paste the class transcript, and the quiz and task can be drafted from it.
            Either on its own is enough.
          </p>
        )}

        {draft.isPending && (
          <p className="text-xs text-muted-foreground mb-3">
            Reading the material and writing a draft. This takes up to a minute.
          </p>
        )}

        {lastRun && !draft.isPending && version === 0 && (
          <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1.5">
            <History className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
            <span>{lastRun.summary}</span>
          </p>
        )}

        {(version > 0 || problems.length > 0) && (
          <div className="space-y-2 mb-4">
            {version > 0 && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <CircleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
                <span>
                  {draftDisclaimer()}
                  {source && <> Read {source.description} — {source.chars.toLocaleString()} characters.</>}
                </span>
              </p>
            )}

            {source?.truncated && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Scissors className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden />
                <span>There was more material than the drafter reads in one go, so the end of it was left out.</span>
              </p>
            )}

            {problems.length > 0 && (
              <div className="text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="font-semibold text-red-900 mb-1">Repaired before showing you</p>
                <ul className="list-disc pl-4 space-y-0.5 text-red-900/90">
                  {problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {notes.length > 0 && (
              <div className="text-xs bg-muted/60 border border-border rounded-lg px-3 py-2">
                <p className="font-semibold mb-1 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" aria-hidden />Worth a second look
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                  {notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium mb-1.5">Quiz</p>
            <QuizEditor sessionId={sessionId} seed={questions} seedVersion={version} />
          </div>
          <div>
            <p className="text-xs font-medium mb-1.5">Task</p>
            <AssignmentEditor sessionId={sessionId} seed={assignment} seedVersion={version} />
          </div>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Reading list <span className="font-normal normal-case tracking-normal">— ungraded</span>
        </h4>
        <ReadingListEditor sessionId={sessionId} />
      </section>
    </div>
  );
}
