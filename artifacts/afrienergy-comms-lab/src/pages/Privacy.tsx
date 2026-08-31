import { KenteOverlay } from '@/components/KenteOverlay';

/**
 * The privacy policy.
 *
 * Adapted from the Africa Energy Pulse policy, but not copied: that policy
 * covers a publication with a newsletter, and this is a learning platform that
 * holds accounts, attendance, submitted coursework and peer critique. Claiming
 * to collect less than we do would be worse than having no policy at all.
 *
 * So the sections below describe what this application actually stores and
 * which companies actually see it — including that class material is sent to an
 * AI provider when a facilitator uses the drafting tool, which is the least
 * obvious of them and the one a careful reader would most want to know.
 */

const LAST_UPDATED = '31 August 2026';
const CONTACT_EMAIL = 'africaenergypulse@gmail.com';

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="font-display text-lg font-bold text-foreground">
        <span className="mr-3 text-primary">{n}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-2">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function Privacy() {
  return (
    <div className="bg-background">
      <section className="relative overflow-hidden bg-sidebar py-20 md:py-28">
        <KenteOverlay />
        <div className="container relative mx-auto px-4 md:px-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Legal</p>
          <h1 className="font-display text-4xl font-bold leading-[1.05] text-sidebar-foreground md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-sidebar-foreground/60">Last updated {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-10">
            <p className="text-base leading-relaxed text-foreground">
              The Afrienergy Comms Lab is committed to protecting your privacy and handling your
              personal information responsibly. This policy explains what we collect when you use
              this platform, why we hold it, and what you can ask us to do with it. By creating an
              account or using this site, you consent to the practices described here.
            </p>

            <Section n="01" title="Information we collect">
              <p>When you create an account and take part in a programme, we hold:</p>
              <List
                items={[
                  'Your name and email address, provided when you sign up or when an administrator invites you.',
                  'Your role on the platform — learner, facilitator, or administrator — and the programmes and classes you are enrolled in or teach.',
                  'A record of your learning: which live classes you attended, how much of a recording you have watched, your quiz answers and scores, the assignments you submit, and the critique you give and receive from peers.',
                  'Anything you write in a cohort discussion, which is visible to others in that cohort.',
                  'Certificates you earn, including the verification code that makes a certificate publicly checkable by anyone you share it with.',
                  'Basic technical information that any web server records, such as your IP address and browser type, used to keep the service running and secure.',
                ]}
              />
              <p>
                We do not ask for, and have no use for, your date of birth, your physical address, or
                any payment details.
              </p>
            </Section>

            <Section n="02" title="How we use it">
              <p>
                Your information exists to run the programme you signed up for. Specifically, we use
                it to give you access to your classes and materials, to track your progress towards a
                certificate, to let facilitators mark and comment on your work, to send you reminders
                about upcoming classes, and to keep the platform secure and working.
              </p>
              <p>
                We do not use your information to build an advertising profile, and we do not sell it.
              </p>
            </Section>

            <Section n="03" title="Who else sees it">
              <p>
                We do not sell your personal data. We share only what is necessary with the service
                providers who make the platform work:
              </p>
              <List
                items={[
                  'Clerk, which manages sign-in and holds your name, email address and password or sign-in code.',
                  'Railway, which hosts the application and its database.',
                  'Brevo, which delivers the emails we send you, such as class reminders and invitations.',
                  'Anthropic, when a facilitator uses the AI tool to draft quiz questions and assignments. Class material — slides and session notes — is sent to that service for drafting. Learner submissions and personal details are not.',
                  'Google, where a facilitator connects a Google account so that class recordings can be published to the cohort.',
                ]}
              />
              <p>
                We may also disclose information where the law requires it, or where it is necessary
                to protect the rights and safety of our users. If the Lab is ever transferred to
                another organisation, your information may transfer with it, and we would tell you
                before that happened.
              </p>
              <p>
                Other people in your cohort can see your name, anything you post in a discussion, and
                — where a programme uses peer critique — the work you submit for review.
              </p>
            </Section>

            <Section n="04" title="Cookies">
              <p>
                We use a cookie set by our sign-in provider to keep you signed in as you move between
                pages. Without it you would have to sign in again on every page, so it cannot be
                turned off while you are using an account. We do not use advertising or
                cross-site tracking cookies. You can block or delete cookies in your browser
                settings, but parts of the platform will stop working if you do.
              </p>
            </Section>

            <Section n="05" title="Keeping it safe">
              <p>
                We use appropriate technical and organisational measures to protect your information
                against unauthorised access, alteration, or disclosure. Traffic to and from this site
                is encrypted, passwords and sign-in codes are handled entirely by our sign-in
                provider and are never visible to us, and access to the database is limited to the
                people who administer the platform. No system is perfectly secure, and we do not
                claim otherwise.
              </p>
            </Section>

            <Section n="06" title="How long we keep it">
              <p>
                We keep your information for as long as your account is open and you are taking part
                in a programme, and afterwards only for as long as we need it — chiefly so that a
                certificate you earned remains verifiable by an employer who checks it. If you ask us
                to delete your account, we will do so, and we will tell you plainly if that means a
                certificate you have already shared will stop verifying.
              </p>
            </Section>

            <Section n="07" title="Your rights">
              <p>Depending on your jurisdiction, you have the right to:</p>
              <List
                items={[
                  'Ask what personal information we hold about you, and receive a copy of it.',
                  'Have information that is wrong corrected.',
                  'Ask us to delete your account and the information attached to it.',
                  'Withdraw your consent, and stop using the platform, at any time.',
                  'Opt out of reminder and announcement emails while keeping your account.',
                ]}
              />
              <p>
                Write to us at the address below and we will respond. We will not charge you for
                making a request, and we will not make it difficult.
              </p>
            </Section>

            <Section n="08" title="Links to other sites">
              <p>
                Reading lists, recordings, and materials shared by facilitators may link to other
                websites. We are not responsible for the privacy practices of those sites, and we
                encourage you to read their policies before giving them your information.
              </p>
            </Section>

            <Section n="09" title="Changes to this policy">
              <p>
                We may update this policy as the platform changes. When we do, we will change the
                date at the top of this page. If a change materially affects how we use your
                information, we will tell account holders by email rather than relying on you to
                notice.
              </p>
            </Section>

            <Section n="10" title="Contact us">
              <p>
                For any question about this policy, or to make a request about your information,
                write to{' '}
                <a className="font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </Section>
          </div>
        </div>
      </section>
    </div>
  );
}
