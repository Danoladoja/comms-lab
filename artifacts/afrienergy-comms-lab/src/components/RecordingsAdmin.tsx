import { useQueryClient } from '@tanstack/react-query';
import {
  useGetGoogleConnection, useDisconnectGoogle,
  useListRecordingStatus, useSyncRecordingsNow,
  getGetGoogleConnectionQueryKey, getListRecordingStatusQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  CircleCheck, CircleAlert, Loader, RefreshCw, Link2, Unlink, Clock, PlayCircle,
} from 'lucide-react';

/**
 * Recordings: connecting the Google account, and seeing what the transfer has
 * managed on its own.
 *
 * The point of this screen is that nobody has to wonder. Once the account is
 * connected the job copies each finished class from Meet to YouTube by itself,
 * and every row here says plainly where that has got to — including when it has
 * given up and a person needs to step in.
 */

function statusChip(status: string, hasRecording: boolean) {
  if (hasRecording && status === 'manual') {
    return { label: 'Added by hand', tone: 'bg-muted text-muted-foreground', icon: Link2 };
  }
  switch (status) {
    case 'ready':
      return { label: 'Published', tone: 'bg-emerald-100 text-emerald-900', icon: CircleCheck };
    case 'uploading':
      return { label: 'Uploading', tone: 'bg-amber-100 text-amber-900', icon: Loader };
    case 'searching':
      return { label: 'Waiting for Meet', tone: 'bg-amber-100 text-amber-900', icon: Clock };
    case 'failed':
      return { label: 'Needs attention', tone: 'bg-red-100 text-red-900', icon: CircleAlert };
    default:
      return { label: 'Queued', tone: 'bg-muted text-muted-foreground', icon: Clock };
  }
}

function formatWhen(iso: string | null) {
  if (!iso) return 'Unscheduled';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export default function RecordingsAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: connection, isLoading: loadingConnection } = useGetGoogleConnection({
    query: { queryKey: getGetGoogleConnectionQueryKey() },
  });
  const { data: rows = [], isLoading: loadingRows } = useListRecordingStatus({
    query: {
      queryKey: getListRecordingStatusQueryKey(),
      // While something is uploading the page is worth refreshing on its own.
      refetchInterval: 30_000,
    },
  });

  const disconnectGoogle = useDisconnectGoogle({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Google account disconnected', description: 'Recordings will no longer transfer automatically.' });
        qc.invalidateQueries({ queryKey: getGetGoogleConnectionQueryKey() });
      },
    },
  });

  const syncNow = useSyncRecordingsNow({
    mutation: {
      onSuccess: () => toast({
        title: 'Checking for recordings',
        description: 'This runs in the background. Refresh in a few minutes.',
      }),
      onError: () => toast({ title: 'Could not start the check', variant: 'destructive' }),
    },
  });

  const needsAttention = rows.filter(r => r.status === 'failed');

  return (
    <div className="space-y-8">
      {/* ---- The Google account ---- */}
      <section className="bg-card border border-border rounded-2xl p-6 max-w-3xl">
        <h2 className="font-display font-bold mb-1">Google account</h2>
        <p className="text-sm text-muted-foreground mb-5">
          The account that holds your Meet recordings and owns the YouTube channel. Once connected, each finished
          class is copied to YouTube as an unlisted video and appears in the classroom on its own.
        </p>

        {loadingConnection ? (
          <div className="h-10 bg-muted/40 rounded-lg animate-pulse" />
        ) : !connection?.secretConfigured || !connection?.configured ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-semibold text-amber-900 flex items-center gap-2 mb-1">
              <CircleAlert className="w-4 h-4" aria-hidden />Not set up on the server yet
            </p>
            <p className="text-sm text-amber-900/80">
              Ask whoever manages the deployment to add{' '}
              {!connection?.configured && <code className="text-xs">GOOGLE_CLIENT_ID</code>}
              {!connection?.configured && ', '}
              {!connection?.configured && <code className="text-xs">GOOGLE_CLIENT_SECRET</code>}
              {!connection?.configured && ', '}
              {!connection?.configured && <code className="text-xs">GOOGLE_REDIRECT_URI</code>}
              {!connection?.configured && !connection?.secretConfigured && ' and '}
              {!connection?.secretConfigured && <code className="text-xs">GOOGLE_TOKEN_SECRET</code>}
              . Until then recordings must be pasted in by hand, which still works.
            </p>
          </div>
        ) : connection.connected ? (
          <div className="space-y-4">
            <p className="text-sm flex items-center gap-2">
              <CircleCheck className="w-4 h-4 text-emerald-600" aria-hidden />
              Connected as <span className="font-semibold">{connection.googleEmail}</span>
            </p>
            {connection.lastError && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4">
                <p className="font-semibold text-red-900 flex items-center gap-2 mb-1">
                  <CircleAlert className="w-4 h-4" aria-hidden />Google refused the connection
                </p>
                <p className="text-sm text-red-900/80 mb-2">{connection.lastError}</p>
                <p className="text-sm text-red-900/80">Reconnect the account to start transfers again.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={syncNow.isPending}
                onClick={() => syncNow.mutate()}
              >
                <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />Check for recordings now
              </Button>
              {connection.authorizeUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={connection.authorizeUrl}>
                    <Link2 className="w-4 h-4 mr-1.5" aria-hidden />Reconnect
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={disconnectGoogle.isPending}
                onClick={() => disconnectGoogle.mutate()}
              >
                <Unlink className="w-4 h-4 mr-1.5" aria-hidden />Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              No account connected. Recordings have to be pasted in by hand until one is.
            </p>
            {connection.authorizeUrl && (
              <Button asChild className="font-semibold">
                <a href={connection.authorizeUrl}>
                  <Link2 className="w-4 h-4 mr-1.5" aria-hidden />Connect Google account
                </a>
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ---- Per-class status ---- */}
      <section className="max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display font-bold">Past classes</h2>
          {needsAttention.length > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-900">
              {needsAttention.length} need{needsAttention.length === 1 ? 's' : ''} attention
            </span>
          )}
        </div>

        {loadingRows ? (
          <div className="h-32 bg-card border border-border rounded-2xl animate-pulse" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground bg-card border border-border rounded-2xl p-6">
            No classes have taken place yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map(row => {
              const chip = statusChip(row.status, !!row.recordingUrl);
              const Icon = chip.icon;
              return (
                <li key={row.sessionId} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-widest text-[#C2410C] font-medium mb-0.5">
                        {row.programTitle}
                      </p>
                      <h3 className="font-semibold text-sm">{row.sessionTitle}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatWhen(row.startsAt as unknown as string | null)}
                        {row.attempts > 0 && row.status !== 'ready' && ` · ${row.attempts} attempt${row.attempts === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 flex-shrink-0 ${chip.tone}`}>
                      <Icon className="w-3.5 h-3.5" aria-hidden />{chip.label}
                    </span>
                  </div>

                  {!row.hasMeetUrl && row.status !== 'ready' && !row.recordingUrl && (
                    <p className="text-xs text-muted-foreground mt-2">
                      No meeting room was set for this class, so there is nothing to fetch. Paste a recording link on
                      the session instead.
                    </p>
                  )}

                  {row.status === 'failed' && row.error && (
                    <p className="text-xs text-red-800 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {row.error}
                    </p>
                  )}

                  {row.recordingUrl && (
                    <a
                      href={row.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary inline-flex items-center gap-1.5 mt-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      <PlayCircle className="w-3.5 h-3.5" aria-hidden />Watch the replay
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
