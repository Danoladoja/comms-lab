import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Menu, X, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useClerk } from '@clerk/react';
import { satisfiesRole } from '@workspace/domain';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { signOut } = useClerk();
  const { isSignedIn, user, role } = useCurrentUser();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Programmes', href: '/courses' },
    { label: 'Live Classes', href: '/live-sessions' },
    ...(isSignedIn ? [{ label: 'Simulation Studio', href: '/studio' }] : []),
    { label: 'About', href: '/about' },
  ];

  const accountLinks = [
    { label: 'My Learning', href: '/dashboard', show: true },
    { label: 'Simulation Studio', href: '/studio', show: true },
    { label: 'Recordings', href: '/recordings', show: true },
    { label: 'My Certificates', href: '/certificates', show: true },
    { label: 'Teaching', href: '/teach', show: satisfiesRole(role, ['instructor', 'admin']) },
    { label: 'Admin Console', href: '/admin', show: satisfiesRole(role, ['admin']) },
  ].filter((l) => l.show);

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
          {/* The full lockup at every width. Dropping to the mark alone on a
              phone meant the site never said its own name on the screen most
              first-time visitors arrive on, which is the one place it matters
              most. It fits: at 40px tall the lockup is about 114px wide, well
              inside the room a phone header has beside a menu button.
              Width and height are declared so the header does not jolt while
              the image loads. */}
          <Link href="/" className="flex items-center group" aria-label="Ananse Comms Lab — home">
            <img
              src={`${basePath}/logo.png`}
              alt="Ananse Comms Lab"
              width={456}
              height={160}
              className="h-10 w-auto md:h-12"
            />
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
              {isSignedIn ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full">
                      <User className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="truncate">{user?.name || user?.email || 'My Account'}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {accountLinks.map((l) => (
                      <DropdownMenuItem key={l.href} onClick={() => setLocation(l.href)}>
                        {l.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || '/' })}>
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                    Sign in
                  </Link>
                  <Button asChild className="rounded-full font-bold px-6 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                    <Link href="/waitlist">Join the waitlist</Link>
                  </Button>
                </>
              )}
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
          {isSignedIn ? (
            <>
              {accountLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-lg font-medium px-4 py-2 hover:bg-muted rounded-md"
                >
                  {l.label}
                </Link>
              ))}
              <button
                onClick={() => { setMobileMenuOpen(false); signOut({ redirectUrl: basePath || '/' }); }}
                className="text-lg font-medium px-4 py-2 text-left hover:bg-muted rounded-md"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/waitlist"
                onClick={() => setMobileMenuOpen(false)}
                className="text-lg font-medium px-4 py-2 bg-primary text-primary-foreground text-center rounded-md"
              >
                Join the waitlist
              </Link>
              <Link
                href="/sign-in"
                onClick={() => setMobileMenuOpen(false)}
                className="text-lg font-medium px-4 py-2 hover:bg-muted rounded-md"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
