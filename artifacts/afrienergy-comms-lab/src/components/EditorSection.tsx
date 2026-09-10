import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Loader, X } from 'lucide-react';

/**
 * One section of a module, open for editing.
 *
 * Every editable part of a module used to behave slightly differently. Some
 * opened and never shut. Some had a Save that left the form exactly as it was,
 * so people pressed it twice or wandered off unsure. None of them had a way out
 * that did not involve scrolling back up to the header you came in through.
 *
 * So all of them now share this: a header you press to open, **Save and close**
 * as the way out when you have changed something, and **Close** when you have
 * not. Nothing in here posts anything to anybody — posting is one button, once,
 * at the bottom of the module.
 */
export function EditorSection({ title, hint, open, onToggle, children }: {
  title: string;
  /** What is inside, readable without opening it. */
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}

/**
 * The two ways out of an open section.
 *
 * "Save and close" only saves; it never posts. It closes on a *successful*
 * save, never on the click — a section that shut early would hide a save that
 * then failed, and somebody would walk away from lost work.
 *
 * "Close" asks first when there is unsaved work, because the alternative is
 * losing a pasted transcript to a mis-aimed click and having no way back.
 */
export function SaveAndClose({ onSave, onClose, saving, disabled, dirty, saveLabel = 'Save and close' }: {
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
  /** Nothing worth saving yet — a blank form, or a row that is not filled in. */
  disabled?: boolean;
  /** Something has been typed that is not saved. */
  dirty?: boolean;
  saveLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={disabled || saving} onClick={onSave}>
        {saving
          ? <><Loader className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />Saving…</>
          : saveLabel}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => {
          if (dirty && !confirm('Close without saving? What you have typed here will be lost.')) return;
          onClose();
        }}
      >
        <X className="mr-1.5 h-4 w-4" aria-hidden />
        Close
      </Button>
      {dirty && (
        <span className="text-xs text-muted-foreground">Not saved yet.</span>
      )}
    </div>
  );
}
