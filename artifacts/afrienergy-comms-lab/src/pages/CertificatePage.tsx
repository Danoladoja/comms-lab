import { Button } from '@/components/ui/button';
import { Download, Linkedin, Link as LinkIcon, Home } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export default function CertificatePage() {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const handleDownload = () => {
    setIsDownloading(true);
    setTimeout(() => {
      setIsDownloading(false);
      toast({
        title: "Download Started",
        description: "Your certificate is downloading as a PDF.",
      });
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground py-12 px-4 flex flex-col">
      <div className="container mx-auto max-w-5xl flex-1 flex flex-col">
        
        {/* Header Actions */}
        <div className="flex justify-between items-center mb-8">
          <Button variant="ghost" asChild className="text-sidebar-foreground/70 hover:text-white hover:bg-white/10">
            <Link href="/dashboard"><Home className="w-4 h-4 mr-2" /> Back to Dashboard</Link>
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" className="bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-white/5" onClick={handleDownload} disabled={isDownloading}>
              <Download className="w-4 h-4 mr-2" /> {isDownloading ? 'Generating...' : 'Download PDF'}
            </Button>
            <Button className="bg-[#0077b5] text-white hover:bg-[#0077b5]/90 border-none shadow-none">
              <Linkedin className="w-4 h-4 mr-2" /> Share
            </Button>
          </div>
        </div>

        {/* Certificate Rendering Area */}
        <div className="flex-1 flex items-center justify-center p-4 md:p-8 bg-black/20 rounded-3xl border border-sidebar-border overflow-hidden relative">
          {/* THE CERTIFICATE (Designed for A4 Landscape roughly) */}
          <div className="w-full max-w-[900px] aspect-[1.414] bg-[#f8f5f0] text-gray-900 rounded-lg shadow-2xl p-8 md:p-16 relative overflow-hidden flex flex-col justify-between" id="certificate-node">
            
            {/* Decorative Corners */}
            <div className="absolute top-0 left-0 w-32 h-32 border-t-8 border-l-8 border-[#d4af37] rounded-tl-lg"></div>
            <div className="absolute bottom-0 right-0 w-32 h-32 border-b-8 border-r-8 border-[#d4af37] rounded-br-lg"></div>
            <div className="absolute -right-32 -top-32 w-96 h-96 bg-[#1a362d]/5 rounded-full blur-3xl pointer-events-none"></div>

            {/* Header */}
            <div className="text-center space-y-4 relative z-10">
              <div className="flex justify-center mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded bg-[#d4af37] flex items-center justify-center text-white font-bold">
                    A
                  </div>
                  <span className="font-display font-bold text-2xl tracking-tight text-[#1a1a1a]">
                    Afrienergy
                  </span>
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-serif text-[#1a362d] uppercase tracking-widest">Certificate of Completion</h1>
              <p className="text-gray-500 uppercase tracking-widest text-sm">This is to certify that</p>
            </div>

            {/* Recipient */}
            <div className="text-center relative z-10 py-6">
              <div className="text-5xl md:text-7xl font-display font-bold text-[#d4af37] border-b-2 border-gray-300 inline-block px-12 pb-4 mb-6">
                Student Name
              </div>
              <p className="text-gray-600 text-lg">has successfully completed the requirements for</p>
              <h2 className="text-2xl md:text-3xl font-bold mt-4 text-[#1a1a1a]">Strategic Leadership for Scaling Startups</h2>
            </div>

            {/* Footer / Signatures */}
            <div className="flex justify-between items-end relative z-10 pt-8">
              <div className="text-center">
                <div className="font-serif italic text-2xl border-b border-gray-400 pb-2 px-8 mb-2">S. Adeyemi</div>
                <p className="text-xs uppercase tracking-wider text-gray-500 font-bold">Sarah Adeyemi</p>
                <p className="text-xs text-gray-400">Lead Instructor</p>
              </div>

              <div className="text-center">
                <div className="w-24 h-24 rounded-full border-4 border-[#d4af37] flex items-center justify-center mx-auto mb-4 bg-white shadow-sm">
                  <div className="text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-[#1a362d]">Verified</span>
                    <span className="block text-xl font-bold text-[#d4af37]">2025</span>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <div className="text-lg font-mono border-b border-gray-400 pb-2 px-8 mb-2">October 24, 2025</div>
                <p className="text-xs uppercase tracking-wider text-gray-500 font-bold">Date of Issuance</p>
                <p className="text-xs text-gray-400">ID: AE-2025-8X9PQ</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
