import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Download, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The sheet a debrief is printed on.
 *
 * There are two debriefs in the Studio and there was only ever one design. The
 * individual one — an orange banner, a mark in a box, a bar for each thing that
 * was judged, strengths against vulnerabilities, numbered countermeasures, and
 * a print stylesheet that turns the whole thing into a PDF — was built first
 * and is what people expect a debrief from the Lab to look like. The cross-team
 * one was written later and rendered as headings and paragraphs: the same
 * material, no mark anywhere on it, and nothing to save. An admin could not
 * send it to anybody, and read side by side with a learner's it did not look
 * like it came from the same place.
 *
 * So the design lives here instead of in either screen, and both screens are
 * built from it. The point is not that it saves lines — it is that the next
 * change to the look of a debrief cannot land on one of them and miss the
 * other, which is exactly what happened.
 *
 * Printing: the sheet carries `data-print-root`, which the rules in index.css
 * key off — everything that is not the report comes off the page, the sheet
 * keeps its colours, and it stays in the document flow so a printer can break
 * it across as many sheets as it needs. `data-print-hide` takes the buttons off.
 */

export function ReportSheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-[#050b14] border border-[#f97316]/30 shadow-[0_0_40px_rgba(249,115,22,0.1)] relative overflow-hidden ${className}`}
      data-print-root
    >
      {children}
    </motion.div>
  );
}

/**
 * The banner, and the one number on it.
 *
 * `score` is optional and deliberately so. A room is not marked — each team in
 * it is — so the cross-team report passes the room's average and says it is an
 * average, and a report with no marks at all passes nothing and gets no box
 * rather than a box with a nought in it. A nought and an unwritten mark look
 * identical and mean opposite things.
 */
export function ReportBanner({ label, title, score, scoreLabel = 'Rating' }: {
  label: string;
  title: string;
  score?: number | null;
  scoreLabel?: string;
}) {
  return (
    <div className="bg-[#f97316] p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      <div>
        <div className="flex items-center gap-2 text-black/50 text-[10px] font-mono uppercase tracking-[0.2em] mb-2 font-bold">
          <Target className="w-3 h-3" /> {label}
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-black text-[#030811] uppercase tracking-tight">
          {title}
        </h2>
      </div>

      {typeof score === 'number' && (
        <div className="shrink-0 flex items-center justify-center w-24 h-24 bg-[#030811] border border-[#f97316]/20 relative">
          <div className="absolute inset-1 border border-[#f97316]/20" />
          <div className="text-center">
            <span className="block text-3xl font-mono text-[#f97316] leading-none">{score}</span>
            <span className="block text-[8px] uppercase tracking-widest text-white/50 mt-1">{scoreLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportBody({ children }: { children: ReactNode }) {
  return <div className="p-8 md:p-10 space-y-10">{children}</div>;
}

/**
 * A bar for each thing that was marked.
 *
 * A bar rather than a grade, so that the same name next time can visibly be
 * somewhere else. On the individual report each row is a dimension of the
 * scenario; on the cross-team one each row is a team, which is the only place
 * in the Lab where the teams' marks can be seen next to each other.
 */
export function ReportBars({ title, rows }: {
  title: string;
  rows: { name: string; score: number; note?: string; aside?: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-4">
      <h3 className="text-white font-bold uppercase tracking-widest text-sm flex items-center gap-2 border-b border-white/10 pb-2">
        <Target className="w-4 h-4 text-[#f97316]" aria-hidden /> {title}
      </h3>
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.name}>
            <div className="flex items-baseline justify-between gap-4 mb-1.5">
              <span className="text-white/90 text-sm font-semibold">
                {row.name}
                {row.aside && <span className="text-white/40 font-normal ml-2">{row.aside}</span>}
              </span>
              <span className="text-white/60 text-xs font-mono tabular-nums">{row.score}</span>
            </div>
            <div
              className="h-1.5 bg-white/10 overflow-hidden"
              role="img"
              aria-label={`${row.name}: ${row.score} out of 100`}
            >
              <div
                className="h-full bg-[#f97316]"
                data-print-keep
                style={{ width: `${Math.max(2, Math.min(100, row.score))}%` }}
              />
            </div>
            {row.note && <p className="text-white/50 text-xs mt-2 leading-relaxed">{row.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReportColumns({ children }: { children: ReactNode }) {
  return <div className="grid md:grid-cols-2 gap-10">{children}</div>;
}

/** What held up, or where it slipped. Green dot or red one; nothing else differs. */
export function ReportColumn({ title, tone, items }: {
  title: string;
  tone: 'good' | 'bad';
  items: string[];
}) {
  const dot = tone === 'good' ? 'bg-green-500' : 'bg-red-500';
  const chevron = tone === 'good' ? 'text-green-500' : 'text-red-500';
  return (
    <div className="space-y-5">
      <h3 className="text-white font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2 border-b border-white/10 pb-3">
        <span className={`w-1.5 h-1.5 ${dot} rounded-full`} /> {title}
      </h3>
      <ul className="space-y-4">
        {items.map((item, i) => (
          <li key={i} className="text-white/80 text-sm font-sans flex items-start gap-3">
            <ChevronRight className={`w-4 h-4 ${chevron} shrink-0 mt-0.5`} /> <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A boxed passage of prose, or a boxed list.
 *
 * `warn` is for the one thing the cross-team report has that no individual one
 * does: two teams who did not tell the same story. It is the whole reason the
 * cross-team read exists, so it is coloured like a finding rather than like
 * another paragraph.
 */
export function ReportPanel({ title, icon, tone = 'plain', children }: {
  title: string;
  icon?: ReactNode;
  tone?: 'plain' | 'warn';
  children: ReactNode;
}) {
  const box = tone === 'warn'
    ? 'bg-amber-400/[0.06] border-amber-400/30'
    : 'bg-white/[0.02] border-white/5';
  const heading = tone === 'warn' ? 'text-amber-300' : 'text-white';
  return (
    <div className={`space-y-4 border p-6 ${box}`}>
      <h3 className={`font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2 border-b border-white/10 pb-3 ${heading}`}>
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

export function ReportProse({ children }: { children: ReactNode }) {
  return <p className="text-white/90 text-sm leading-relaxed font-sans">{children}</p>;
}

/** The numbered block at the end: what to do about all of it. */
export function ReportActions({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-5">
      <h3 className="text-[#f97316] font-mono uppercase tracking-[0.2em] text-[10px] flex items-center gap-2">
        <Target className="w-3.5 h-3.5" /> {title}
      </h3>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="text-white/90 text-sm font-mono flex items-start gap-4 bg-[#030811] p-4 border border-[#f97316]/20">
            <span className="text-[#f97316] opacity-50">[{i + 1}]</span> <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Saving it.
 *
 * Every browser prints to PDF, so the work is in making the printed page a
 * proper report rather than in shipping a library that would do the same job
 * worse. The rules live in index.css and key off `data-print-root` above.
 */
export function SaveAsPdf({ children }: { children?: ReactNode }) {
  return (
    <>
      <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row gap-3" data-print-hide>
        <Button
          onClick={() => window.print()}
          variant="outline"
          className="sm:w-auto h-14 px-8 border-white/20 bg-transparent text-white hover:bg-white/5 font-bold uppercase tracking-[0.2em] text-[10px] rounded-none"
        >
          <Download className="w-4 h-4 mr-2" aria-hidden /> Save as PDF
        </Button>
        {children}
      </div>
      <p className="text-white/30 text-[10px] mt-3 leading-relaxed" data-print-hide>
        Opens your browser's print window. Choose "Save as PDF" as the destination.
      </p>
    </>
  );
}
