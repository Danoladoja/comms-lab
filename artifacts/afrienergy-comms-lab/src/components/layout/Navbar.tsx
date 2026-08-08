import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Menu, X, User } from 'lucide-react';
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
    { label: 'About', href: '/about' },
  ];

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b',
        isScrolled
          ? 'bg-background/90 backdrop-blur-md border-border py-3 shadow-sm'
          : 'bg-background border-transparent py-5'
      )}
    >
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center group">
            <span className="font-display font-bold text-lg tracking-tight text-foreground hidden sm:block">
              Afrienergy Comms Lab
            </span>
            <span className="font-display font-bold text-lg tracking-tight text-foreground sm:hidden">
              Afrienergy
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "text-sm font-medium transition-colors hover:text-primary",
                    location === link.href ? "text-primary font-semibold" : "text-muted-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-4 border-l border-border pl-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <User className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocation('/dashboard')}>
                    Learner Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/instructor')}>
                    Instructor Dashboard
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button asChild className="rounded-full font-bold px-6 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                <Link href="/register">Register Interest</Link>
              </Button>
            </div>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-background border-b border-border shadow-lg py-4 px-4 flex flex-col gap-4 animate-in slide-in-from-top-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="text-lg font-medium px-4 py-2 hover:bg-muted rounded-md"
            >
              {link.label}
            </Link>
          ))}
          <div className="h-px bg-border my-2" />
          <Link
            href="/register"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-2 bg-primary text-primary-foreground text-center rounded-md"
          >
            Register Interest
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-2 hover:bg-muted rounded-md"
          >
            Learner Dashboard
          </Link>
          <Link
            href="/instructor"
            onClick={() => setMobileMenuOpen(false)}
            className="text-lg font-medium px-4 py-2 hover:bg-muted rounded-md"
          >
            Instructor Dashboard
          </Link>
        </div>
      )}
    </header>
  );
}
