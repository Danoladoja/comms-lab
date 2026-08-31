import { Link, useParams } from 'wouter';
import { useVerifyCertificate, getVerifyCertificateQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { BadgeCheck, ShieldX, Home, FileText, MessagesSquare } from 'lucide-react';
import CertificateView, { formatCertDate } from '@/components/CertificateView';

/**
 * Public, read-only verification. No sign-in.
 *
 * A certificate on its own is a claim; the work underneath it is evidence. When
 * the learner has published their portfolio this page shows what they actually
 * made — which is the thing that gets someone commissioned.
 */
export default function VerifyCertificatePage() {
  const params = useParams<{ certificateId: string }>();
  const certificateId = params.certificateId ?? '';
  const { data: cert, isLoading, isError } = useVerifyCertificate(certificateId, {
    query: { retry: false, queryKey: getVerifyCertificateQueryKey(certificateId) },
  });

  if (isLoading) {
    return <div className="min-h-screen bg-[#07111E] p-12"><div className="max-w-4xl mx-auto aspect-[1.414] bg-white/5 rounded-2xl animate-pulse" /></div>;
  }

  if (isError || !cert) {
    return (
      <div className="min-h-screen bg-[#07111E] text-[#F4F0E8] flex flex-col items-center justify-center text-center px-4">
        <ShieldX className="w-10 h-10 text-red-400/80 mb-3" aria-hidden />
        <h1 className="text-2xl font-display font-bold mb-2">Certificate not verified</h1>
        <p className="text-sm text-[#F4F0E8]/80 mb-6 max-w-md">
          We could not find a valid certificate with the ID <span className="font-mono">{certificateId}</span>.
          Check the link or ID and try again.
        </p>
        <Button asChild variant="outline" className="bg-transparent border-white/25 text-[#F4F0E8] hover:bg-white/10">
          <Link href="/"><Home className="w-4 h-4 mr-2" aria-hidden />Ananse Comms Lab</Link>
        </Button>
      </div>
    );
  }

  const works = cert.works ?? [];

  return (
    <div className="min-h-screen bg-[#07111E] py-10 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mb-8">
          <Button variant="ghost" asChild className="text-[#F4F0E8]/80 hover:text-white hover:bg-white/10">
            <Link href="/"><Home className="w-4 h-4 mr-2" aria-hidden />Ananse Comms Lab</Link>
          </Button>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 px-4 py-1.5 text-sm font-bold">
            <BadgeCheck className="w-4 h-4" aria-hidden />
            Verified certificate
          </div>
        </div>

        <CertificateView cert={cert} />

        <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 mt-8 text-sm text-[#F4F0E8]/80">
          <span className="inline-flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#F97316]" aria-hidden />
            {cert.modulesCompleted} module{cert.modulesCompleted === 1 ? '' : 's'} completed
          </span>
          <span className="inline-flex items-center gap-2">
            <MessagesSquare className="w-4 h-4 text-[#F97316]" aria-hidden />
            {cert.reviewsWritten} peer critique{cert.reviewsWritten === 1 ? '' : 's'} written
          </span>
        </div>

        {works.length > 0 && (
          <section className="mt-14" aria-labelledby="portfolio-heading">
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-[0.35em] text-[#F97316] mb-3">The work</p>
              <h2 id="portfolio-heading" className="text-2xl md:text-3xl font-display font-bold text-[#F4F0E8]">
                What {cert.learnerName.split(' ')[0]} made
              </h2>
              <p className="text-sm text-[#F4F0E8]/70 mt-2 max-w-lg mx-auto">
                Published by the learner. Every piece was filed to a deadline and critiqued by peers against a rubric.
              </p>
            </div>

            <div className="space-y-5">
              {works.map((work, i) => (
                <article
                  key={`${work.title}-${i}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8"
                >
                  <header className="mb-4">
                    <p className="font-mono text-xs text-[#F97316] mb-2">{String(i + 1).padStart(2, '0')}</p>
                    <h3 className="font-display font-bold text-lg md:text-xl text-[#F4F0E8]">{work.title}</h3>
                    <p className="text-xs text-[#F4F0E8]/60 mt-1">
                      Filed {formatCertDate(work.submittedAt as unknown as string)}
                    </p>
                  </header>
                  <p className="text-sm md:text-base leading-relaxed text-[#F4F0E8]/85 whitespace-pre-wrap">
                    {work.body}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-xs text-[#F4F0E8]/60 mt-10 max-w-xl mx-auto">
          Issued by Ananse Comms Lab and verified against our records.
          Certificate ID <span className="font-mono">{cert.certificateId}</span>.
        </p>
      </div>
    </div>
  );
}
