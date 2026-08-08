import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Zap, Menu, X, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Programs', href: '/courses' },
    { label: 'Live Sessions', href: '/live-sessions' },
    { label: 'About', href: '#about' },
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-500 border-b',
        isScrolled
          ? 'bg-background/95 backdrop-blur-md border-border py-4 shadow-sm'
          : 'bg-transparent border-transparent py-6'
      )}
    >
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 bg-primary flex items-center justify-center text-primary-foreground">
              <Zap size={20} className="fill-current" />
            </div>
            <span className={cn(
              "font-serif text-2xl tracking-tight hidden sm:block transition-colors duration-300",
              isScrolled ? "text-foreground" : "text-white"
            )}>
              Afrienergy Comms Lab
            </span>
            <span className={cn(
              "font-serif text-2xl tracking-tight sm:hidden transition-colors duration-300",
              isScrolled ? "text-foreground" : "text-white"
            )}>
              Afrienergy
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "text-sm font-medium transition-colors hover:opacity-70",
                    isScrolled ? "text-foreground" : "text-white",
                    location === link.href ? "opacity-100 border-b border-current pb-0.5" : "opacity-80"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-4 border-l border-border/30 pl-8">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className={cn(
                    "rounded-none transition-colors",
                    isScrolled ? "text-foreground hover:bg-muted" : "text-white hover:bg-white/10"
                  )}>
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-none">
                  <DropdownMenuLabel className="font-serif">My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocation('/dashboard')} className="rounded-none cursor-pointer">
                    Learner Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/instructor')} className="rounded-none cursor-pointer">
                    Instructor Dashboard
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button asChild className="rounded-none font-medium px-6 bg-primary text-primary-foreground hover:bg-primary/90 shadow-none border border-transparent">
                <Link href="/register">Register Interest</Link>
              </Button>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            className={cn(
              "md:hidden p-2 transition-colors",
              isScrolled ? "text-foreground" : "text-white"
            )}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border shadow-xl py-6 px-6 flex flex-col gap-6 animate-in slide-in-from-top-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="text-lg font-serif px-2 py-2 hover:bg-muted text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <div className="h-px bg-border my-2" />
          <Link
            href="/register"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-3 bg-primary text-primary-foreground text-center"
          >
            Register Interest
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-3 border border-border text-center text-foreground hover:bg-muted"
          >
            Learner Dashboard
          </Link>
          <Link
            href="/instructor"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-3 border border-border text-center text-foreground hover:bg-muted"
          >
            Instructor Dashboard
          </Link>
        </div>
      )}
    </header>
  );
}
