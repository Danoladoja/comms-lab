import { useState } from 'react';
import { useSetMyName, getGetMeQueryKey, getListMyCertificatesQueryKey, getListPendingCertificatesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
// The app's one reader of /me: it waits for Clerk before asking, retries a
// dropped packet, and shares its cache with every other caller. A bare
// useGetMe here would fire before the session existed and answer 401.
import { useCurrentUser } from '@/lib/useCurrentUser';
import { learnerNameProblem, MAX_LEARNER_NAME } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Pencil, UserRound } from 'lucide-react';

/**
 * The name that goes on the certificate, and a box to correct it.
 *
 * Signing up to the Lab does not require a first or last name, so for a large
 * share of learners the only thing it knows is an email address — which was
 * being printed on the sheet. The address is no longer printed, which on its
 * own would leave those learners with a certificate that never arrives and no
 * way to find out why. This is the way out: one field, their own to set.
 *
 * Shown open when there is nothing to print, and collapsed to a line of text
 * with a "change" link when there is, because somebody whose name is already
 * right should not be asked about it on every visit.
 *
 * `tone` exists because this sits on two very different grounds: the ordinary
 * page, and the near-black sheet of the certificate screens. Inheriting the
 * page's muted grey onto that one leaves the sentence all but unreadable, and
 * a colour override written at each call site is a thing that gets forgotten
 * the third time somebody drops this component somewhere new.
 */
export default function NameOnYourCertificate({ tone = 'page' }: { tone?: 'page' | 'dark' }) {
  const dark = tone === 'dark';
  const quiet = dark ? 'text-[#F4F0E8]/70' : 'text-muted-foreground';
  const loud = dark ? 'text-[#F4F0E8]' : 'text-foreground';
  const { user: me, isLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const printable = me?.printableName ?? '';
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [serverSaid, setServerSaid] = useState<string | null>(null);

  const save = useSetMyName({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setServerSaid(null);
        // Both certificate lists are computed from this name on the server, so
        // both are stale the moment it changes. Without this the learner saves
        // their name and the page carries on telling them it is missing.
        void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListMyCertificatesQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListPendingCertificatesQueryKey() });
      },
      onError: (err) => {
        const body = (err as { response?: { data?: { error?: string } } }).response?.data;
        setServerSaid(body?.error ?? 'That could not be saved. Try again in a moment.');
      },
    },
  });

  // Nothing while the answer is still in flight: a box asking for a name,
  // flashed up and then replaced by the name already on file, reads as though
  // the Lab had lost it.
  if (isLoading || !me) return null;

  // Not asked for and not needed: there is a name, and the box is shut.
  if (printable && !open) {
    return (
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mb-8 ${quiet}`}>
        <UserRound className="w-4 h-4 shrink-0" aria-hidden />
        <span>
          Certificates are made out to <span className={`font-semibold ${loud}`}>{printable}</span>.
        </span>
        <button
          type="button"
          onClick={() => { setValue(printable); setOpen(true); }}
          className={`inline-flex items-center gap-1 font-semibold hover:underline ${dark ? 'text-[#F97316]' : 'text-primary'}`}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden />Change
        </button>
      </div>
    );
  }

  // The same sentence the server will give back, from the same function, so
  // the refusal never changes between pressing and landing.
  const problem = learnerNameProblem(value);
  const showProblem = value.trim().length > 0 ? problem : null;

  return (
    <div className="bg-card border border-amber-500/40 rounded-2xl p-5 mb-8 max-w-xl">
      <div className="flex items-start gap-3">
        <UserRound className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 w-full">
          <h2 className="font-display font-bold">
            {printable ? 'The name on your certificates' : 'What name should your certificate carry?'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            {printable
              ? 'This is printed on every certificate you earn, and shown to anyone who checks one.'
              : 'We only have your email address, and that is not a name to print. Type your full name as you would like it to read.'}
          </p>

          <form
            className="mt-3 flex flex-wrap items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (problem) return;
              setServerSaid(null);
              save.mutate({ data: { name: value.trim() } });
            }}
          >
            <div className="flex-1 min-w-[12rem]">
              <Input
                value={value}
                onChange={(e) => { setValue(e.target.value); setServerSaid(null); }}
                maxLength={MAX_LEARNER_NAME}
                placeholder="Your full name"
                aria-label="The name to print on your certificate"
                aria-invalid={Boolean(showProblem)}
                autoFocus
              />
              {(showProblem || serverSaid) && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">{showProblem ?? serverSaid}</p>
              )}
            </div>
            <Button type="submit" disabled={Boolean(problem) || save.isPending} className="font-bold">
              {save.isPending ? 'Saving…' : <><Check className="w-4 h-4 mr-1.5" aria-hidden />Save</>}
            </Button>
            {printable && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setOpen(false); setServerSaid(null); }}
              >
                Cancel
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
