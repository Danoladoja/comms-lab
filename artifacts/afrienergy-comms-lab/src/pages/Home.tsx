import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import heroImg from '@assets/hero.jpg';
import { KenteOverlay } from '@/components/KenteOverlay';
import { useListPrograms, getListProgramsQueryKey } from '@workspace/api-client-react';

// ─── fade-in helper ─────────────────────────────────────────────────────────
// The CSS in index.css neutralises these durations under prefers-reduced-motion.
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay },
  }),
};

// ─── data ───────────────────────────────────────────────────────────────────
const focusAreas = [
  { n: '01', title: 'Strategic Energy Communications',  sub: 'Craft messages that move policy and public opinion.' },
  { n: '02', title: 'Energy Transition & Policy',       sub: 'Understand the regulatory forces shaping the continent.' },
  { n: '03', title: 'Advocacy & Stakeholder Influence', sub: 'Build coalitions and drive change at every level.' },
  { n: '04', title: 'Design Thinking & Innovation',     sub: 'Solve complex problems with human-centred methods.' },
];

// ─── component ──────────────────────────────────────────────────────────────
export default function Home() {
  const { data: programs = [] } = useListPrograms({ query: { queryKey: getListProgramsQueryKey() } });
  const published = programs.filter(p => p.status === 'published');
  const upcomingPrograms = published.slice(0, 3);

  /**
   * What we count, publicly.
   *
   * These used to be "4 Focus Areas / 12+ Programs / 3 Cohorts per Year" —
   * vanity numbers, and small ones. Two of the four are now read from the real
   * catalogue. The outcome metric is the one that matters and the one sponsors
   * buy: fill BYLINES_PUBLISHED in once you are tracking it, and show it here.
   */
  const BYLINES_PUBLISHED: number | null = null;
  const stats = [
    { value: String(focusAreas.length), label: 'Focus Areas' },
    { value: published.length > 0 ? String(published.length) : '—', label: 'Live Programs' },
    {
      value: BYLINES_PUBLISHED === null ? 'Soon' : String(BYLINES_PUBLISHED),
      label: 'Bylines Published',
    },
    { value: 'Africa', label: 'Wide Reach' },
  ];

  return (
    <div className="surface-ink">

      {/* ── 1. HERO ─────────────────────────────────────────────────────── */}
      <section
        className="relative flex items-center justify-center"
        style={{ height: '100svh', minHeight: 560 }}
      >
        {/* photo */}
        <img
          src={heroImg}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'brightness(0.32)' }}
        />
        {/* A scrim under the copy: the photo alone left the subhead below the
            WCAG AA contrast floor on lighter frames. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(7,17,30,0.35) 0%, rgba(7,17,30,0.55) 60%, rgba(7,17,30,0.8) 100%)' }}
        />

        {/* content */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.25}
            className="font-display font-bold leading-none tracking-tight"
            style={{ fontSize: 'clamp(3rem, 9vw, 7.5rem)' }}
          >
            Shaping the Signal.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.45}
            className="mt-6 text-base md:text-lg max-w-md mx-auto leading-relaxed text-on-ink-muted"
          >
            Africa's learning hub for energy communicators, advocates, and policy strategists.
          </motion.p>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.6}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/sign-up" className="btn-editorial btn-editorial-solid">
              Register Interest
            </Link>
            <Link href="/courses" className="btn-editorial btn-editorial-ghost">
              View Programs
            </Link>
          </motion.div>
        </div>

        {/* scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-[10px] uppercase tracking-[0.4em]" style={{ color: 'var(--brand-on-ink-muted)' }}>Scroll</span>
          <div className="w-px h-10 origin-top" style={{ background: `linear-gradient(to bottom, rgba(255,255,255,0.3), transparent)` }} />
        </motion.div>
      </section>

      {/* ── 2. STATS STRIP ──────────────────────────────────────────────── */}
      <section
        className="relative border-t border-b overflow-hidden"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <KenteOverlay opacity={0.06} />
        <div className="relative z-10 max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-px"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          {stats.map(({ value, label }) => (
            <motion.div
              key={label}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              className="flex flex-col items-center justify-center py-6 md:py-10 px-4 text-center"
              
            >
              <span
                className="font-display font-bold leading-none"
                style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', color: "var(--brand-gold)" }}
              >
                {value}
              </span>
              <span className="mt-2 text-xs uppercase tracking-widest" style={{ color: 'var(--brand-on-ink-muted)' }}>
                {label}
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── 3. FOCUS AREAS ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" >
        <KenteOverlay opacity={0.055} />
        <div className="relative z-10 max-w-6xl mx-auto px-6 py-24 md:py-32">
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-xs uppercase tracking-[0.35em] mb-16"
          style={{ color: "var(--brand-gold)" }}
        >
          What We Teach
        </motion.p>

        <div className="grid md:grid-cols-2 gap-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {focusAreas.map(({ n, title, sub }, i) => (
            <motion.div
              key={n}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-40px' }}
              custom={i * 0.1}
              className="group panel-ink flex flex-col gap-4 p-6 md:p-10"
            >
              <span
                className="font-mono text-xs"
                style={{ color: "var(--brand-gold)" }}
              >
                {n}
              </span>
              <h3
                className="font-display font-semibold leading-snug"
                style={{ fontSize: 'clamp(1.2rem, 2.5vw, 1.6rem)' }}
              >
                {title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {sub}
              </p>
            </motion.div>
          ))}
        </div>
        </div>
      </section>

      {/* ── 5. UPCOMING PROGRAMS ────────────────────────────────────────── */}
      <section className="surface-paper">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14">
            <p className="text-xs uppercase tracking-[0.35em] mb-3" style={{ color: "var(--brand-brown)" }}>
              Upcoming
            </p>
            <h2 className="font-display font-bold" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
              Programs
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-px" style={{ background: 'rgba(7,17,30,0.08)' }}>
            {upcomingPrograms.map((program, i) => (
              <motion.div
                key={program.id}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                custom={i * 0.1}
                className="flex flex-col p-5 md:p-8"
                style={{ backgroundColor: "var(--brand-paper)" }}
              >
                <p className="text-xs uppercase tracking-widest mb-6" style={{ color: "var(--brand-brown)" }}>
                  {program.tag}
                </p>
                <h3 className="font-display font-semibold text-lg leading-snug mb-4">
                  {program.title}
                </h3>
                <p className="text-sm leading-relaxed mb-8 flex-1" style={{ color: 'rgba(7,17,30,0.55)' }}>
                  {program.description}
                </p>
                <div className="flex items-center justify-between pt-5 border-t" style={{ borderColor: 'rgba(7,17,30,0.12)' }}>
                  <span className="text-xs" style={{ color: 'rgba(7,17,30,0.45)' }}>
                    {program.startDate} · {program.format} · {program.duration}
                  </span>
                  <Link href={`/programs/${program.id}`} className="link-editorial text-xs">
                    Reserve <ArrowRight size={11} aria-hidden />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="mt-10 flex justify-end">
            <Link href="/courses" className="link-editorial text-sm border-b border-[color:var(--brand-brown)] pb-0.5">
              All Programs <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── 5. CTA ──────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden text-center px-6 py-28 md:py-36"
        
      >
        <KenteOverlay opacity={0.08} />
        <div className="relative z-10">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-xs uppercase tracking-[0.35em] mb-6"
            style={{ color: "var(--brand-gold)" }}
          >
            Join the Lab
          </motion.p>
          <motion.h2
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0.1}
            className="font-display font-bold leading-none mb-10"
            style={{ fontSize: 'clamp(2.5rem, 7vw, 5.5rem)' }}
          >
            Ready to shape<br />your signal?
          </motion.h2>
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0.2}
          >
            <Link href="/sign-up" className="btn-editorial btn-editorial-solid px-10 py-4">
              Register Your Interest
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
