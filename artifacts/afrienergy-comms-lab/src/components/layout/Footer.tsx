import { Link } from 'wouter';
import { Zap, Twitter, Linkedin, Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-footer border-t border-border text-footer-foreground pt-20 pb-12">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-6 group inline-flex">
              <div className="w-8 h-8 bg-primary flex items-center justify-center text-primary-foreground">
                <Zap size={16} className="fill-current" />
              </div>
              <span className="font-serif text-xl tracking-tight text-white group-hover:opacity-80 transition-opacity">
                Afrienergy Comms Lab
              </span>
            </Link>
            <p className="text-sm text-white/50 mb-8 leading-relaxed max-w-sm font-medium">
              Powering Africa's Energy Leaders. We exist to build the minds that will drive the continent's energy transition, sustainable infrastructure, and policy advocacy.
            </p>
          </div>

          <div>
            <h4 className="font-serif text-lg mb-6 text-white">Hub</h4>
            <ul className="space-y-4">
              <li><Link href="/courses" className="text-sm text-white/50 hover:text-white transition-colors">Programs</Link></li>
              <li><Link href="/live-sessions" className="text-sm text-white/50 hover:text-white transition-colors">Live Sessions</Link></li>
              <li><Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors">Community</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-serif text-lg mb-6 text-white">Organisation</h4>
            <ul className="space-y-4">
              <li><a href="#about" className="text-sm text-white/50 hover:text-white transition-colors">About</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-white transition-colors">Partnerships</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-white transition-colors">Terms of Service</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-sm text-white/40">
            &copy; {new Date().getFullYear()} Afrienergy Comms Lab. All rights reserved.
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-white/40 hover:text-white transition-colors">
              <Twitter size={18} />
            </a>
            <a href="#" className="text-white/40 hover:text-white transition-colors">
              <Linkedin size={18} />
            </a>
            <a href="#" className="text-white/40 hover:text-white transition-colors">
              <Github size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
