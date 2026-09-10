import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDraftCourseworkFromSlides, useGetSessionSlides, useGetSessionNotes,
  useGetCourseworkDraftHistory, useGetSessionQuiz, useGetSessionAssignment,
  getGetSessionSlidesQueryKey, getGetSessionNotesQueryKey, getGetCourseworkDraftHistoryQueryKey,
  getGetSessionQuizQueryKey, getGetSessionAssignmentQueryKey,
  type DraftQuestion,
} from '@workspace/api-client-react';
import { draftDisclaimer, MIN_USABLE_SLIDE_CHARS, apiReason } from '@workspace/domain';
import { deadlineSummary } from '@/lib/dueDateText';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import SlideDeckPanel from '@/components/SlideDeckPanel';
import ClassMaterialPanel from '@/components/ClassMaterialPanel';
import { QuizEditor, AssignmentEditor } from '@/components/AdminCourseworkEditor';
import ReadingListEditor from '@/components/ReadingListEditor';
import { Sparkles, Loader, CircleAlert, Lightbulb, History, Scissors, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * One of the two editors, shut until asked for.
 *
 * Both used to sit open all the time, which made a module's page long enough
 * that the reading list beneath them was rarely found. More to the point, there
 * was no sign that a save had done anything: the form stayed exactly as it was,
 * so people pressed Save twice, or wandered off unsure.
 *
 * Shutting on a *successful* save is the answer to both. It is the receipt.
 */
function Drawer({ title, hint, open, onToggle, children }: {
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}


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
  const [openEditor, setOpenEditor] = useState<'quiz' | 'task' | null>(null);

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

  const count = savedQuiz?.questions.length ?? 0;
  const quizHint = count === 0
    ? 'Nothing saved yet'
    : `${count} question${count === 1 ? '' : 's'} · ${deadlineSummary(savedQuiz?.dueAt)}`;
  const taskHint = savedTask
    ? `${savedTask.title} · ${deadlineSummary(savedTask.dueAt)}`
    : 'Nothing saved yet';

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
          <Drawer
            title="Quiz"
            hint={quizHint}
            open={openEditor === 'quiz'}
            onToggle={() => setOpenEditor(openEditor === 'quiz' ? null : 'quiz')}
          >
            <QuizEditor
              sessionId={sessionId}
              seed={questions}
              seedVersion={version}
              onSaved={() => setOpenEditor(null)}
            />
          </Drawer>
          <Drawer
            title="Task"
            hint={taskHint}
            open={openEditor === 'task'}
            onToggle={() => setOpenEditor(openEditor === 'task' ? null : 'task')}
          >
            <AssignmentEditor
              sessionId={sessionId}
              seed={assignment}
              seedVersion={version}
              onSaved={() => setOpenEditor(null)}
            />
          </Drawer>
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
