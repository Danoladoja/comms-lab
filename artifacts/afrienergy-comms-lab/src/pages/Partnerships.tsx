import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import {
  useSubmitPartnershipEnquiry,
  type PartnershipEnquiryInput,
  type PartnershipEnquiryProblems,
} from '@workspace/api-client-react';
import {
  PARTNERSHIP_INTERESTS,
  PARTNERSHIP_INTEREST_LABELS,
  type PartnershipInterest,
} from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { KenteOverlay } from '@/components/KenteOverlay';

/**
 * The partnerships page.
 *
 * Written for one reader: someone senior, short of time, deciding in about
 * fifteen seconds whether this is a serious outfit worth a reply. So the ways
 * of working together are named plainly and up front, and the form asks for the
 * four things needed to reply properly and nothing else.
 *
 * The enquiry is sent by email and stored nowhere, so the address is also
 * printed on the page. If the send fails — and it can — a person who has just
 * written three paragraphs still has somewhere to put them.
 */

const CONTACT_EMAIL = 'africaenergypulse@gmail.com';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay },
  }),
};

const ways = [
  {
    n: '01',
    title: 'Facilitate a class',
    body: 'Lead a single session in your area of practice. Most of our facilitators teach one class a cohort — enough to make a real contribution without displacing the day job.',
  },
  {
    n: '02',
    title: 'Host or co-run a programme',
    body: 'Bring a cohort from your own network — a newsroom, a regulator, a association — and we build the curriculum around what those people actually need.',
  },
  {
    n: '03',
    title: 'Fund or sponsor a cohort',
    body: 'Underwrite places for journalists and advocates who could not otherwise attend. Sponsors are named on the programme and receive a report on what the cohort produced.',
  },
  {
    n: '04',
    title: 'Media or content partnership',
    body: 'Republish work produced in the Lab, co-commission reporting, or open your archive as teaching material for a module.',
  },
];

type FormState = PartnershipEnquiryInput & { honeypot: string };

const EMPTY: FormState = {
  name: '',
  organisation: '',
  email: '',
  interest: '' as PartnershipInterest,
  message: '',
  honeypot: '',
};

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

function Problem({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
      {children}
    </p>
  );
}

export default function Partnerships() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [problems, setProblems] = useState<PartnershipEnquiryProblems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { mutateAsync, isPending } = useSubmitPartnershipEnquiry();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // Clearing as they type: leaving a message under a field they have just
    // corrected reads as though the correction did not register.
    setProblems((p) => (key in p ? { ...p, [key]: undefined } : p));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setProblems({});
    setFailure(null);

    try {
      await mutateAsync({ data: form });
      setSent(true);
    } catch (err) {
      // 400 comes back as one sentence per field; anything else is a failure to
      // deliver, which must be said plainly rather than dressed up as success.
      const status = (err as { status?: number })?.status;
      const data = (err as { data?: unknown })?.data;

      if (status === 400 && data && typeof data === 'object') {
        setProblems(data as PartnershipEnquiryProblems);
        return;
      }

      const message = (data as { message?: string } | undefined)?.message;
      setFailure(message ?? 'We could not send that just now. Please email us directly.');
    }
  }

  return (
    <div className="bg-background">
      <section className="relative overflow-hidden bg-sidebar py-24 md:py-32">
        <KenteOverlay />
        <div className="container relative mx-auto px-4 md:px-6">
          <motion.div initial="hidden" animate="visible" variants={fadeUp}>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Partnerships
            </p>
            <h1 className="max-w-4xl font-display text-4xl font-bold leading-[1.05] text-sidebar-foreground md:text-6xl">
              The Lab runs on people who show up.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70 md:text-lg">
              Every facilitator here is a working practitioner giving their time. Every cohort is
              shaped by organisations who wanted their people, or their peers, to be better at this.
              If that sounds like you, we would like to hear from you.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 md:px-6">
          <h2 className="font-display text-2xl font-bold text-foreground md:text-3xl">
            Four ways to work together
          </h2>
          <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-x-16 md:gap-y-12">
            {ways.map((way, i) => (
              <motion.div
                key={way.n}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                variants={fadeUp}
                custom={i * 0.08}
              >
                <p className="font-display text-sm font-bold text-primary">{way.n}</p>
                <h3 className="mt-2 font-display text-lg font-bold text-foreground">{way.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{way.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30 py-20 md:py-28">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-2xl">
            {sent ? (
              <div className="rounded-2xl border border-border bg-background p-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Check className="h-6 w-6 text-primary" />
                </div>
                <h2 className="mt-6 font-display text-2xl font-bold text-foreground">
                  Thank you — that reached us.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  We read every enquiry ourselves and reply to {form.email || 'the address you gave'}{' '}
                  within a few working days. If you do not hear back, write to us at{' '}
                  <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                    {CONTACT_EMAIL}
                  </a>
                  .
                </p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-2xl font-bold text-foreground md:text-3xl">
                  Start a conversation
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Four questions. We reply to every serious enquiry, and we will tell you honestly
                  if the timing is wrong rather than leaving you waiting.
                </p>

                <form onSubmit={onSubmit} className="mt-10 space-y-6" noValidate>
                  {/* Hidden from people, irresistible to form scrapers. Not
                      `display:none` — some bots skip those — and kept out of the
                      tab order and off screen readers. */}
                  <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
                    <label htmlFor="company-website">Leave this field empty</label>
                    <input
                      id="company-website"
                      name="company-website"
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.honeypot}
                      onChange={(e) => set('honeypot', e.target.value)}
                    />
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="name" className="mb-2 block text-sm font-medium text-foreground">
                        Your name
                      </label>
                      <input
                        id="name"
                        className={fieldClass}
                        value={form.name}
                        onChange={(e) => set('name', e.target.value)}
                        autoComplete="name"
                        aria-invalid={!!problems.name}
                      />
                      <Problem>{problems.name}</Problem>
                    </div>

                    <div>
                      <label htmlFor="organisation" className="mb-2 block text-sm font-medium text-foreground">
                        Organisation
                      </label>
                      <input
                        id="organisation"
                        className={fieldClass}
                        value={form.organisation}
                        onChange={(e) => set('organisation', e.target.value)}
                        autoComplete="organization"
                        aria-invalid={!!problems.organisation}
                      />
                      <Problem>{problems.organisation}</Problem>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      className={fieldClass}
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      autoComplete="email"
                      aria-invalid={!!problems.email}
                    />
                    <Problem>{problems.email}</Problem>
                  </div>

                  <div>
                    <label htmlFor="interest" className="mb-2 block text-sm font-medium text-foreground">
                      What do you have in mind?
                    </label>
                    <select
                      id="interest"
                      className={fieldClass}
                      value={form.interest}
                      onChange={(e) => set('interest', e.target.value as PartnershipInterest)}
                      aria-invalid={!!problems.interest}
                    >
                      <option value="">Choose one</option>
                      {PARTNERSHIP_INTERESTS.map((key) => (
                        <option key={key} value={key}>
                          {PARTNERSHIP_INTEREST_LABELS[key]}
                        </option>
                      ))}
                    </select>
                    <Problem>{problems.interest}</Problem>
                  </div>

                  <div>
                    <label htmlFor="message" className="mb-2 block text-sm font-medium text-foreground">
                      Tell us a little more
                    </label>
                    <textarea
                      id="message"
                      rows={6}
                      className={fieldClass}
                      placeholder="What you work on, and what you would like to do with the Lab."
                      value={form.message}
                      onChange={(e) => set('message', e.target.value)}
                      aria-invalid={!!problems.message}
                    />
                    <Problem>{problems.message}</Problem>
                  </div>

                  {failure && (
                    <div
                      role="alert"
                      className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground"
                    >
                      <p className="font-medium">{failure}</p>
                      <p className="mt-1 text-muted-foreground">
                        Your message has not been lost from this page — copy it and send it to{' '}
                        <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                          {CONTACT_EMAIL}
                        </a>
                        .
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="rounded-full px-8 font-bold shadow-md shadow-primary/20"
                    >
                      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isPending ? 'Sending' : 'Send enquiry'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Or write to{' '}
                      <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                        {CONTACT_EMAIL}
                      </a>
                      .
                    </p>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
