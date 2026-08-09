import { Link, useParams } from 'wouter';
import { useVerifyCertificate, getVerifyCertificateQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { BadgeCheck, ShieldX, Home } from 'lucide-react';
import CertificateView from '@/components/CertificateView';

/** Public, read-only verification page for a certificate ID. No sign-in required. */
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
        <ShieldX className="w-10 h-10 text-red-400/80 mb-3" />
        <h1 className="text-2xl font-display font-bold mb-2">Certificate not verified</h1>
        <p className="text-sm text-[#F4F0E8]/70 mb-6 max-w-md">
          We could not find a valid certificate with the ID <span className="font-mono">{certificateId}</span>.
          Check the link or ID and try again.
        </p>
        <Button asChild variant="outline" className="bg-transparent border-white/20 text-[#F4F0E8] hover:bg-white/10">
          <Link href="/"><Home className="w-4 h-4 mr-2" />Afrienergy Comms Lab</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07111E] py-10 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mb-8">
          <Button variant="ghost" asChild className="text-[#F4F0E8]/70 hover:text-white hover:bg-white/10">
            <Link href="/"><Home className="w-4 h-4 mr-2" />Afrienergy Comms Lab</Link>
          </Button>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 px-4 py-1.5 text-sm font-bold">
            <BadgeCheck className="w-4 h-4" />
            Verified certificate
          </div>
        </div>

        <CertificateView cert={cert} />

        <p className="text-center text-xs text-[#F4F0E8]/50 mt-6 max-w-xl mx-auto">
          This certificate was issued by Afrienergy Comms Lab and verified against our records.
          Certificate ID <span className="font-mono">{cert.certificateId}</span>.
        </p>
      </div>
    </div>
  );
}
