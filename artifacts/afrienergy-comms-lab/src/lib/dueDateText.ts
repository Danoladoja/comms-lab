import { dueState } from '@workspace/domain';

/**
 * Putting a deadline into words, in the reader's own clock.
 *
 * This lives in the browser rather than in the shared rules because only the
 * browser knows what time it is where the reader is sitting. A deadline is a
 * wall-clock moment — "Friday at five" — and the same instant is Friday at five
 * in Lagos and Friday at six in Nairobi. Wording it on the server would show
 * half a cohort somebody else's Friday.
 *
 * Whether the deadline has *passed* is not decided here. That answer comes from
 * the server, which has one clock the whole Lab agrees on.
 */
export function formatDeadline(dueAt: string | null | undefined): string {
  if (!dueAt) return '';
  const when = new Date(dueAt);
  if (!Number.isFinite(when.getTime())) return '';
  return when.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The line a learner reads above the submit button. */
export function deadlineNotice(dueAt: string | null | undefined, closed: boolean): string {
  if (!dueAt) return '';
  const when = formatDeadline(dueAt);
  if (!when) return '';
  if (closed) return `Closed — the deadline was ${when}.`;
  return dueState(dueAt, Date.now()) === 'closing-soon'
    ? `Due ${when} — that is soon.`
    : `Due by ${when}.`;
}

/** The line an admin reads beside the date box. */
export function deadlineSummary(dueAt: string | null | undefined): string {
  const when = formatDeadline(dueAt);
  if (!when) return 'No deadline — open until you set one.';
  return dueState(dueAt, Date.now()) === 'closed'
    ? `Closed since ${when}. Clear or move this date to let people back in.`
    : `Closes ${when}.`;
}
