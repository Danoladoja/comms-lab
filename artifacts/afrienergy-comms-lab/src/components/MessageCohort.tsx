import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePreviewCohortRecipients,
  useSendCohortMessage,
  useListCohortMessages,
  getPreviewCohortRecipientsQueryKey,
  getListCohortMessagesQueryKey,
  type CohortMessageResult,
} from '@workspace/api-client-react';
import {
  validateCohortMessage,
  describeAudience,
  describeSendResult,
  messageParagraphs,
  apiReason,
  MAX_MESSAGE_CHARS,
  MAX_SUBJECT_CHARS,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Mail, Send, Loader2, CircleAlert, History, CheckCircle2 } from 'lucide-react';

/**
 * Writing to everybody on a programme.
 *
 * Fifty emails cannot be recalled, so nothing here is a single click. The
 * admin sees the exact number of people and a sample of who they are, then a
 * preview of the letter as it will arrive, and only then a button that names
 * the number again.
 *
 * The message is plain text on purpose. It goes out in the Lab's standard
 * letter — the same one the invitation uses — and the only thing that differs
 * between any two emails the Lab sends is the words. An admin composing HTML
 * would be composing a second design.
 */

const EMPTY = { subject: '', body: '', actionLabel: '', actionUrl: '' };

export default function MessageCohort({ programId, programmeTitle }: {
  programId: number;
  programmeTitle: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [audience, setAudience] = useState<'active' | 'everyone'>('active');
  const [result, setResult] = useState<CohortMessageResult | null>(null);

  const { data: recipients } = usePreviewCohortRecipients(programId, {
    query: { queryKey: getPreviewCohortRecipientsQueryKey(programId), enabled: open },
  });
  const { data: history = [] } = useListCohortMessages(programId, {
    query: { queryKey: getListCohortMessagesQueryKey(programId), enabled: open },
  });

  const send = useSendCohortMessage({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        if (data.failed === 0) setForm(EMPTY);
        toast({
          title: describeSendResult(data.outcomes),
          variant: data.failed > 0 ? 'destructive' : undefined,
        });
        qc.invalidateQueries({ queryKey: getListCohortMessagesQueryKey(programId) });
      },
      onError: (err) => toast({
        title: 'Nothing was sent',
        description: apiReason(err, 'Try again in a moment.'),
        variant: 'destructive',
      }),
    },
  });

  const chosen = audience === 'everyone' ? recipients?.everyone : recipients?.active;
  const count = chosen?.count ?? 0;

  // The same rule the server holds, so the button and the server agree about
  // what is ready to send.
  const { problems } = validateCohortMessage({ ...form, audience });
  const ready = problems.length === 0 && count > 0;
  const preview = messageParagraphs(form.body);

  if (!open) {
    return (
      <div className="border-t border-border p-5">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Mail className="mr-1.5 h-4 w-4" aria-hidden />
          Write to this cohort
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            Write to {programmeTitle}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            It arrives in the Lab's usual letter, the same one the invitation uses. You write the
            words; the design is already decided.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      {/* Who, before what. The number is the thing worth being sure of. */}
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-xs font-semibold">Who gets it</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {(['active', 'everyone'] as const).map(option => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                className="h-4 w-4 accent-primary"
                checked={audience === option}
                onChange={() => setAudience(option)}
              />
              {option === 'active' ? 'Everyone currently on it' : 'Everyone, including those who have finished'}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{describeAudience(audience, count)}</p>
        {(chosen?.sample.length ?? 0) > 0 && (
          <p className="mt-1 text-xs text-muted-foreground/80">
            {chosen!.sample.map(p => p.name || p.email).join(', ')}
            {count > chosen!.sample.length && ` and ${count - chosen!.sample.length} more`}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold">Subject</span>
          <Input
            className="mt-1 text-sm"
            maxLength={MAX_SUBJECT_CHARS}
            placeholder="Thursday's class has moved to 4pm"
            value={form.subject}
            onChange={e => { setForm({ ...form, subject: e.target.value }); setResult(null); }}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold">Message</span>
          <Textarea
            rows={7}
            className="mt-1 text-sm"
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={'Write as you would to a colleague.\n\nA blank line starts a new paragraph.'}
            value={form.body}
            onChange={e => { setForm({ ...form, body: e.target.value }); setResult(null); }}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {form.body.length} of {MAX_MESSAGE_CHARS} characters. Plain words only: the letter adds
            the rest.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold">Button, if you want one</span>
            <Input
              className="mt-1 text-sm"
              placeholder="Open the reading"
              value={form.actionLabel}
              onChange={e => setForm({ ...form, actionLabel: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold">Where it goes</span>
            <Input
              className="mt-1 text-sm"
              placeholder="https://energycommslab.africa/dashboard"
              value={form.actionUrl}
              onChange={e => setForm({ ...form, actionUrl: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* The letter as it will arrive, in the Lab's colours. Not a mock-up of a
          different thing: these are the same words, in the same order. */}
      {preview.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-xs font-semibold">How it will arrive</p>
          <div className="mt-2 overflow-hidden rounded-xl" style={{ background: '#EFEAE0', padding: 12 }}>
            <div style={{ maxWidth: 520, margin: '0 auto', background: '#FFFFFF', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ background: '#07111E', padding: '16px 20px' }}>
                <span style={{ color: '#F4F0E8', fontSize: 15, fontWeight: 'bold' }}>Ananse Comms Lab</span>
                <p style={{ margin: '8px 0 0', color: '#F4F0E8', opacity: 0.75, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Africa's learning hub for energy communicators
                </p>
              </div>
              <div style={{ padding: 20, color: '#07111E', fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6 }}>Hello Amina,</p>
                {preview.map((p, i) => (
                  <p key={i} style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6 }}>{p}</p>
                ))}
                {form.actionLabel.trim() && form.actionUrl.trim() && (
                  <p style={{ margin: '20px 0 4px' }}>
                    <span style={{ background: '#F97316', color: '#07111E', fontWeight: 'bold', fontSize: 13, padding: '10px 20px', borderRadius: 999, display: 'inline-block' }}>
                      {form.actionLabel}
                    </span>
                  </p>
                )}
              </div>
              <div style={{ background: '#F4F0E8', padding: '12px 20px', fontSize: 10, color: '#5B6470' }}>
                Ananse Comms Lab · africaenergypulse@gmail.com
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each person is greeted by their own first name.
          </p>
        </div>
      )}

      {problems.length > 0 && form.body.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-[#B45309]">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{problems.join(' ')}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready || send.isPending}
          onClick={() => {
            if (!confirm(`Send this to ${count} ${count === 1 ? 'person' : 'people'} on ${programmeTitle}? An email cannot be recalled.`)) return;
            send.mutate({ id: programId, data: {
              subject: form.subject,
              body: form.body,
              audience,
              actionLabel: form.actionLabel.trim() || null,
              actionUrl: form.actionUrl.trim() || null,
            } });
          }}
        >
          {send.isPending
            ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Sending to {count}…</>
            : <><Send className="mr-1.5 h-4 w-4" aria-hidden />Send to {count}</>}
        </Button>
        {count === 0 && (
          <p className="text-xs text-muted-foreground">Nobody on this programme to write to yet.</p>
        )}
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
            {describeSendResult(result.outcomes)}
          </p>
          {result.failed > 0 && (
            <ul className="mt-3 max-h-48 divide-y divide-border overflow-y-auto">
              {result.outcomes.filter(o => o.status === 'failed').map(o => (
                <li key={o.email} className="py-1.5 text-xs text-destructive">
                  <span className="font-medium">{o.name || o.email}</span>
                  {o.name && <span className="opacity-70"> {o.email}</span>}
                  {' — '}{o.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            Already sent to this cohort
          </p>
          <ul className="mt-2 divide-y divide-border">
            {history.slice(0, 6).map(m => (
              <li key={m.id} className="py-2">
                <p className="text-sm font-medium">{m.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                  {' · '}{m.sentCount} sent
                  {m.failedCount > 0 && `, ${m.failedCount} failed`}
                  {m.sentByName && ` · by ${m.sentByName}`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
