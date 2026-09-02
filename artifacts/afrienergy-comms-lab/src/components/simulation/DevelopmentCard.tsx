import {
  Newspaper, MessageCircle, Radio, Mail, Phone, Scale, Megaphone,
  Repeat2, Heart, MessageSquare, BadgeCheck, PhoneMissed, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A development, rendered as the thing it actually is.
 *
 * Everything here is drawn from text the model already returns: a source, a
 * channel, a handle, a repost count, a reference number. No image is
 * generated, nothing is fetched, and nothing waits. A post laid out as a post,
 * with an avatar and a repost count and a timestamp, does more for the feeling
 * that this is really happening than a generated photograph would, and it
 * costs nothing and arrives instantly.
 *
 * Every field is optional and every one degrades. A post with no repost count
 * is still a post. A post with an empty space where the count should be is a
 * mock-up of a post, which is why nothing renders a blank.
 */

export type Development = {
  id: string;
  title: string;
  content: string;
  responsePrompt: string;
  source?: string;
  channel?: string;
  at?: string;
  handle?: string;
  outlet?: string;
  audience?: string;
  reference?: string;
  subjectLine?: string;
  reposts?: number;
  likes?: number;
  replies?: number;
  figures?: { label: string; value: number; unit?: string }[];
};

const ICONS: Record<string, typeof Newspaper> = {
  wire: Newspaper, social: MessageCircle, broadcast: Radio,
  internal: Mail, call: Phone, regulator: Scale, community: Megaphone,
};

function clockTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '';
}

/** 1800 becomes 1.8K, because that is how a platform writes it. */
function compact(n?: number): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function initials(name?: string): string {
  const words = (name ?? '').replace(/^@/, '').trim().split(/[\s_]+/).filter(Boolean);
  return (words[0]?.[0] ?? '?').toUpperCase() + (words[1]?.[0] ?? '').toUpperCase();
}

/**
 * A small bar chart, when the development turns on numbers.
 *
 * Drawn with divs rather than a charting library: five bars do not justify a
 * dependency, and this way it inherits the room's colours and prints.
 */
function Figures({ figures }: { figures: NonNullable<Development['figures']> }) {
  const max = Math.max(...figures.map((f) => Math.abs(f.value)), 1);
  const unit = figures.find((f) => f.unit)?.unit;

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40 font-bold mb-3">
        <BarChart3 className="w-3 h-3" aria-hidden />
        {unit ? `Figures, in ${unit}` : 'Figures'}
      </div>
      <div className="space-y-2" role="img"
           aria-label={figures.map((f) => `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ''}`).join(', ')}>
        {figures.map((f) => (
          <div key={f.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[11px] text-white/50 font-mono truncate">{f.label}</span>
            <div className="flex-1 h-3 bg-white/5">
              <div className="h-full bg-[#f97316]/80" data-print-keep
                   style={{ width: `${Math.max(2, (Math.abs(f.value) / max) * 100)}%` }} />
            </div>
            <span className="w-14 shrink-0 text-[11px] text-white/70 font-mono tabular-nums text-right">
              {f.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chrome({ icon: Icon, label, right, tone = 'accent', tight = false }: {
  icon: typeof Newspaper; label: string; right?: string | null;
  tone?: 'accent' | 'quiet';
  /** No bottom margin, for when the chrome is the whole header bar. */
  tight?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', !tight && 'mb-3')}>
      <div className={cn(
        'flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]',
        tone === 'accent' ? 'text-[#f97316]' : 'text-white/40',
      )}>
        <Icon className="w-3.5 h-3.5" aria-hidden />
        <span>{label}</span>
      </div>
      {right && <span className="text-[10px] text-white/35 font-mono shrink-0">{right}</span>}
    </div>
  );
}

export function DevelopmentCard({ development }: { development: Development }) {
  const d = development;
  const channel = d.channel ?? 'wire';
  const Icon = ICONS[channel] ?? Newspaper;
  const time = clockTime(d.at);

  /* ---------- Social: a post, with everything a post has ---------- */
  if (channel === 'social') {
    return (
      <article className="bg-[#0c1015] border border-white/10 p-5">
        <div className="flex gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-white/70 text-xs font-bold">
            {initials(d.handle || d.source)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
              <span className="font-bold text-white text-sm truncate">{d.source || 'Unknown account'}</span>
              <BadgeCheck className="w-3.5 h-3.5 text-[#f97316] shrink-0" aria-hidden />
              {d.handle && <span className="text-white/40 text-sm truncate">{d.handle}</span>}
              {time && <span className="text-white/30 text-sm">· {time}</span>}
            </div>
            {d.audience && <p className="text-white/30 text-[11px] mb-2">{d.audience}</p>}
            <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>

            {(d.replies !== undefined || d.reposts !== undefined || d.likes !== undefined) && (
              <div className="flex items-center gap-6 mt-4 text-white/40">
                {d.replies !== undefined && (
                  <span className="flex items-center gap-1.5 text-xs"><MessageSquare className="w-3.5 h-3.5" aria-hidden />{compact(d.replies)}</span>
                )}
                {d.reposts !== undefined && (
                  <span className="flex items-center gap-1.5 text-xs"><Repeat2 className="w-4 h-4" aria-hidden />{compact(d.reposts)}</span>
                )}
                {d.likes !== undefined && (
                  <span className="flex items-center gap-1.5 text-xs"><Heart className="w-3.5 h-3.5" aria-hidden />{compact(d.likes)}</span>
                )}
              </div>
            )}
            {d.figures && <Figures figures={d.figures} />}
          </div>
        </div>
      </article>
    );
  }

  /* ---------- Broadcast: a lower third ---------- */
  if (channel === 'broadcast') {
    return (
      <article className="bg-black border border-white/10 overflow-hidden">
        <div className="px-5 py-3 flex items-center gap-3 border-b border-white/10">
          <span className="flex items-center gap-1.5 bg-red-600 text-white text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden /> Live
          </span>
          <span className="text-white/60 text-[11px] uppercase tracking-widest font-bold truncate">
            {d.outlet || d.source}
          </span>
          {time && <span className="ml-auto text-white/30 text-[10px] font-mono">{time}</span>}
        </div>
        <div className="p-5">
          <div className="border-l-4 border-[#f97316] pl-4 mb-4">
            <p className="text-white font-display font-bold text-lg uppercase leading-tight">{d.title}</p>
            {d.audience && <p className="text-white/40 text-[11px] mt-1">{d.audience}</p>}
          </div>
          <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>
          {d.figures && <Figures figures={d.figures} />}
        </div>
      </article>
    );
  }

  /* ---------- Internal: an email ---------- */
  if (channel === 'internal') {
    return (
      <article className="bg-[#0c1015] border border-white/10">
        <div className="px-5 py-3 border-b border-white/10 space-y-1">
          <Chrome icon={Mail} label="Internal" right={time} tone="quiet" tight />
          <p className="text-xs text-white/40">
            <span className="text-white/30">From </span>{d.source}
          </p>
          <p className="text-sm text-white font-semibold">{d.subjectLine || d.title}</p>
        </div>
        <div className="p-5">
          <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>
          {d.figures && <Figures figures={d.figures} />}
        </div>
      </article>
    );
  }

  /* ---------- A call, missed or otherwise ---------- */
  if (channel === 'call') {
    return (
      <article className="bg-[#0c1015] border border-white/10 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 shrink-0 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
            <PhoneMissed className="w-4 h-4 text-red-400" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <Chrome icon={Phone} label="Voicemail" right={time} />
            <p className="font-bold text-white text-sm">{d.source}</p>
            {d.audience && <p className="text-white/40 text-[11px] mb-3">{d.audience}</p>}
            <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap mt-2 italic">“{d.content}”</p>
            {d.figures && <Figures figures={d.figures} />}
          </div>
        </div>
      </article>
    );
  }

  /* ---------- The regulator: a letter, with a reference ---------- */
  if (channel === 'regulator') {
    return (
      <article className="bg-[#0f1115] border border-white/15">
        <div className="px-5 py-4 border-b border-white/10">
          <Chrome icon={Scale} label={d.outlet || 'Regulator'} right={time} />
          <p className="font-display font-bold text-white text-base">{d.title}</p>
          {d.reference && (
            <p className="text-white/40 text-[11px] font-mono mt-1">Ref {d.reference}</p>
          )}
        </div>
        <div className="p-5">
          <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>
          {d.figures && <Figures figures={d.figures} />}
        </div>
      </article>
    );
  }

  /* ---------- Community: a statement ---------- */
  if (channel === 'community') {
    return (
      <article className="bg-[#0c1015] border-l-4 border-l-[#f97316] border border-white/10 p-5">
        <Chrome icon={Megaphone} label="From the community" right={time} />
        <p className="font-bold text-white text-sm mb-1">{d.source}</p>
        {d.audience && <p className="text-white/40 text-[11px] mb-3">{d.audience}</p>}
        <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>
        {d.figures && <Figures figures={d.figures} />}
      </article>
    );
  }

  /* ---------- A wire item, which is also the fallback ---------- */
  return (
    <article className="bg-[#0c1015] border border-white/10">
      <div className="px-5 py-3 border-b border-white/10">
        <Chrome icon={Newspaper} label={d.outlet || 'Newswire'} right={time} tight />
      </div>
      <div className="p-5">
        <p className="font-display font-bold text-white text-lg leading-tight mb-1">{d.title}</p>
        <p className="text-white/40 text-[11px] font-mono uppercase tracking-wider mb-3">
          {d.source}{d.audience ? ` · ${d.audience}` : ''}
        </p>
        <p className="text-white/85 text-sm leading-relaxed whitespace-pre-wrap">{d.content}</p>
        {d.figures && <Figures figures={d.figures} />}
      </div>
    </article>
  );
}
