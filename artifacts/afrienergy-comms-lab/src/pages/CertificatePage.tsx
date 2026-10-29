import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useListMyCertificates, useListPendingCertificates } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Download, Home, Award, Link2, Check, Linkedin } from 'lucide-react';
import CertificateView from '@/components/CertificateView';
import NameOnYourCertificate from '@/components/NameOnYourCertificate';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function publicVerifyUrl(certificateId: string) {
  return `${window.location.origin}${basePath}/verify/${certificateId}`;
}

/** A single earned certificate, printable via the browser's print-to-PDF. */
export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const programId = Number(params.id);
  const { data: certificates = [], isLoading } = useListMyCertificates();
  /*
    Why it is not here, when it is not here. Arriving at this page from a
    bookmark and being told to go and finish the modules — when every module is
    finished and the hold is a survey, a capstone or a missing name — is the
    same fault the pending route was written to end, and this page still had it.
  */
  const { data: pending = [] } = useListPendingCertificates();
  const cert = certificates.find(c => c.programId === programId);
  const held = pending.find(p => p.programId === programId);
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return <div className="min-h-screen bg-[#07111E] p-12"><div className="max-w-4xl mx-auto aspect-[1.414] bg-white/5 rounded-2xl animate-pulse" /></div>;
  }

  if (!cert) {
    return (
      <div className="min-h-screen bg-[#07111E] text-[#F4F0E8] flex flex-col items-center justify-center text-center px-4">
        <Award className="w-10 h-10 text-[#F4F0E8]/40 mb-3" />
        <h1 className="text-2xl font-display font-bold mb-2">
          {held ? 'Nearly there' : 'Certificate not available'}
        </h1>
        <p className="text-sm text-[#F4F0E8]/70 mb-6 max-w-md">
          {held?.waitingOn
            ?? 'This certificate is issued once every module of the program is completed. Keep going, you are closer than you think.'}
        </p>
        {held?.nameOutstanding && (
          <div className="text-left w-full max-w-xl mb-6 [&_.text-muted-foreground]:text-[#F4F0E8]/70">
            <NameOnYourCertificate />
          </div>
        )}
        <Button asChild variant="outline" className="bg-transparent border-white/20 text-[#F4F0E8] hover:bg-white/10">
          <Link href={held ? '/certificates' : '/dashboard'}>
            <Home className="w-4 h-4 mr-2" />{held ? 'My certificates' : 'Back to dashboard'}
          </Link>
        </Button>
      </div>
    );
  }

  const verifyUrl = publicVerifyUrl(cert.certificateId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy your public verification link:', verifyUrl);
    }
  };

  const shareOnLinkedIn = () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-[#07111E] py-10 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 mb-8 print:hidden">
          <Button variant="ghost" asChild className="text-[#F4F0E8]/70 hover:text-white hover:bg-white/10">
            <Link href="/certificates"><Home className="w-4 h-4 mr-2" />My certificates</Link>
          </Button>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={copyLink}
              className="bg-transparent border-white/20 text-[#F4F0E8] hover:bg-white/10 hover:text-white"
            >
              {copied ? <Check className="w-4 h-4 mr-2 text-emerald-400" /> : <Link2 className="w-4 h-4 mr-2" />}
              {copied ? 'Link copied' : 'Copy public link'}
            </Button>
            <Button
              onClick={shareOnLinkedIn}
              className="bg-[#0A66C2] hover:bg-[#0A66C2]/90 text-white font-bold"
            >
              <Linkedin className="w-4 h-4 mr-2" />Share on LinkedIn
            </Button>
            <Button onClick={() => window.print()} className="font-bold">
              <Download className="w-4 h-4 mr-2" />Download PDF
            </Button>
          </div>
        </div>

        <CertificateView cert={cert} />

        <p className="text-center text-xs text-[#F4F0E8]/50 mt-6 print:hidden">
          Anyone with your public link can verify this certificate — no sign-in needed.
        </p>
      </div>
    </div>
  );
}
