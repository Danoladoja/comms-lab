import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * What to show when the Lab could not be reached.
 *
 * Every screen used to treat a failed request as an empty answer and say so
 * with total confidence: "No programs yet — reserve a place to get started",
 * "No certificates yet", "Peer critique is not set up for this module",
 * "Facilitators only". A learner on a dropped line was told their enrolment,
 * their certificate or their teaching role did not exist.
 *
 * For a cohort on intermittent power and mobile data that is not a rare edge —
 * it is Tuesday. So a failure now says it is a failure, and offers the one
 * thing that usually fixes it.
 */
export function CouldNotLoad({ what, onRetry, compact = false }: {
  /** What could not be fetched, in the learner's words: "your programmes". */
  what: string;
  onRetry?: () => void;
  /** For inline panels rather than a whole page. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>We could not load {what}. This is usually the connection, not your work.</span>
        </p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-8 text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="mb-1 font-display font-bold">We could not load {what}</p>
      <p className="mx-auto mb-4 max-w-sm text-sm text-muted-foreground">
        Nothing has been lost. This is almost always the connection — try again in a moment.
      </p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />Try again
        </Button>
      )}
    </div>
  );
}
