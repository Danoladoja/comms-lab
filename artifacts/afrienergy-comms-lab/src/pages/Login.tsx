import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Mail, Lock, ArrowRight } from 'lucide-react';

export default function Login() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-3xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-500">
        <div className="p-8 md:p-10 space-y-8">
          
          <div className="flex flex-col items-center text-center space-y-4">
            <Link href="/" className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground transform transition-transform hover:scale-105 shadow-md">
              <Zap size={24} className="fill-current" />
            </Link>
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground">Welcome Back</h1>
              <p className="text-muted-foreground mt-2">Sign in to continue your progress.</p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); window.location.href='/dashboard'; }}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="email" type="email" placeholder="sarah@example.com" required className="pl-10 bg-background" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password">Password</Label>
                  <a href="#" className="text-xs font-medium text-primary hover:underline">Forgot password?</a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="password" type="password" placeholder="••••••••" required className="pl-10 bg-background" />
                </div>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full h-12 text-base font-bold shadow-lg shadow-primary/20">
              Sign In <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>

          <div className="text-center text-sm">
            <span className="text-muted-foreground">Don't have an account? </span>
            <Link href="/register" className="font-bold text-primary hover:underline">
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
