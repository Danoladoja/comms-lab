import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { instructors } from '@/data/mock';
import { KenteOverlay } from '@/components/KenteOverlay';

const C = {
  ink:   '#07111E',
  gold:  '#F97316',
  brown: '#C2410C',
  paper: '#F4F0E8',
  white: '#FFFFFF',
};

const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay },
  }),
};

const approach = [
  {
    n: '01',
    title: 'Cohort-Based',
    body: 'You learn alongside peers navigating the same landscape. Relationships built here outlast the program.',
  },
  {
    n: '02',
    title: 'Practitioner-Led',
    body: 'Every facilitator has worked in African energy, policy, or strategic communications. No theory without practice.',
  },
  {
    n: '03',
    title: 'Applied Throughout',
    body: 'Every session produces a usable output. A policy brief. A media pitch. A stakeholder map. Skills built in context.',
  },
  {
    n: '04',
    title: 'Africa-First',
    body: 'Our case studies, frameworks, and networks are grounded in the African context, not imported and re-labelled.',
  },
];

export default function About() {
  return (
    <div style={{ backgroundColor: C.ink, color: C.white }}>

      {/* 1. INTRO ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <KenteOverlay opacity={0.06} />
        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-14 pb-20 md:py-32">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.1}
            className="text-xs uppercase tracking-[0.35em] mb-8"
            style={{ color: C.gold }}
          >
            About the Lab
          </motion.p>

          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.2}
            className="font-display font-bold leading-tight max-w-4xl"
            style={{ fontSize: 'clamp(1.85rem, 6vw, 5rem)' }}
          >
            We exist at the intersection of African energy and the art of communication.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.35}
            className="mt-8 text-base md:text-lg leading-relaxed max-w-2xl"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            The Afrienergy Comms Lab trains energy communicators, policy advocates, and strategic
            storytellers for Africa's energy transition. We are not a university. We are a lab
            where practitioners learn by doing.
          </motion.p>
        </div>
      </section>

      {/* 2. THE GAP ───────────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: C.paper, color: C.ink }}>
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <motion.p
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="text-xs uppercase tracking-[0.35em] mb-6"
                style={{ color: C.brown }}
              >
                The Gap
              </motion.p>
              <motion.h2
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                custom={0.1}
                className="font-display font-bold leading-tight"
                style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
              >
                Technical expertise is not enough.
              </motion.h2>
            </div>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={0.15}
              className="space-y-5 text-base leading-relaxed"
              style={{ color: 'rgba(7,17,30,0.65)' }}
            >
              <p>
                Africa is experiencing one of the most consequential energy transitions in history.
                New infrastructure is being built. New policies are being written. New funding is
                flowing in from across the world.
              </p>
              <p>
                But the people shaping these decisions often lack the communications skills to make
                their work land. Engineers who cannot brief a minister. Policy analysts who cannot
                write a story. Advocates who cannot reach the communities they serve.
              </p>
              <p style={{ color: C.ink, fontWeight: 600 }}>
                The gap between what energy professionals know and what decision-makers, communities,
                and investors understand is one of the most underestimated barriers to Africa's
                energy future. We exist to close it.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 3. APPROACH ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ backgroundColor: C.ink }}>
        <KenteOverlay opacity={0.055} />
        <div className="relative z-10 max-w-6xl mx-auto px-6 py-24 md:py-32">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-xs uppercase tracking-[0.35em] mb-6"
            style={{ color: C.gold }}
          >
            How We Work
          </motion.p>
          <motion.h2
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0.1}
            className="font-display font-bold leading-tight mb-16 max-w-xl"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
          >
            Learning built for the work ahead.
          </motion.h2>

          <div className="grid md:grid-cols-2 gap-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {approach.map(({ n, title, body }, i) => (
              <motion.div
                key={n}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                custom={i * 0.1}
                className="flex flex-col gap-4 p-6 md:p-10 transition-colors"
                style={{ backgroundColor: C.ink }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#0c1929')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = C.ink)}
              >
                <span className="font-mono text-xs" style={{ color: C.gold }}>{n}</span>
                <h3 className="font-display font-semibold" style={{ fontSize: 'clamp(1.2rem, 2.5vw, 1.5rem)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. FACULTY ───────────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: C.paper, color: C.ink }}>
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-xs uppercase tracking-[0.35em] mb-4"
            style={{ color: C.brown }}
          >
            Faculty
          </motion.p>
          <motion.h2
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            custom={0.1}
            className="font-display font-bold leading-tight mb-16"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
          >
            Led by practitioners, not lecturers.
          </motion.h2>

          <div className="grid md:grid-cols-3 gap-px" style={{ background: 'rgba(7,17,30,0.08)' }}>
            {instructors.map((person, i) => (
              <motion.div
                key={person.id}
                variants={fadeUp}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
                custom={i * 0.1}
                className="flex flex-col p-6 md:p-8"
                style={{ backgroundColor: C.paper }}
              >
                <img
                  src={person.imageUrl}
                  alt={person.name}
                  className="w-16 h-16 rounded-full object-cover mb-6"
                  style={{ border: `2px solid ${C.gold}` }}
                />
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: C.brown }}>
                  {person.title}
                </p>
                <h3 className="font-display font-semibold text-lg mb-4">{person.name}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(7,17,30,0.6)' }}>
                  {person.bio}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. CTA ───────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden text-center px-6 py-28 md:py-36"
        style={{ backgroundColor: C.ink }}
      >
        <KenteOverlay opacity={0.08} />
        <div className="relative z-10">
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
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link href="/register">
              <button
                className="px-10 py-4 text-sm font-bold uppercase tracking-widest transition-colors"
                style={{ backgroundColor: C.gold, color: C.ink }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#EA6D0A')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = C.gold)}
              >
                Register Your Interest
              </button>
            </Link>
            <Link href="/courses">
              <button
                className="flex items-center gap-2 px-10 py-4 text-sm font-bold uppercase tracking-widest border transition-colors"
                style={{ borderColor: 'rgba(255,255,255,0.3)', color: C.white }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = C.gold)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)')}
              >
                View Programs <ArrowRight size={14} />
              </button>
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
