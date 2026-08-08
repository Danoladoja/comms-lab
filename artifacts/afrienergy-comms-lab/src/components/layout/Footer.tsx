import { Link } from 'wouter';
import { Zap, Twitter, Linkedin, Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-sidebar border-t border-sidebar-border text-sidebar-foreground pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground transform transition-transform group-hover:scale-105 group-hover:rotate-3 shadow-sm">
                <Zap size={18} className="fill-current" />
              </div>
              <span className="font-display font-bold text-lg tracking-tight">
                Afrienergy
              </span>
            </Link>
            <p className="text-sm text-sidebar-foreground/70 mb-6 leading-relaxed">
              Empowering the next generation of African leaders, builders, and innovators with world-class education tailored for our context.
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
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Platform</h4>
            <ul className="space-y-3">
              <li><Link href="/courses" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Course Catalog</Link></li>
              <li><Link href="/live-sessions" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Live Sessions</Link></li>
              <li><Link href="/dashboard" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Learner Dashboard</Link></li>
              <li><Link href="/instructor" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">For Instructors</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Categories</h4>
            <ul className="space-y-3">
              <li><Link href="/courses?cat=Technology" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Technology</Link></li>
              <li><Link href="/courses?cat=Energy" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Energy</Link></li>
              <li><Link href="/courses?cat=Business" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Business</Link></li>
              <li><Link href="/courses?cat=Communications" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Communications</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sidebar-foreground">Company</h4>
            <ul className="space-y-3">
              <li><a href="#" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">About Us</a></li>
              <li><a href="#" className="text-sm text-sidebar-foreground/70 hover:text-primary transition-colors">Careers</a></li>
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
