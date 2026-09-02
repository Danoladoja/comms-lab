import { Link } from 'wouter';
import { Twitter, Linkedin, Github } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Footer() {
  return (
    <footer className="bg-sidebar border-t border-sidebar-border text-sidebar-foreground pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2">
            {/* The all-white lockup: the footer is near-black, where the deep
                green of the coloured mark would all but disappear. */}
            <Link href="/" className="mb-5 flex items-center" aria-label="Ananse Comms Lab — home">
              <img
                src={`${basePath}/logo-white.png`}
                alt="Ananse Comms Lab"
                width={456}
                height={160}
                className="h-11 w-auto"
              />
            </Link>
            <p className="text-sm text-sidebar-foreground/70 mb-6 leading-relaxed max-w-sm">
              Powering Africa's Energy Leaders. We exist to build the minds that will drive the continent's energy transition, sustainable infrastructure, and policy advocacy.
            </p>
            <div className="flex gap-4">
              <a href="#" className="text-sidebar-foreground/50 hover:text-primary transition-colors">
                <Twitter size={20} />
              </a>
              <a href="#" className="text-sidebar-foreground/50 hover:text-primary transition-colors">
                <Linkedin size={20} />
              </a>
              <a href="#" className="text-sidebar-foreground/50 hover:text-primary transition-colors">
                <Github size={20} />
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Hub</h4>
            <ul className="space-y-3">
              <li><Link href="/courses" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Programmes</Link></li>
              <li><Link href="/live-sessions" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Live Sessions</Link></li>
              <li><Link href="/dashboard" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Community</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Organisation</h4>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">About</Link></li>
              <li><Link href="/partnerships" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Partnerships</Link></li>
              <li><Link href="/privacy" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-sidebar-border text-center text-sm text-sidebar-foreground/50">
          <p>&copy; {new Date().getFullYear()} Ananse Comms Lab. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
