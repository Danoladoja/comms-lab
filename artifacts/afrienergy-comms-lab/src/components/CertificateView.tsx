import type { Certificate } from '@workspace/api-client-react';

export function formatCertDate(iso: string | null) {
  if (!iso) return 'Date to be confirmed';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Read-only render of a certificate (A4 landscape-ish), shared by the learner and public verification pages. */
export default function CertificateView({ cert }: { cert: Certificate }) {
  return (
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
          <div className="text-sm border-b border-[#07111E]/30 pb-1.5 px-6 mb-1.5 font-semibold">{formatCertDate(cert.completedAt as unknown as string | null)}</div>
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
  );
}
