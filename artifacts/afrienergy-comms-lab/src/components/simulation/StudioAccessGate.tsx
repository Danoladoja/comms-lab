import { type ReactNode, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudioAccessQueryKey, useGetStudioAccess, useRedeemStudioAccess } from '@workspace/api-client-react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { StudioLayout } from './StudioLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';

export function StudioAccessGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const access = useGetStudioAccess({
    query: { queryKey: getGetStudioAccessQueryKey(), retry: false },
  });
  const redeem = useRedeemStudioAccess();

  if (access.isLoading) {
    return (
      <StudioLayout>
        <div className="flex flex-1 items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 text-[#f97316]"
          >
            <Loader2 className="h-10 w-10 animate-spin" />
            <span className="font-display font-bold uppercase tracking-[0.2em] text-[10px]">Verifying Clearance...</span>
          </motion.div>
        </div>
      </StudioLayout>
    );
  }

  if (access.data?.allowed) return <>{children}</>;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    redeem.mutate(
      { data: { code } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getGetStudioAccessQueryKey() });
        },
        onError: () => setMessage('Authorization rejected. Invalid or expired code.'),
      },
    );
  };

  return (
    <StudioLayout>
      <div className="flex flex-1 items-center justify-center p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.1),transparent_40%)] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="bg-[#030811]/80 backdrop-blur-xl border border-white/10 p-10 shadow-2xl relative overflow-hidden">
            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#f97316]" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#f97316]" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#f97316]" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#f97316]" />

            <div className="text-center mb-8">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-none border border-[#f97316]/30 bg-[#f97316]/5 text-[#f97316]">
                <LockKeyhole className="h-6 w-6" />
              </div>
              <h1 className="font-display text-2xl font-bold uppercase tracking-[0.1em] text-white mb-2">Restricted Access</h1>
              <p className="text-[11px] font-mono text-white/50 uppercase tracking-widest">
                Enter your clearance code to proceed
              </p>
            </div>

            <form onSubmit={submit} className="space-y-6">
              <div className="space-y-2">
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="one-time-code"
                  className="h-14 border-white/20 bg-[#07111e]/50 text-center font-mono tracking-[0.3em] text-xl text-white placeholder:text-white/20 focus-visible:ring-1 focus-visible:ring-[#f97316] rounded-none"
                  minLength={6}
                  maxLength={32}
                  required
                />
                {message && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-[10px] font-mono text-red-400 mt-2 uppercase tracking-wider">
                    {message}
                  </motion.p>
                )}
                {access.isError && !message && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-[10px] font-mono text-red-400 mt-2 uppercase tracking-wider">
                    System offline. Cannot verify clearance.
                  </motion.p>
                )}
              </div>
              <Button
                type="submit"
                disabled={redeem.isPending || code.trim().length < 6}
                className="w-full h-12 bg-[#f97316] font-bold text-[#030811] hover:bg-[#ea6d0a] rounded-none uppercase tracking-[0.15em] text-xs transition-all active:scale-[0.98]"
              >
                {redeem.isPending ? <Loader2 className="mr-3 h-4 w-4 animate-spin" /> : <KeyRound className="mr-3 h-4 w-4" />}
                {redeem.isPending ? "Authenticating..." : "Authorize"}
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    </StudioLayout>
  );
}
