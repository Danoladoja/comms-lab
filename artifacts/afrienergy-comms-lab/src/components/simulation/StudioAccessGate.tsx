import { type ReactNode, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetStudioAccessQueryKey,
  useGetStudioAccess,
  useRedeemStudioAccess,
} from '@workspace/api-client-react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { StudioLayout } from './StudioLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
          <Loader2 className="h-8 w-8 animate-spin text-[#f97316]" aria-label="Checking Studio access" />
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
        onError: () => setMessage('That code is invalid or has already been used.'),
      },
    );
  };

  return (
    <StudioLayout>
      <div className="container mx-auto flex flex-1 items-center justify-center px-6 py-16">
        <Card className="w-full max-w-lg border-white/10 bg-[#0c1929] text-white shadow-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#f97316]/15 text-[#f97316]">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <CardTitle className="font-display text-2xl">Simulation Studio</CardTitle>
            <CardDescription className="text-white/60">
              Studio access is by invitation. If an admin gave you a one-time access code, enter it below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="Enter Studio access code"
                autoComplete="one-time-code"
                className="border-white/20 bg-[#07111e] text-center font-mono tracking-[0.2em] text-white"
                minLength={6}
                maxLength={32}
                required
              />
              {message && <p className="text-center text-sm text-red-300">{message}</p>}
              {access.isError && (
                <p className="text-center text-sm text-red-300">Studio access could not be checked. Please try again.</p>
              )}
              <Button
                type="submit"
                disabled={redeem.isPending || code.trim().length < 6}
                className="w-full bg-[#f97316] font-bold text-[#07111e] hover:bg-[#ea6d0a]"
              >
                {redeem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                Unlock Studio
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </StudioLayout>
  );
}