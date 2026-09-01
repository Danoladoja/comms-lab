import { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function StudioLayout({ children, backTo }: { children: ReactNode; backTo?: string }) {
  return (
    <div className="min-h-[100dvh] surface-ink text-white flex flex-col font-sans selection:bg-[#f97316] selection:text-[#07111e]">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between shrink-0 bg-[#07111e] z-10 relative shadow-sm">
        <div className="flex items-center gap-6">
          <Link href="/studio" className="group rounded outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]" aria-label="Simulation Studio">
            <img
              src={`${basePath}/logo-mark.png`}
              alt=""
              width={148}
              height={160}
              className="h-10 w-auto group-hover:scale-105 transition-transform"
            />
          </Link>
          
          {backTo && (
            <Link href={backTo} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white transition-colors ml-4 pl-4 border-l border-white/10 outline-none focus-visible:text-white">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          )}
        </div>
        
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link href="/dashboard" className="text-white/60 hover:text-white transition-colors outline-none focus-visible:text-white">
            Exit Studio
          </Link>
        </nav>
      </header>
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,0.05),transparent_50%)]">
        <div className="noise-bg absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay"></div>
        {children}
      </main>
    </div>
  );
}
