import { Link, useParams } from 'wouter';
import { useListMyCertificates } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Download, Home, Award } from 'lucide-react';

function formatDate(iso: string | null) {
  if (!iso) return 'Date to be confirmed';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A single earned certificate, printable via the browser's print-to-PDF. */
export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const programId = Number(params.id);
  const { data: certificates = [], isLoading } = useListMyCertificates();
  const cert = certificates.find(c => c.programId === programId);

  if (isLoading) {
    return <div className="min-h-screen bg-[#07111E] p-12"><div className="max-w-4xl mx-auto aspect-[1.414] bg-white/5 rounded-2xl animate-pulse" /></div>;
  }

  if (!cert) {
    return (
      <div className="min-h-screen bg-[#07111E] text-[#F4F0E8] flex flex-col items-center justify-center text-center px-4">
        <Award className="w-10 h-10 text-[#F4F0E8]/40 mb-3" />
        <h1 className="text-2xl font-display font-bold mb-2">Certificate not available</h1>
        <p className="text-sm text-[#F4F0E8]/70 mb-6 max-w-md">
          This certificate is issued once every module of the program is completed. Keep going, you are closer than you think.
        </p>
        <Button asChild variant="outline" className="bg-transparent border-white/20 text-[#F4F0E8] hover:bg-white/10">
          <Link href="/dashboard"><Home className="w-4 h-4 mr-2" />Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07111E] py-10 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="flex justify-between items-center mb-8 print:hidden">
          <Button variant="ghost" asChild className="text-[#F4F0E8]/70 hover:text-white hover:bg-white/10">
            <Link href="/certificates"><Home className="w-4 h-4 mr-2" />My certificates</Link>
          </Button>
          <Button onClick={() => window.print()} className="font-bold">
            <Download className="w-4 h-4 mr-2" />Download PDF
          </Button>
        </div>

        {/* The certificate itself (A4 landscape-ish) */}
        <div className="w-full max-w-[960px] mx-auto aspect-[1.414] bg-[#F4F0E8] text-[#07111E] rounded-lg shadow-2xl p-8 md:p-14 relative overflow-hidden flex flex-col justify-between print:shadow-none print:rounded-none">
          <div className="absolute top-0 left-0 w-28 h-28 border-t-8 border-l-8 border-[#F97316] rounded-tl-lg" />
          <div className="absolute bottom-0 right-0 w-28 h-28 border-b-8 border-r-8 border-[#F97316] rounded-br-lg" />

          <div className="text-center space-y-3 relative z-10">
            <p className="font-display font-bold text-xl tracking-tight">Afrienergy Comms Lab</p>
            <h1 className="text-3xl md:text-5xl font-display font-bold text-[#C2410C] uppercase tracking-widest">Certificate of Completion</h1>
            <p className="text-[#5B6470] uppercase tracking-widest text-xs">This is to certify that</p>
          </div>

          <div className="text-center relative z-10 py-4">
            <div className="text-4xl md:text-6xl font-display font-bold border-b-2 border-[#07111E]/20 inline-block px-10 pb-3 mb-5">
              {cert.learnerName}
            </div>
            <p className="text-[#5B6470]">has successfully completed all modules of</p>
            <h2 className="text-xl md:text-2xl font-bold mt-3">{cert.programTitle}</h2>
          </div>

          <div className="flex justify-between items-end relative z-10 pt-6">
            <div className="text-center">
              <div className="text-sm border-b border-[#07111E]/30 pb-1.5 px-6 mb-1.5 font-semibold">{formatDate(cert.completedAt as unknown as string | null)}</div>
              <p className="text-[10px] uppercase tracking-wider text-[#5B6470] font-bold">Date of completion</p>
            </div>
            <div className="w-20 h-20 rounded-full border-4 border-[#F97316] flex items-center justify-center bg-white shadow-sm">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#C2410C] text-center leading-tight">Comms<br />Lab<br />Verified</span>
            </div>
            <div className="text-center">
              <div className="text-sm border-b border-[#07111E]/30 pb-1.5 px-6 mb-1.5 font-mono">{cert.certificateId}</div>
              <p className="text-[10px] uppercase tracking-wider text-[#5B6470] font-bold">Certificate ID</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
