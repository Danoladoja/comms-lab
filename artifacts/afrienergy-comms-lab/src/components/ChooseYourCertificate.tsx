import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSetMyCertificateFinish,
  getGetMeQueryKey,
  getListMyCertificatesQueryKey,
} from '@workspace/api-client-react';
import { CERTIFICATE_FINISHES, type CertificateFinish } from '@workspace/domain';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import CertificateView, { type CertificateLike } from '@/components/CertificateView';

const LABEL: Record<CertificateFinish, { title: string; note: string }> = {
  clay: { title: 'Clay', note: 'Deep rust. Bolder on a screen and on a wall.' },
  cream: { title: 'Cream', note: 'Near-white. Far kinder to a home printer.' },
};

/**
 * The step between earning a certificate and downloading one.
 *
 * Both finishes are drawn with this learner's real name, programme and date —
 * not a sample — because the thing being checked is as much the details as the
 * colour. A certificate is the one document the Lab issues that somebody else
 * reads years later, and the last chance to catch a misspelt name is before
 * it is downloaded, not after.
 *
 * There is no default. The column behind this starts null, and the download
 * stays closed until one of these is pressed, which is what makes this a step
 * somebody takes rather than a preference they never find.
 */
export default function ChooseYourCertificate(
  { cert, onChosen }: { cert: CertificateLike; onChosen?: () => void },
) {
  const queryClient = useQueryClient();
  const [pressed, setPressed] = useState<CertificateFinish | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const choose = useSetMyCertificateFinish({
    mutation: {
      onSuccess: () => {
        setFailed(null);
        // The certificate list carries the finish, so it is stale the moment
        // this is written. Without this the learner presses a sheet and the
        // page carries on showing them the chooser.
        void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListMyCertificatesQueryKey() });
        onChosen?.();
      },
      onError: (err) => {
        setPressed(null);
        const body = (err as { response?: { data?: { error?: string } } }).response?.data;
        setFailed(body?.error ?? 'That could not be saved. Try again in a moment.');
      },
    },
  });

  return (
    <div className="w-full">
      <h2 className="text-xl font-display font-bold text-[#F4F0E8]">Check it over, then pick a finish</h2>
      <p className="text-sm text-[#F4F0E8]/70 mt-1 max-w-2xl">
        This is your certificate, with your own details on it. Read the name carefully — it is what
        anyone who checks your certificate will see. Then choose the sheet you would like it printed on.
      </p>

      {failed && (
        <p className="text-sm text-amber-300 mt-3" role="alert">{failed}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2 mt-6">
        {CERTIFICATE_FINISHES.map((finish) => (
          <div key={finish}>
            {/*
              The real component at a smaller width, not a picture of it. The
              sheet is a container query, so it lays out identically at any
              size — which means what is being chosen here is exactly what gets
              downloaded, down to the line breaks.
            */}
            <div className="rounded-xl overflow-hidden shadow-xl ring-1 ring-white/10">
              <CertificateView cert={cert} finish={finish} />
            </div>
            <div className="flex items-center justify-between gap-3 mt-3">
              <div className="min-w-0">
                <p className="font-display font-bold text-[#F4F0E8]">{LABEL[finish].title}</p>
                <p className="text-xs text-[#F4F0E8]/60">{LABEL[finish].note}</p>
              </div>
              <Button
                className="font-bold shrink-0"
                disabled={choose.isPending}
                onClick={() => {
                  setPressed(finish);
                  setFailed(null);
                  choose.mutate({ data: { finish } });
                }}
              >
                {choose.isPending && pressed === finish
                  ? 'Saving…'
                  : <><Check className="w-4 h-4 mr-1.5" aria-hidden />Use this one</>}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#F4F0E8]/50 mt-6">
        You can change your mind later — this sets the finish for every certificate you hold.
      </p>
    </div>
  );
}
