import { ReactNode } from 'react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Navbar />
      {/*
        Clears the fixed header, which is as tall as the logo plus its padding:
        40 + 40 on a phone, 48 + 40 from md up. This has to move whenever the
        logo height does, or the first thing on every page slides underneath it.
      */}
      <main className="flex-1 pt-20 md:pt-[88px]">
        {children}
      </main>
      <Footer />
    </div>
  );
}
