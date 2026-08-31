import { useState } from 'react';
import { Link } from 'wouter';
import { Check, Loader2 } from 'lucide-react';
import { useJoinWaitlist, useListPrograms } from '@workspace/api-client-react';
import { ANY_PROGRAMME, acceptsEnrolment } from '@workspace/domain';
import { Button } from '@/components/ui/button';

/**
 * The waitlist.
 *
 * This replaced open sign-up, and the reason matters for how it reads. Anybody
 * could previously create an account, land in the Lab on no programme at all,
 * and sit in the People list as a stranger. Places are limited and cohorts are
 * chosen; pretending otherwise with a "Join the Lab" button was misleading
 * before it was a data problem.
 *
 * So this page is honest about what it is. It asks for three things, says
 * plainly that a place is not immediate, and does not dress a queue up as a
 * membership.
 */

const CONTACT_EMAIL = 'africaenergypulse@gmail.com';

export default function Waitlist() {
  const { data: programmes = [] } = useListPrograms();
  const [form, setForm] = useState({ name: '', email: '', programme: ANY_PROGRAMME, note: '', trap: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const join = useJoinWaitlist({
    mutation: {
      onSuccess: (result) => {
        setDone(result.message ?? 'You are on the waitlist.');
        setProblem(null);
      },
      onError: (err) => {
        const message = (err as unknown as { message?: string })?.message;
        setProblem(message || 'That could not be sent just now. Please try again, or email us.');
      },
    },
  });

  // A cohort that has closed can still be asked about — that is often exactly
  // why somebody joins a waitlist — but it is not offered as an open choice.
  const open = programmes.filter((p) => acceptsEnrolment(p.status));

  if (done) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-24">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <h1 className="mb-3 font-display text-2xl font-bold">You are on the list</h1>
          <p className="text-muted-foreground">{done}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing is needed from you now. When a place opens we email an invitation, and that link is
            what creates your account.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild variant="outline"><Link href="/courses">See the programmes</Link></Button>
            <Button asChild variant="ghost"><Link href="/">Back to the homepage</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-16 md:py-24">
      <h1 className="mb-3 font-display text-3xl font-bold md:text-4xl">Join the waitlist</h1>
      <p className="mb-8 text-muted-foreground">
        Places on each cohort are limited, so the Lab runs by invitation. Tell us who you are and what
        you are hoping to join, and we will write to you when a place opens.
      </p>

      <form
        className="space-y-5 rounded-2xl border border-border bg-card p-6 md:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          join.mutate({ data: form });
        }}
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="wl-name">Your name</label>
          <input
            id="wl-name"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={form.name}
            required
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="wl-email">Email address</label>
          <input
            id="wl-email"
            type="email"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={form.email}
            required
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <p className="mt-1 text-xs text-muted-foreground">Your invitation will come to this address.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="wl-programme">
            Which programme?
          </label>
          <select
            id="wl-programme"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={form.programme}
            onChange={(e) => setForm({ ...form, programme: e.target.value })}
          >
            <option value={ANY_PROGRAMME}>Any future cohort</option>
            {open.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="wl-note">
            Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="wl-note"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={form.note}
            placeholder="What you cover, where you work, why this programme."
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        {/* Out of sight and out of the tab order. A person never meets this; a
            crude script fills everything it finds. */}
        <div className="hidden" aria-hidden>
          <label htmlFor="wl-trap">Leave this empty</label>
          <input
            id="wl-trap"
            tabIndex={-1}
            autoComplete="off"
            value={form.trap}
            onChange={(e) => setForm({ ...form, trap: e.target.value })}
          />
        </div>

        {problem && (
          <p role="alert" className="text-sm font-medium text-destructive">{problem}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={join.isPending}>
            {join.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {join.isPending ? 'Adding you...' : 'Join the waitlist'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Already invited? <Link href="/sign-in" className="underline underline-offset-2">Sign in</Link>.
          </span>
        </div>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        Trouble with this form? Email <a className="underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}
