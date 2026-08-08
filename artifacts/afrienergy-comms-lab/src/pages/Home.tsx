import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { courses, liveSessions } from '@/data/mock';
import heroImg from '@assets/hero.jpg';

// ─── palette tokens — africaenergypulse.com ──────────────────────────────────
const C = {
  ink:   '#100E0B',   // warm near-black (from AEP's editorial darkness)
  gold:  '#C49A3C',   // sandy warm gold (from AEP's desert/landscape imagery)
  brown: '#8B6530',   // deep warm brown (secondary accent)
  paper: '#F9F7F4',   // pure warm white (AEP's clean light background)
  white: '#FFFFFF',
};

// ─── fade-in helper ─────────────────────────────────────────────────────────
const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay },
  }),
};

// ─── data ───────────────────────────────────────────────────────────────────
const focusAreas = [
  { n: '01', title: 'Strategic Energy Communications',  sub: 'Craft messages that move policy and public opinion.' },
  { n: '02', title: 'Energy Transition & Policy',       sub: 'Understand the regulatory forces shaping the continent.' },
  { n: '03', title: 'Advocacy & Stakeholder Influence', sub: 'Build coalitions and drive change at every level.' },
  { n: '04', title: 'Design Thinking & Innovation',     sub: 'Solve complex problems with human-centred methods.' },
];

const upcomingPrograms = liveSessions.filter(s => s.isUpcoming).slice(0, 3);

// ─── component ──────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <div style={{ backgroundColor: C.ink, color: C.white }}>

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
          style={{ filter: 'brightness(0.38)' }}
        />

        {/* content */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.1}
            className="text-xs uppercase tracking-[0.35em] mb-6"
            style={{ color: C.gold }}
          >
            Afrienergy Comms Lab
          </motion.p>

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
            className="mt-6 text-base md:text-lg max-w-md mx-auto leading-relaxed"
            style={{ color: 'rgba(255,255,255,0.65)' }}
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
            <Link href="/register">
              <button
                className="px-7 py-3 text-sm font-semibold uppercase tracking-widest transition-colors"
                style={{ backgroundColor: C.gold, color: C.ink }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#00f58a')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = C.gold)}
              >
                Register Interest
              </button>
            </Link>
            <Link href="/courses">
              <button
                className="px-7 py-3 text-sm font-semibold uppercase tracking-widest border transition-colors"
                style={{ borderColor: 'rgba(255,255,255,0.35)', color: C.white }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.gold)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
              >
                View Programs
              </button>
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
          <span className="text-[10px] uppercase tracking-[0.4em]" style={{ color: 'rgba(255,255,255,0.4)' }}>Scroll</span>
          <div className="w-px h-10 origin-top" style={{ background: `linear-gradient(to bottom, rgba(255,255,255,0.3), transparent)` }} />
        </motion.div>
      </section>

      {/* ── 2. STATS STRIP ──────────────────────────────────────────────── */}
      <section
        className="border-t border-b"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-px"
          style={{ background: 'rgba(255,255,255,0.04)' }}>
          {[
            { value: '4',      label: 'Focus Areas' },
            { value: '12+',    label: 'Programs' },
            { value: '3',      label: 'Cohorts per Year' },
            { value: 'Africa', label: 'Wide Reach' },
          ].map(({ value, label }) => (
            <motion.div
              key={label}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              className="flex flex-col items-center justify-center py-10 px-4 text-center"
              style={{ backgroundColor: C.ink }}
            >
              <span
                className="font-display font-bold leading-none"
                style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', color: C.gold }}
              >
                {value}
              </span>
              <span className="mt-2 text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {label}
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── 3. FOCUS AREAS ──────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-xs uppercase tracking-[0.35em] mb-16"
          style={{ color: C.gold }}
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
              className="group flex flex-col gap-4 p-10 transition-colors"
              style={{ backgroundColor: C.ink }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#0c1929')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = C.ink)}
            >
              <span
                className="font-mono text-xs"
                style={{ color: C.gold }}
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
      </section>

      {/* ── 5. UPCOMING PROGRAMS ────────────────────────────────────────── */}
      <section style={{ backgroundColor: C.paper, color: C.ink }}>
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="flex items-end justify-between mb-16 gap-6 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] mb-3" style={{ color: C.brown }}>
                Upcoming
              </p>
              <h2 className="font-display font-bold" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
                Programs
              </h2>
            </div>
            <Link href="/courses">
              <button
                className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest border-b pb-0.5 transition-colors"
                style={{ borderColor: C.brown, color: C.ink }}
              >
                All Programs <ArrowRight size={14} />
              </button>
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {upcomingPrograms.map((session, i) => {
              const date = new Date(session.date);
              return (
                <motion.div
                  key={session.id}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-40px' }}
                  custom={i * 0.1}
                  className="flex flex-col group"
                  style={{ borderTop: `2px solid ${C.ink}` }}
                >
                  <div className="pt-6 pb-8 flex flex-col flex-1">
                    <p className="text-xs uppercase tracking-widest mb-5" style={{ color: C.brown }}>
                      {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <h3 className="font-display font-semibold text-lg leading-snug mb-3">
                      {session.title}
                    </h3>
                    <p className="text-sm mb-8" style={{ color: 'rgba(7,17,30,0.55)' }}>
                      {session.instructor}
                    </p>
                    <Link href="/live-sessions">
                      <button
                        className="mt-auto self-start flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors"
                        style={{ color: C.ink }}
                        onMouseEnter={e => (e.currentTarget.style.color = C.brown)}
                        onMouseLeave={e => (e.currentTarget.style.color = C.ink)}
                      >
                        Reserve Spot <ArrowRight size={12} />
                      </button>
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 5. CTA ──────────────────────────────────────────────────────── */}
      <section
        className="text-center px-6 py-28 md:py-36"
        style={{ backgroundColor: C.ink }}
      >
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-xs uppercase tracking-[0.35em] mb-6"
          style={{ color: C.gold }}
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
          <Link href="/register">
            <button
              className="px-10 py-4 text-sm font-bold uppercase tracking-widest transition-colors"
              style={{ backgroundColor: C.gold, color: C.ink }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#00f58a')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = C.gold)}
            >
              Register Your Interest
            </button>
          </Link>
        </motion.div>
      </section>

    </div>
  );
}
