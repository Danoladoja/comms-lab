import { useState } from 'react';
import {
  useListPrograms, useGetCapstoneBoard, useSetCapstone, usePublishCapstone,
  useReadCapstoneSubmission, useReviewCapstone,
  getGetCapstoneBoardQueryKey, getReadCapstoneSubmissionQueryKey,
  type CapstoneBoard,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { capstonePublishProblem, capstoneReviewProblem, apiReason } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  FileText, Check, RotateCcw, Loader2, Paperclip, AlertTriangle, ChevronLeft, Eye,
} from 'lucide-react';

function when(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function dateInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LABELS: Record<string, { text: string; className: string }> = {
  approved: { text: 'Approved', className: 'text-emerald-600 dark:text-emerald-400' },
  submitted: { text: 'Waiting', className: 'text-amber-600 dark:text-amber-400' },
  returned: { text: 'Sent back', className: 'text-orange-600 dark:text-orange-400' },
  draft: { text: 'Started', className: 'text-muted-foreground' },
};

/**
 * Setting the capstone, and marking what comes in.
 *
 * The thing to notice on this screen is that it lists the whole cohort rather
 * than the submissions. A queue of things to mark hides the people who have not
 * started, and those are the ones worth a message in week five.
 */
export default function CapstoneAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: programmes = [] } = useListPrograms();
  const [programId, setProgramId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: board } = useGetCapstoneBoard(programId ?? 0, {
    query: { queryKey: getGetCapstoneBoardQueryKey(programId ?? 0), enabled: Boolean(programId) },
  });

  if (openId !== null && programId) {
    return <ReadOne submissionId={openId} programId={programId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-display font-bold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" aria-hidden /> Capstone
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          One final piece per programme, read and marked by staff. Publishing it starts withholding
          certificates until each learner's is approved, so it goes live only when you press the button.
        </p>
      </div>

      <select
        value={programId ?? ''}
        onChange={(e) => { setProgramId(e.target.value ? Number(e.target.value) : null); setOpenId(null); }}
        className="w-full max-w-md bg-background border border-border rounded-lg px-3 py-2.5 text-sm"
      >
        <option value="">Choose a programme…</option>
        {programmes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>

      {programId && board && (
        <>
          <Brief programId={programId} board={board} onChanged={() => qc.invalidateQueries({ queryKey: getGetCapstoneBoardQueryKey(programId) })} />

          {board.capstone && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h3 className="font-semibold">The cohort</h3>
                <p className="text-xs text-muted-foreground">
                  {board.waiting} waiting to be read · {board.approved} approved · {board.learners.length} on the programme
                </p>
              </div>
              <div className="border border-border rounded-xl overflow-hidden">
                {board.learners.length === 0 && (
                  <p className="p-5 text-sm text-muted-foreground">Nobody is enrolled on this programme yet.</p>
                )}
                {board.learners.map((l) => {
                  const label = l.status ? LABELS[l.status] : null;
                  return (
                    <div key={l.userId} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{l.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{l.email}</p>
                      </div>
                      {l.hasFile && <Paperclip className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />}
                      {l.attempt !== null && l.attempt !== undefined && l.attempt > 1 && (
                        <span className="text-xs text-muted-foreground">attempt {l.attempt}</span>
                      )}
                      <span className={`text-xs font-semibold ${label?.className ?? 'text-muted-foreground/60'}`}>
                        {label?.text ?? 'Not started'}
                      </span>
                      {l.score !== null && l.score !== undefined && (
                        <span className="text-xs font-mono tabular-nums">{l.score}/{board.capstone?.maxScore}</span>
                      )}
                      <span className="text-xs text-muted-foreground w-28 text-right hidden sm:block">
                        {l.submittedAt ? when(l.submittedAt) : ''}
                      </span>
                      {l.submissionId !== null && l.submissionId !== undefined ? (
                        <Button size="sm" variant="outline" onClick={() => setOpenId(l.submissionId!)}>
                          <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden /> Read
                        </Button>
                      ) : <span className="w-[86px]" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Board = CapstoneBoard;

function Brief({ programId, board, onChanged }: { programId: number; board: Board; onChanged: () => void }) {
  const { toast } = useToast();
  const c = board.capstone;
  const [title, setTitle] = useState(c?.title ?? '');
  const [brief, setBrief] = useState(c?.brief ?? '');
  const [atLeast, setAtLeast] = useState(String(c?.wordsAtLeast ?? 0));
  const [atMost, setAtMost] = useState(String(c?.wordsAtMost ?? 0));
  const [maxScore, setMaxScore] = useState(String(c?.maxScore ?? 100));
  const [dueAt, setDueAt] = useState(dateInput(c?.dueAt));

  const save = useSetCapstone({
    mutation: {
      onSuccess: () => { onChanged(); toast({ title: 'Saved' }); },
      onError: (err) => toast({ title: 'Not saved', description: apiReason(err, 'Try again.'), variant: 'destructive' }),
    },
  });
  const publish = usePublishCapstone({
    mutation: {
      onSuccess: () => { onChanged(); toast({ title: 'Live', description: 'The cohort can see it now.' }); },
      onError: (err) => toast({ title: 'Not published', description: apiReason(err, 'Try again.'), variant: 'destructive' }),
    },
  });

  const draft = {
    title,
    brief,
    wordsAtLeast: Number(atLeast) || 0,
    wordsAtMost: Number(atMost) || 0,
    maxScore: Number(maxScore) || 0,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
  };
  // Said before the button, not after it: publishing starts withholding
  // certificates for the whole cohort.
  const problem = capstonePublishProblem(draft, Date.now());
  const live = Boolean(c && !c.draft);

  return (
    <div className="border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold">The brief</h3>
        <span className={`text-xs font-semibold ${live ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
          {live ? 'Live to the cohort' : c ? 'Draft — nobody can see it' : 'Not written yet'}
        </span>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What it is called"
        className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm"
      />
      <Textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="What they are producing, and what it will be judged on."
        className="min-h-[140px] text-sm leading-relaxed"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-xs text-muted-foreground">
          Shortest (words)
          <input value={atLeast} onChange={(e) => setAtLeast(e.target.value)} inputMode="numeric"
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Longest (words)
          <input value={atMost} onChange={(e) => setAtMost(e.target.value)} inputMode="numeric"
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Marked out of
          <input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} inputMode="numeric"
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="text-xs text-muted-foreground">
          Due (optional)
          <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Zero for either word count means no limit.</p>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={() => save.mutate({ programId, data: draft })} disabled={save.isPending} variant="outline">
          {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden />} Save
        </Button>
        {!live && (
          <Button
            onClick={() => {
              save.mutate({ programId, data: draft }, { onSuccess: () => publish.mutate({ programId }) });
            }}
            disabled={Boolean(problem) || publish.isPending}
            className="font-bold"
          >
            {publish.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden />} Make it live
          </Button>
        )}
      </div>
      {!live && problem && (
        <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden /> {problem}
        </p>
      )}
      {!live && !problem && (
        <p className="text-xs text-muted-foreground">
          Once it is live, every certificate on this programme waits for an approved capstone.
        </p>
      )}
    </div>
  );
}

function ReadOne({ submissionId, programId, onBack }: { submissionId: number; programId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: s, isLoading } = useReadCapstoneSubmission(submissionId, {
    query: { queryKey: getReadCapstoneSubmissionQueryKey(submissionId) },
  });
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');

  const review = useReviewCapstone({
    mutation: {
      onSuccess: (_d, vars) => {
        qc.invalidateQueries({ queryKey: getGetCapstoneBoardQueryKey(programId) });
        qc.invalidateQueries({ queryKey: getReadCapstoneSubmissionQueryKey(submissionId) });
        toast({
          title: vars.data.decision === 'approve' ? 'Approved' : 'Sent back',
          description: vars.data.decision === 'approve'
            ? 'Their certificate is released once the survey is filed too.'
            : 'They can see your note and write it again.',
        });
        onBack();
      },
      onError: (err) => toast({ title: 'Not recorded', description: apiReason(err, 'Try again.'), variant: 'destructive' }),
    },
  });

  if (isLoading || !s) {
    return <div className="h-64 bg-card border border-border rounded-xl animate-pulse" />;
  }

  const parsedScore = score.trim() === '' ? null : Number(score);
  const approveProblem = capstoneReviewProblem({
    decision: 'approve', score: parsedScore, maxScore: s.maxScore, note, status: s.status,
  });
  const returnProblem = capstoneReviewProblem({
    decision: 'return', score: parsedScore, maxScore: s.maxScore, note, status: s.status,
  });

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ChevronLeft className="w-4 h-4" aria-hidden /> Back to the cohort
      </button>

      <div>
        <h2 className="text-lg font-display font-bold">{s.learnerName}</h2>
        <p className="text-xs text-muted-foreground">
          {s.learnerEmail} · attempt {s.attempt} · {s.words} words · sent {when(s.submittedAt)}
        </p>
      </div>

      {s.earlier.length > 0 && (
        <div className="border border-border rounded-xl p-4">
          <p className="text-xs font-semibold mb-2">What they were told before</p>
          <ul className="space-y-2">
            {s.earlier.map((e) => (
              <li key={e.id} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Attempt {e.attempt}</span>
                {' — '}{e.status === 'approved' ? 'approved' : 'sent back'}
                {e.reviewNote ? `: ${e.reviewNote}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.filename && (
        <a href={s.downloadPath ?? '#'} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <Paperclip className="w-4 h-4" aria-hidden /> {s.filename}
          {s.sizeBytes ? <span className="text-muted-foreground">({(s.sizeBytes / 1024).toFixed(0)} KB)</span> : null}
        </a>
      )}

      <div className="border border-border rounded-xl p-6 bg-muted/20">
        {s.body.trim()
          ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{s.body}</p>
          : <p className="text-sm text-muted-foreground italic">Nothing typed — the piece is the attached document.</p>}
      </div>

      {s.status !== 'submitted' ? (
        <p className="text-sm text-muted-foreground">
          This attempt has already been {s.status === 'approved' ? 'approved' : 'sent back'}.
        </p>
      ) : (
        <div className="border border-border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold">Your verdict</h3>
          <label className="block text-xs text-muted-foreground">
            Mark out of {s.maxScore}
            <input
              value={score}
              onChange={(e) => setScore(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 72"
              className="mt-1 w-32 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
            />
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What they did well, or what has to change. Required if you are sending it back."
            className="min-h-[120px] text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => review.mutate({ id: submissionId, data: { decision: 'approve', score: parsedScore ?? undefined, note } })}
              disabled={Boolean(approveProblem) || review.isPending}
              className="font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Check className="w-4 h-4 mr-1.5" aria-hidden /> Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => review.mutate({ id: submissionId, data: { decision: 'return', score: parsedScore ?? undefined, note } })}
              disabled={Boolean(returnProblem) || review.isPending}
            >
              <RotateCcw className="w-4 h-4 mr-1.5" aria-hidden /> Send it back
            </Button>
          </div>
          {approveProblem && returnProblem && (
            <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden /> {approveProblem}
            </p>
          )}
          {!approveProblem && returnProblem && (
            <p className="text-xs text-muted-foreground">{returnProblem}</p>
          )}
        </div>
      )}
    </div>
  );
}
