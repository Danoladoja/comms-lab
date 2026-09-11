import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDraftCourseworkFromSlides, useGetSessionSlides, useGetSessionNotes,
  useGetCourseworkDraftHistory, useGetSessionQuiz, useGetSessionAssignment, useGetCourseworkPostState,
  useGetSessionReadings, getGetSessionReadingsQueryKey,
  getGetSessionSlidesQueryKey, getGetSessionNotesQueryKey, getGetCourseworkDraftHistoryQueryKey,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey, getGetCourseworkPostStateQueryKey,
  type DraftQuestion,
} from '@workspace/api-client-react';
import { draftDisclaimer, MIN_USABLE_SLIDE_CHARS, apiReason } from '@workspace/domain';
import { deadlineSummary } from '@/lib/dueDateText';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import SlideDeckPanel from '@/components/SlideDeckPanel';
import ClassMaterialPanel from '@/components/ClassMaterialPanel';
import { QuizEditor, AssignmentEditor } from '@/components/AdminCourseworkEditor';
import PostCoursework from '@/components/PostCoursework';
import ReadingListEditor from '@/components/ReadingListEditor';
import { EditorSection } from '@/components/EditorSection';
import WorkAndCritiques from '@/components/WorkAndCritiques';
import { Sparkles, Loader, CircleAlert, Lightbulb, History, Scissors, X } from 'lucide-react';


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
export default function CourseworkStudio({ sessionId, onClose }: {
  sessionId: number;
  /**
   * Shut the whole panel.
   *
   * The only way out used to be the button that opened it, which by the time
   * you had scrolled through the slides, the transcript, four editors and the
   * reading list was a long way back up the page — so the panel simply stayed
   * open, on every module, all day.
   */
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [questions, setQuestions] = useState<DraftQuestion[] | undefined>();
  const [assignment, setAssignment] = useState<{ title: string; instructions: string } | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [source, setSource] = useState<{ description: string; chars: number; truncated: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [openEditor, setOpenEditor] = useState<'quiz' | 'task' | 'reading' | 'work' | null>(null);

  const { data: deck } = useGetSessionSlides(sessionId, {
    query: { queryKey: getGetSessionSlidesQueryKey(sessionId), retry: false },
  });
  const { data: material } = useGetSessionNotes(sessionId, {
    query: { queryKey: getGetSessionNotesQueryKey(sessionId), retry: false },
  });
  const { data: history } = useGetCourseworkDraftHistory(sessionId, {
    query: { queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId), retry: false },
  });
  // The same query keys the two editors use, so this shares their cache rather
  // than asking twice. It is what lets a shut drawer still say what is inside.
  const { data: savedQuiz } = useGetSessionQuiz(sessionId, {
    query: { queryKey: getGetSessionQuizQueryKey(sessionId), retry: false },
  });
  const { data: savedTask } = useGetSessionAssignment(sessionId, {
    query: { queryKey: getGetSessionAssignmentQueryKey(sessionId), retry: false },
  });
  // Shares its cache with the Post notice below, so this costs nothing extra.
  const { data: postState } = useGetCourseworkPostState(sessionId, {
    query: { queryKey: getGetCourseworkPostStateQueryKey(sessionId), retry: false },
  });
  const { data: savedReadings } = useGetSessionReadings(sessionId, {
    query: { queryKey: getGetSessionReadingsQueryKey(sessionId), retry: false },
  });

  const count = savedQuiz?.questions.length ?? 0;
  // "Draft" comes first because it is the fact that changes what the facilitator
  // should do next: a saved draft is not a published quiz, and until posting
  // existed there was no way to tell the two apart at a glance.
  const state = (draft?: boolean) => (draft ? 'Draft, not posted' : 'Live');
  const quizHint = count === 0
    ? 'Nothing saved yet'
    : `${count} question${count === 1 ? '' : 's'} · ${state(savedQuiz?.draft)} · ${deadlineSummary(savedQuiz?.dueAt)}`;
  const taskHint = savedTask
    ? `${savedTask.title} · ${state(savedTask.draft)} · ${deadlineSummary(savedTask.dueAt)}`
    : 'Nothing saved yet';
  const readingCount = savedReadings?.length ?? 0;
  const readingHint = readingCount === 0
    ? 'Nothing saved yet — ungraded, and optional'
    : `${readingCount} link${readingCount === 1 ? '' : 's'} · ${postState?.readingsDraft ? 'Draft, not posted' : 'Live'} · ungraded`;

  // Saving changes what is waiting to be posted, so the notice below the two
  // editors has to hear about it.
  const savedSomething = () => {
    setOpenEditor(null);
    qc.invalidateQueries({ queryKey: getGetCourseworkPostStateQueryKey(sessionId) });
  };

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
        // A draft that nobody can see is a draft nobody checks, and an
        // unchecked answer key fails a cohort silently at 70%.
        setOpenEditor(result.questions?.length ? 'quiz' : 'task');
        qc.invalidateQueries({ queryKey: getGetCourseworkDraftHistoryQueryKey(sessionId) });
        toast({
          title: 'Draft ready',
          description: 'Check every answer before saving. Nothing has been saved yet.',
        });
      },
      onError: (err) => toast({
        title: 'Could not draft from this material',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  return (
    <div className="space-y-5 border-t border-border pt-4">
      {onClose && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Everything for this module. Nothing here reaches learners until you post it.
          </p>
          <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground" onClick={onClose}>
            <X className="mr-1.5 h-4 w-4" aria-hidden />Close
          </Button>
        </div>
      )}

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
            Upload the deck or handout above, or paste the class transcript, and the quiz and task can be drafted from it.
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

        <div className="space-y-2">
          <EditorSection
            title="Quiz"
            hint={quizHint}
            open={openEditor === 'quiz'}
            onToggle={() => setOpenEditor(openEditor === 'quiz' ? null : 'quiz')}
          >
            <QuizEditor
              sessionId={sessionId}
              seed={questions}
              seedVersion={version}
              onSaved={savedSomething}
              suggestedDueAt={postState?.suggestedDueAt}
            />
          </EditorSection>
          <EditorSection
            title="Task"
            hint={taskHint}
            open={openEditor === 'task'}
            onToggle={() => setOpenEditor(openEditor === 'task' ? null : 'task')}
          >
            <AssignmentEditor
              sessionId={sessionId}
              seed={assignment}
              seedVersion={version}
              onSaved={savedSomething}
              suggestedDueAt={postState?.suggestedDueAt}
            />
          </EditorSection>
          <EditorSection
            title="Reading list"
            hint={readingHint}
            open={openEditor === 'reading'}
            onToggle={() => setOpenEditor(openEditor === 'reading' ? null : 'reading')}
          >
            <ReadingListEditor sessionId={sessionId} onSaved={savedSomething} />
          </EditorSection>

          {/* Below the editors, because this is the part you read after the
              cohort has been working rather than while you set the work. */}
          <EditorSection
            title="Work &amp; critiques"
            hint="What the cohort filed, and what they said about each other"
            open={openEditor === 'work'}
            onToggle={() => setOpenEditor(openEditor === 'work' ? null : 'work')}
          >
            <WorkAndCritiques sessionId={sessionId} />
          </EditorSection>

          {/* Beneath all of them, because it is the thing you do once they are
              right. One press, everything ready, one letter. */}
          <PostCoursework sessionId={sessionId} />
        </div>
      </section>

      {/* Again at the bottom, because that is where you are standing when you
          have finished with this module. */}
      {onClose && (
        <div className="border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="mr-1.5 h-4 w-4" aria-hidden />Close slides &amp; coursework
          </Button>
        </div>
      )}
    </div>
  );
}
