import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetGoogleConnection, useDisconnectGoogle,
  useListRecordingStatus, useSyncRecordingsNow,
  useCheckGoogleHoldings, getCheckGoogleHoldingsQueryKey,
  useFetchTranscriptFromGoogle,
  getGetGoogleConnectionQueryKey, getListRecordingStatusQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import ReplayPlayer from '@/components/ReplayPlayer';
import { apiReason } from '@workspace/domain';
import {
  CircleCheck, CircleAlert, Loader, RefreshCw, Link2, Unlink, Clock, PlayCircle, ChevronUp,
  FileText, FileDown, Search,
} from 'lucide-react';

/**
 * Recordings: which past classes still need one, and optionally letting Google
 * do the work.
 *
 * The screen leads with what a person has to do, because for now a person does
 * it: upload to YouTube, paste the link. Automatic transfers sit underneath as
 * an optional extra. When they are switched on the same list reports where each
 * transfer has got to instead — including when it has given up.
 *
 * A class with no recording is the state that actually holds learners up, so it
 * is never left to be inferred.
 */

/**
 * Asking Google what it holds for one class.
 *
 * Read-only, and said so on the button, because this is the first thing anybody
 * points at a live cohort's records and the first question is always whether it
 * can break anything. It cannot: every call behind it is a read.
 *
 * It exists ahead of the automation it informs. A Meet transcript exists only
 * if somebody started one or an administrator turned transcription on for the
 * whole domain, and neither fact is visible from inside the Lab — so building
 * the fetch first would mean building it against a folder that might be empty,
 * where "found nothing" and "broken" look identical from here.
 */
function GoogleHoldingsCheck({ sessionId }: { sessionId: number }) {
  const [asked, setAsked] = useState(false);
  /** What the fetch said, kept on screen rather than shown as a toast that slides away. */
  const [imported, setImported] = useState<string | null>(null);
  const fetchIt = useFetchTranscriptFromGoogle({
    mutation: {
      onSuccess: (r) => setImported(r.note),
      onError: (err) => setImported(apiReason(err, 'The transcript could not be fetched.')),
    },
  });
  const { data, isLoading, error } = useCheckGoogleHoldings(sessionId, {
    // Nothing happens until the admin asks. Checking every class on every page
    // load would be dozens of calls to Google to answer a question nobody put.
    query: {
      queryKey: getCheckGoogleHoldingsQueryKey(sessionId),
      enabled: asked, retry: false, staleTime: 60_000,
    },
  });

  if (!asked) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 h-7 px-2 text-xs font-semibold text-primary"
        onClick={() => setAsked(true)}
      >
        <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />What does Google have for this class?
      </Button>
    );
  }

  if (isLoading) {
    return <p className="mt-2 text-xs text-muted-foreground">Asking Google…</p>;
  }

  if (error) {
    return (
      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {apiReason(error, 'Google could not be asked about this class.')}
      </p>
    );
  }

  if (!data) return null;

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
      data.ready
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-border bg-muted/30 text-muted-foreground'
    }`}>
      <p className="font-medium">{data.headline}</p>
      <p className="mt-1">{data.advice}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {data.transcriptUrl && (
          <a
            className="inline-flex items-center font-medium underline underline-offset-2"
            href={data.transcriptUrl}
            target="_blank"
            rel="noreferrer"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden />Open the transcript in Google Docs
          </a>
        )}
        {/* Only where there is a finished transcript to fetch. From here on
            this happens by itself an hour after each class; the button is for
            the ones that finished before any of that existed. */}
        {data.transcriptsReady > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={fetchIt.isPending}
            onClick={() => fetchIt.mutate({ id: sessionId })}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {fetchIt.isPending ? 'Fetching…' : 'Put it in the class material'}
          </Button>
        )}
      </div>

      {imported && (
        <p className="mt-2 rounded border border-border bg-background/70 px-2 py-1.5">{imported}</p>
      )}

      <p className="mt-2 text-[11px] opacity-70">
        Asking Google changes nothing. Fetching fills the class material box, and never replaces
        anything already in it.
      </p>
    </div>
  );
}

function statusChip(status: string, hasRecording: boolean, automationOn: boolean) {
  // With no Google account connected nothing is in flight, so there are only
  // two honest states: there is a recording, or there is not.
  if (!automationOn) {
    return hasRecording
      ? { label: 'Has recording', tone: 'bg-emerald-100 text-emerald-900', icon: CircleCheck }
      : { label: 'Needs recording', tone: 'bg-amber-100 text-amber-900', icon: CircleAlert };
  }
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
  // One replay open at a time. Checking recordings is a job you work down a
  // list doing, and half a dozen videos loaded at once is a lot of nothing.
  const [playing, setPlaying] = useState<number | null>(null);

  /**
   * What Google's sign-in came back saying.
   *
   * The callback used to land here with a bare `?google=error` and log the real
   * reason where only somebody reading the server logs could find it — which is
   * nobody, at the moment it happens, having just spent twenty minutes on the
   * setup. Every one of these has a different next step, so each gets said.
   */
  const params = new URLSearchParams(window.location.search);
  const googleResult = params.get('google');
  const why = params.get('why') ?? '';
  const whyFailed = ({
    'no-code': 'Google sent us back without a sign-in code. Start the connection again.',
    expired: 'The connection took too long, or the server restarted part-way through. Nothing is wrong — press Connect and go straight through it.',
    'not-configured': 'The four Google settings are not all on the server. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GOOGLE_TOKEN_SECRET in Railway.',
    'no-refresh-token': 'Google did not hand over a lasting key, which happens when this app was approved before. Remove it at myaccount.google.com → Data & privacy → Third-party apps, then connect again.',
    // Google's own words, each with the one place it is fixed. These four look
    // identical from the outside — the same red screen at the same moment — and
    // are repaired in four different places, so guessing between them is how an
    // afternoon disappears.
    redirect_uri_mismatch: 'The return address does not match. In Google Cloud → Credentials → your OAuth client, the "Authorised redirect URI" must be exactly the address shown below — same https, same spelling, no trailing slash. Google can take a few minutes to apply a change there.',
    invalid_client: 'Google does not recognise the client id or secret. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway against Google Cloud → Credentials. A secret copied with a stray space at either end fails exactly like this.',
    invalid_grant: 'The sign-in code had already been used or had expired. Press Connect and go straight through without going back or refreshing.',
    unauthorized_client: 'This OAuth client is not allowed to do this. It usually means the client was created as the wrong type — it must be a "Web application" client, not Desktop or Android.',
    'exchange-failed': 'Google refused the exchange without saying why. Nearly always the return address: GOOGLE_REDIRECT_URI in Railway must match the one in Google Cloud exactly — same https, same spelling, no trailing slash.',
  } as Record<string, string>)[why] ?? 'Something went wrong signing in to Google. Try again.';

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

  const automationOn = !!connection?.connected;
  const needsAttention = automationOn
    ? rows.filter(r => r.status === 'failed')
    : rows.filter(r => !r.recordingUrl);

  return (
    <div className="space-y-8">
      {/* How this works right now, in one sentence, before any detail. */}
      {!loadingConnection && !automationOn && (
        <section className="rounded-2xl border border-border bg-card p-6 max-w-3xl">
          <h2 className="font-display font-bold mb-1">Adding recordings</h2>
          <p className="text-sm text-muted-foreground">
            Recordings are added by hand at the moment. After a class: download it, upload it to YouTube as{' '}
            <strong>unlisted</strong>, then paste the link on the session under{' '}
            <strong>Programmes → the programme → the module → Recording link</strong>.
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            The list below shows which classes are still waiting for one. A class with no recording blocks anyone
            who missed it live from finishing that module.
          </p>
        </section>
      )}

      {/* ---- Past classes: what still needs doing ---- */}
      <section className="max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display font-bold">Past classes</h2>
          {needsAttention.length > 0 && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              automationOn ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'
            }`}>
              {needsAttention.length} still need{needsAttention.length === 1 ? 's' : ''} a recording
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
              const chip = statusChip(row.status, !!row.recordingUrl, automationOn);
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

                  {automationOn && !row.hasMeetUrl && row.status !== 'ready' && !row.recordingUrl && (
                    <p className="text-xs text-muted-foreground mt-2">
                      No meeting room was set for this class, so there is nothing to fetch. Paste a recording link on
                      the session instead.
                    </p>
                  )}

                  {!automationOn && !row.recordingUrl && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Add it under Programmes → {row.programTitle} → {row.sessionTitle}.
                    </p>
                  )}

                  {row.status === 'failed' && row.error && (
                    <p className="text-xs text-red-800 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {row.error}
                    </p>
                  )}

                  {/* Only worth offering once Google is connected and the class
                      has a room to ask about. */}
                  {automationOn && row.hasMeetUrl && (
                    <GoogleHoldingsCheck sessionId={row.sessionId} />
                  )}

                  {/*
                    This used to open YouTube in a new tab, which took the admin
                    out of the console and lost the list they were working
                    through. It plays here now, and shuts again where it opened.
                  */}
                  {row.recordingUrl && (
                    <div className="mt-2 space-y-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs font-semibold text-primary"
                        aria-expanded={playing === row.sessionId}
                        onClick={() => setPlaying(playing === row.sessionId ? null : row.sessionId)}
                      >
                        {playing === row.sessionId
                          ? <><ChevronUp className="mr-1.5 h-3.5 w-3.5" aria-hidden />Hide the replay</>
                          : <><PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />Watch the replay</>}
                      </Button>
                      {playing === row.sessionId && (
                        <ReplayPlayer
                          recordingUrl={row.recordingUrl}
                          title={`${row.sessionTitle} recording`}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-card border border-border rounded-2xl p-6 max-w-3xl">
        <h2 className="font-display font-bold mb-1">
          Google connection
        </h2>

        {googleResult === 'error' && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-900 flex items-center gap-2 mb-1">
              <CircleAlert className="w-4 h-4" aria-hidden />Google did not finish connecting
            </p>
            <p className="text-sm text-red-900/80">{whyFailed}</p>

            {/* The address this server actually uses, printed so it can be held
                against the one in Google Cloud by eye. It is the single value
                that has to match character for character, and describing it in
                a sentence has already cost more time than showing it. */}
            {connection?.redirectUri && (
              <div className="mt-3 rounded-lg bg-white/70 border border-red-200 p-3">
                <p className="text-xs font-semibold text-red-900 mb-1">
                  This server's return address — paste this into Google Cloud exactly:
                </p>
                <code className="text-xs break-all text-red-900">{connection.redirectUri}</code>
              </div>
            )}

            {/* Google's own code, for the cases nobody has written a remedy for
                yet. Unhelpful on its own, but it is the thing worth quoting. */}
            {why && (
              <p className="text-xs text-red-900/60 mt-3">
                Google's own words for this: <code className="text-xs">{why}</code>
              </p>
            )}
          </div>
        )}

        {googleResult === 'connected' && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-900">Google connected.</p>
          </div>
        )}
        <p className="text-sm text-muted-foreground mb-5">
          Two things run off this. Each finished class is copied from Meet to YouTube and published by itself — and
          attendance is read from Google's own record of who was in the room, so it no longer depends on a learner
          having this site open during the class. Pasting recording links by hand keeps working either way; attendance
          does not, because there is nothing to paste. Setup takes about twenty minutes and is written up in{' '}
          <code className="text-xs">docs/google-setup.md</code>.
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
              . Until then, recordings must be pasted in by hand — that still works — but attendance cannot be read
              from Google at all, and only counts for learners who had this site open during the class.
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
            {/* Shown before the attempt as well as after it. Checking one line
                against Google Cloud takes a few seconds; discovering the
                mismatch at the last step of the flow takes an afternoon. */}
            {connection.redirectUri && (
              <p className="text-xs text-muted-foreground mt-4">
                Google Cloud → Credentials → your OAuth client must list this exact address under
                {' '}<strong>Authorised redirect URIs</strong>:{' '}
                <code className="text-xs break-all">{connection.redirectUri}</code>
              </p>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
