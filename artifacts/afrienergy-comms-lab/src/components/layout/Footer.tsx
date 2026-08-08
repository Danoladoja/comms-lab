import { Link } from 'wouter';
import { Twitter, Linkedin, Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-sidebar border-t border-sidebar-border text-sidebar-foreground pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center mb-4">
              <span className="font-display font-bold text-lg tracking-tight">
                Afrienergy Comms Lab
              </span>
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
            <ul className="space-y-3 mb-6">
              <li><Link href="/courses" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Programs</Link></li>
              <li><Link href="/live-sessions" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Live Sessions</Link></li>
              <li><Link href="/dashboard" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Community</Link></li>
            </ul>
            <div className="pt-5 border-t border-sidebar-border">
              <p className="text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/50 mb-3">Community of Practice</p>
              <p className="text-xs text-sidebar-foreground/60 leading-relaxed mb-3">
                A cohort-based learning community for energy communicators, advocates, and policy strategists — cohort-based, cross-sector, and Africa-wide.
              </p>
              <ul className="space-y-1.5">
                <li className="text-xs text-sidebar-foreground/50">Cohort-based peer learning</li>
                <li className="text-xs text-sidebar-foreground/50">Government · Civil society · Private sector</li>
                <li className="text-xs text-sidebar-foreground/50">Open to practitioners across Africa</li>
              </ul>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Organisation</h4>
            <ul className="space-y-3">
              <li><a href="#about" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">About</a></li>
              <li><a href="#" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Partnerships</a></li>
              <li><a href="#" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Terms of Service</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-sidebar-border text-center text-sm text-sidebar-foreground/50">
          <p>&copy; {new Date().getFullYear()} Afrienergy Comms Lab. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
