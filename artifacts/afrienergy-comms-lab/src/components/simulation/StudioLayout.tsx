import { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, LogOut } from 'lucide-react';
import { MotionConfig } from 'framer-motion';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function StudioLayout({ children, backTo }: { children: ReactNode; backTo?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-[#030811] text-white flex flex-col font-sans selection:bg-[#f97316] selection:text-[#030811]">
      {/*
        The masthead. The Lab's wordmark, then the name of the part of it you
        are in, which is how the rest of the site reads and how a screenshot of
        this ends up making sense to somebody who was not in the room.

        logo-white.png rather than the small mark run through a filter: it is
        already white, so it stays sharp, and it says Ananse Comms Lab in type
        rather than leaving the brand to a symbol nobody has learnt yet.
      */}
      <header className="border-b border-white/5 px-4 sm:px-6 h-[72px] flex items-center justify-between shrink-0 bg-[#030811]/95 backdrop-blur-md z-50 relative">
        <div className="flex items-center gap-4 sm:gap-5 h-full min-w-0">
          <Link
            href="/studio"
            className="group flex items-center gap-4 sm:gap-5 h-full rounded outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] min-w-0"
            aria-label="Ananse Comms Lab Simulation Studio"
          >
            <img
              src={`${basePath}/logo-white.png`}
              alt="Ananse Comms Lab"
              className="h-9 sm:h-10 w-auto object-contain opacity-95 group-hover:opacity-100 transition-opacity shrink-0"
            />
            <span className="h-7 w-px bg-white/15 shrink-0" aria-hidden />
            <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white/90 group-hover:text-white transition-colors truncate">
              Simulation Studio
            </span>
          </Link>

          {backTo && (
            <>
              <span className="hidden md:block h-6 w-px bg-white/10 shrink-0" aria-hidden />
              <Link href={backTo} className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 hover:text-[#f97316] transition-colors outline-none focus-visible:text-[#f97316] shrink-0">
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
                Back
              </Link>
            </>
          )}
        </div>

        <nav className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-[10px] text-white/50 hover:text-white transition-colors outline-none focus-visible:text-white font-bold uppercase tracking-[0.15em]">
            <span className="hidden sm:inline">Leave the Studio</span>
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
