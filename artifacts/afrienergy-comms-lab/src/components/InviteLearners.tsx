import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Users } from 'lucide-react';
import {
  useListPrograms,
  useInviteLearnersInBulk,
  getListAllEnrollmentsQueryKey,
  type BulkInviteResult,
} from '@workspace/api-client-react';
import {
  MAX_ROSTER_ROWS,
  describeReading,
  readPastedRoster,
  type RosterReading,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

/**
 * Inviting a cohort from a spreadsheet.
 *
 * Fifty invitations is fifty real people, and an email cannot be recalled. So
 * nothing is sent until the admin has seen exactly who was read out of their
 * sheet, which rows could not be read, and how the total sits against the
 * places on the programme. The Send button does not appear before the preview.
 *
 * Afterwards every person gets a line saying what happened to them, because
 * "47 of 50 sent" leaves an admin hunting for the three.
 */

const PLACEHOLDER = `Amina Bello\tamina@example.org
Kwame Mensah\tkwame@example.org

One person per line, each with an email address. You can paste straight from
Excel or Google Sheets: select the name and email columns, copy, and paste
here. A heading row is fine.`;

function Row({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  const colour =
    tone === 'ok' ? 'text-foreground' : tone === 'warn' ? 'text-[#B45309]' : 'text-destructive';
  return <li className={`py-1 text-xs ${colour}`}>{children}</li>;
}

export function InviteLearners() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: programs = [] } = useListPrograms();
  const [programId, setProgramId] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState<RosterReading | null>(null);
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const [reading_file, setReadingFile] = useState(false);
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  const send = useInviteLearnersInBulk({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        qc.invalidateQueries({ queryKey: getListAllEnrollmentsQueryKey() });
        toast({ title: `${data.invited + data.enrolled} of ${data.outcomes.length} handled` });
      },
      onError: () => toast({ title: 'Could not send those invitations', variant: 'destructive' }),
    },
  });

  const programme = useMemo(
    () => programs.find((p) => String(p.id) === programId),
    [programs, programId],
  );

  /** How many people the paste or the file actually yielded. */
  const readyCount = reading?.entries.length ?? 0;
  const canSend = !!programId && readyCount > 0;

  /**
   * Why the button cannot be pressed yet, in the order somebody meets the
   * problems: nothing typed, then nothing readable in what was typed, then no
   * programme chosen.
   */
  const whyNotYet = !text.trim()
    ? 'Paste your list above, or upload the file.'
    : readyCount === 0
      ? 'No email addresses found. Each row needs a name and an email address, or just an email address.'
      : !programId
        ? 'Choose a programme to enrol them onto.'
        : '';

  /** Places left, so an admin sees a cohort about to overflow before sending. */
  const overCapacity =
    programme && reading ? programme.enrolledCount + reading.entries.length > programme.capacity : false;

  function preview(source: string) {
    setText(source);
    setResult(null);
    setReading(source.trim() ? readPastedRoster(source) : null);
  }

  async function uploadSheet(file: File) {
    setFileProblem(null);
    setResult(null);
    setReadingFile(true);
    try {
      const res = await fetch('/api/admin/roster-file', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-filename': file.name.slice(0, 200) },
        body: new Uint8Array(await file.arrayBuffer()),
        credentials: 'include',
      });
      const body = (await res.json()) as { text?: string; message?: string; sheetName?: string | null };
      if (!res.ok || typeof body.text !== 'string') {
        setFileProblem(body.message ?? 'That file could not be read. Try pasting the rows instead.');
        return;
      }
      preview(body.text);
      if (body.sheetName) toast({ title: `Read “${body.sheetName}”` });
    } catch {
      setFileProblem('That file could not be read. Check your connection, or paste the rows instead.');
    } finally {
      setReadingFile(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4" aria-hidden />
          Invite learners from a list
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste the names and email addresses from your spreadsheet, or upload the file. Everyone is
          invited and enrolled on the programme you choose, and nothing is sent until you have seen
          the list and pressed the button.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="bulk-programme" className="mb-1.5 block text-sm font-medium">
            Enrol them onto
          </label>
          <select
            id="bulk-programme"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={programId}
            onChange={(e) => { setProgramId(e.target.value); setResult(null); }}
          >
            <option value="">Choose a programme</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} — {p.enrolledCount}/{p.capacity} places taken
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadSheet(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={reading_file} onClick={() => fileRef.current?.click()}>
            {reading_file ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="mr-1.5 h-4 w-4" aria-hidden />}
            Upload .xlsx or .csv
          </Button>
        </div>
      </div>

      {fileProblem && (
        <p role="alert" className="text-xs font-medium text-destructive">{fileProblem}</p>
      )}

      <Textarea
        rows={8}
        className="font-mono text-xs"
        placeholder={PLACEHOLDER}
        value={text}
        onChange={(e) => preview(e.target.value)}
      />

      {reading && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-medium">{describeReading(reading)}</p>

          {reading.headerSkipped && (
            <p className="mt-1 text-xs text-muted-foreground">The first row was read as headings.</p>
          )}
          {reading.truncated && (
            <p className="mt-1 text-xs text-[#B45309]">
              Only the first {MAX_ROSTER_ROWS} rows were taken. Send these, then paste the rest.
            </p>
          )}

          {overCapacity && programme && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-[#B45309]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              That is more people than {programme.title} has places for
              ({programme.enrolledCount + reading.entries.length} against {programme.capacity}).
              They will all be enrolled — raise the places on the programme first if that matters.
            </p>
          )}

          {reading.entries.length > 0 && (
            <ul className="mt-3 max-h-48 divide-y divide-border overflow-y-auto">
              {reading.entries.map((e) => (
                <Row key={e.email} tone="ok">
                  <span className="font-medium">{e.name || '(no name)'}</span>{' '}
                  <span className="text-muted-foreground">{e.email}</span>
                </Row>
              ))}
            </ul>
          )}

          {(reading.problems.length > 0 || reading.duplicates.length > 0) && (
            <ul className="mt-3 max-h-40 divide-y divide-border overflow-y-auto border-t border-border pt-2">
              {reading.problems.map((p) => (
                <Row key={`p${p.row}`} tone="bad">Row {p.row}: {p.problem} <span className="opacity-70">{p.raw}</span></Row>
              ))}
              {reading.duplicates.map((d) => (
                <Row key={`d${d.row}`} tone="warn">Row {d.row}: {d.problem}</Row>
              ))}
            </ul>
          )}
        </div>
      )}

      {/*
        The Send button is always here, even when it cannot yet be pressed.

        It used to appear only once a list had been read successfully, which
        meant that somebody who pasted names with no email addresses, or who had
        not chosen a programme, saw no button at all and reasonably concluded
        the form was broken. A disabled button that says why is a working
        instruction; a missing button is a dead end.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!canSend || send.isPending}
          onClick={() =>
            send.mutate({
              data: {
                programId: Number(programId),
                entries: (reading?.entries ?? []).map((e) => ({ row: e.row, name: e.name, email: e.email })),
              },
            })
          }
        >
          {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {send.isPending
            ? `Inviting ${readyCount}...`
            : readyCount > 0
              ? `Invite ${readyCount} ${readyCount === 1 ? 'person' : 'people'}`
              : 'Invite them'}
        </Button>

        {!canSend && !send.isPending && (
          <p className="text-xs text-muted-foreground">{whyNotYet}</p>
        )}
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            {result.invited} invited, {result.enrolled} enrolled directly
            {result.alreadyEnrolled > 0 && `, ${result.alreadyEnrolled} already on the programme`}
            {result.failed > 0 && `, ${result.failed} could not be done`}.
          </p>
          <ul className="mt-3 max-h-60 divide-y divide-border overflow-y-auto">
            {result.outcomes.map((o) => (
              <Row key={o.email} tone={o.status === 'failed' ? 'bad' : o.status === 'already-enrolled' ? 'warn' : 'ok'}>
                <span className="font-medium">{o.name || o.email}</span>
                {o.name && <span className="text-muted-foreground"> {o.email}</span>}
                {' — '}{o.detail}
              </Row>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default InviteLearners;
