import { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, LogOut } from 'lucide-react';
import { MotionConfig } from 'framer-motion';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function StudioLayout({ children, backTo }: { children: ReactNode; backTo?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-[#030811] text-white flex flex-col font-sans selection:bg-[#f97316] selection:text-[#030811]">
      <header className="border-b border-white/5 px-6 h-[60px] flex items-center justify-between shrink-0 bg-[#030811]/95 backdrop-blur-md z-50 relative">
        <div className="flex items-center gap-6 h-full">
          <Link href="/studio" className="group rounded outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] flex items-center h-full" aria-label="Simulation Studio">
            <img
              src={`${basePath}/logo-mark.png`}
              alt=""
              className="h-7 w-auto object-contain transition-transform brightness-0 invert opacity-90 group-hover:opacity-100"
            />
          </Link>

          {backTo && (
            <div className="h-6 w-px bg-white/10" />
          )}
          {backTo && (
            <Link href={backTo} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 hover:text-[#f97316] transition-colors outline-none focus-visible:text-[#f97316]">
              <ArrowLeft className="w-3.5 h-3.5" />
              Return
            </Link>
          )}
        </div>

        <nav className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-[10px] text-white/50 hover:text-white transition-colors outline-none focus-visible:text-white font-bold uppercase tracking-[0.15em]">
            <span>Leave the Studio</span>
            <LogOut className="w-3 h-3" />
          </Link>
        </nav>
      </header>
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.03),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(249,115,22,0.03),transparent_50%)]">
        <div className="noise-bg absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"></div>
        {children}
      </main>
    </div>
    </MotionConfig>
  );
}
