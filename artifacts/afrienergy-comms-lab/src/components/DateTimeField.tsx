import { CalendarClock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * One date-and-time box for the whole Lab.
 *
 * This started as a private component inside the coursework editor and got
 * copied, badly, everywhere else that needed a moment in time — a bare input
 * here, a date-only box there, each with its own idea of what an empty value
 * means and none of them saying what the admin had just chosen. The Studio's
 * expiry was a date with no hour at all, silently assuming midnight, which is
 * how "use it by Friday" quietly became "use it by Friday night".
 *
 * So: one control, three parts, in every place a moment is set.
 *
 *   - A single box that takes the day and the hour together. Browsers give
 *     this a calendar and a clock for free, in the reader's own locale.
 *   - A Clear button, because empty has to be reachable. For most of these
 *     fields empty is the *normal* state, and a field you can fill but not
 *     unfill is a trap.
 *   - A line underneath saying what has actually been chosen, worded in the
 *     reader's own clock. The browser is the only place that knows what time
 *     it is where they are sitting: the same instant is Friday at five in
 *     Lagos and Friday at six in Nairobi, and wording it on the server shows
 *     half a cohort somebody else's Friday.
 *
 * The value is the browser's own `datetime-local` format, not an ISO instant.
 * Converting is the caller's job, through `dueDateInputValue` and
 * `dueDateFromInput`, which do it by the clock rather than by slicing
 * characters off a string — the trick that shows a Lagos admin a London
 * deadline and lets neither of them notice until somebody misses it.
 */
export default function DateTimeField({
  id, label, value, onChange, summary, tone = 'light', min, disabled = false,
}: {
  id: string;
  label: string;
  /** The date-and-time box's own format, or '' for none. */
  value: string;
  onChange: (next: string) => void;
  /** What has been chosen, in words. Shown under the box. */
  summary: string;
  /** 'dark' for the Studio's panels, which are not on the app's light surface. */
  tone?: 'light' | 'dark';
  /** Earliest allowed moment, in the box's own format. */
  min?: string;
  disabled?: boolean;
}) {
  const dark = tone === 'dark';
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        dark ? 'border-white/15 bg-white/[0.02]' : 'border-border bg-background',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className={cn('flex items-center gap-1.5 text-xs font-medium', dark && 'text-white/70')}
        >
          <CalendarClock
            className={cn('h-3.5 w-3.5', dark ? 'text-[#f97316]' : 'text-muted-foreground')}
            aria-hidden
          />
          {label}
        </label>
        <Input
          id={id}
          type="datetime-local"
          value={value}
          min={min}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-8 w-auto text-sm',
            dark && 'bg-[#030811] border-white/20 text-white rounded-none',
          )}
        />
        {value && !disabled && (
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8', dark ? 'text-white/50 hover:text-white' : 'text-muted-foreground')}
            onClick={() => onChange('')}
          >
            Clear
          </Button>
        )}
      </div>
      <p className={cn('mt-1.5 text-xs', dark ? 'text-white/45' : 'text-muted-foreground')}>
        {summary}
      </p>
    </div>
  );
}
