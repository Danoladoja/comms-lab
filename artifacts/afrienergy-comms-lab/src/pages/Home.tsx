import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { liveSessions, instructors } from '@/data/mock';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import heroImg from '@assets/hero.jpg';

const KentePattern = ({ className, opacity = 0.08, color = 'currentColor' }: { className?: string, opacity?: number, color?: string }) => (
  <div className={`absolute inset-0 pointer-events-none mix-blend-overlay ${className}`} style={{ opacity, color }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="kente" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M15 0L30 15L15 30L0 15Z" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <path d="M0 0L30 30M30 0L0 30" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kente)" />
    </svg>
  </div>
);

const SignalArc = ({ className, opacity = 0.15 }: { className?: string, opacity?: number }) => {
  const reduceMotion = useReducedMotion();
  const anim = reduceMotion ? undefined : { opacity: [0.2, 1, 0.2], scale: [0.98, 1, 0.98] };
  return (
    <div className={`pointer-events-none ${className}`} style={{ opacity }}>
      <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.path d="M200 200C200 144.772 155.228 100 100 100" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" 
          animate={anim} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }} />
        <motion.path d="M200 250C200 167.157 132.843 100 50 100" stroke="currentColor" strokeWidth="2"
          animate={anim} transition={{ repeat: Infinity, duration: 2, delay: 0.3, ease: "easeInOut" }} />
        <motion.path d="M200 300C200 89.543 110.457 0 0 0" stroke="currentColor" strokeWidth="4"
          animate={anim} transition={{ repeat: Infinity, duration: 2, delay: 0.6, ease: "easeInOut" }} />
      </svg>
    </div>
  );
};

const ZigZagSeam = ({ className, color = 'currentColor', position = 'top' }: { className?: string, color?: string, position?: 'top' | 'bottom' }) => {
  const isTop = position === 'top';
  const patternId = useId();
  return (
    <div className={`w-full h-4 overflow-hidden pointer-events-none ${className} flex`}>
      <svg width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={patternId} width="40" height="16" patternUnits="userSpaceOnUse">
            {isTop ? (
              <path d="M0 0 L20 16 L40 0 Z" fill={color} />
            ) : (
              <path d="M0 16 L20 0 L40 16 Z" fill={color} />
            )}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};

const AdinkraMotif = ({ className, opacity = 0.05, color = 'currentColor' }: { className?: string, opacity?: number, color?: string }) => (
  <div className={`pointer-events-none mix-blend-overlay ${className}`} style={{ opacity, color }}>
    <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="70" stroke="currentColor" strokeWidth="3" strokeDasharray="4 8" />
      <circle cx="100" cy="100" r="50" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="30" fill="currentColor" opacity="0.15" />
      {[...Array(16)].map((_, i) => (
        <line key={i} x1="100" y1="100" x2="100" y2="10" stroke="currentColor" strokeWidth="1" transform={`rotate(${i * 22.5} 100 100)`} />
      ))}
    </svg>
  </div>
);

const SectionKicker = ({ text, textColor = "hsl(25,95%,52%)" }: { text: string, textColor?: string }) => (
  <div className="flex items-center gap-3 mb-8 relative z-10">
    <div className="w-2 h-2 bg-[hsl(25,95%,52%)] shrink-0"></div>
    <span className="text-xs uppercase tracking-[0.3em] font-bold" style={{ color: textColor }}>{text}</span>
  </div>
);

const wordAnimation = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 }
};

export default function Home() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress, scrollY } = useScroll();
  const yComms = useTransform(scrollY, [0, 1000], reduceMotion ? [0, 0] : [0, 250]);

  const upcomingSessions = liveSessions.filter(s => s.isUpcoming).slice(0, 3);
  
  const insights = [
    {
      title: "The Case for Distributed Solar in Sub-Saharan Policies",
      author: "Amina Ndlovu",
      category: "Policy & Strategy",
      excerpt: "Why the next decade of African energy depends on decentralized grids and bold regulatory reform."
    },
    {
      title: "Financing the Green Transition: Risks and Rewards",
      author: "Kwame Osei",
      category: "Economics",
      excerpt: "Examining the gap between international climate finance pledges and on-the-ground infrastructure reality."
    },
    {
      title: "Narrative Power in Energy Advocacy",
      author: "Sarah Adeyemi",
      category: "Communications",
      excerpt: "How to articulate complex energy realities to stakeholders who matter most."
    }
  ];

  const focusAreas = [
    {
      title: "Strategic Energy Communications",
      desc: "Crafting narratives that move policymakers, investors, and publics in the energy sector"
    },
    {
      title: "Energy Transition & Policy",
      desc: "Understanding the regulatory and political architecture of Africa's clean energy shift"
    },
    {
      title: "Advocacy & Stakeholder Influence",
      desc: "Building campaigns, coalitions, and public positioning for energy projects"
    },
    {
      title: "Design Thinking & Innovation",
      desc: "Human-centered approaches to solving Africa's energy communication challenges"
    }
  ];

  const line1Words = "Shaping the".split(" ");
  const line2Words = "Signal.".split(" ");

  const manifestoText = "We exist at the intersection of words, energy, and power — training the communicators who will define how Africa's energy story is told.";
  const manifestoWords = manifestoText.split(" ");

  return (
    <div className="flex flex-col w-full font-sans">
      {/* Scroll Progress Bar */}
      <motion.div 
        className="fixed top-0 left-0 right-0 h-[2px] bg-[hsl(25,95%,52%)] origin-left z-[100] pointer-events-none" 
        style={{ scaleX: scrollYProgress }} 
      />
      
      {/* SECTION 1: HERO */}
      <section 
        className="relative h-[100vh] min-h-[600px] w-full overflow-hidden flex items-center" 
        style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}
      >
        <KentePattern opacity={0.08} color="white" />
        
        {/* Right half image background */}
        <div className="absolute inset-y-0 right-0 w-full md:w-1/2 h-[40%] md:h-full top-auto bottom-0 md:top-0 z-0">
          <img src={heroImg} alt="Hero" className="w-full h-full object-cover" />
          {/* Gradient mask */}
          <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[hsl(218,60%,9%)] to-transparent" />
        </div>

        {/* Decorative Signal Arc */}
        <div className="absolute top-0 right-0 w-[350px] h-[350px] text-white rotate-90 origin-top-right z-0">
          <SignalArc opacity={0.15} className="w-full h-full" />
        </div>

        {/* Enormous Parallax Background Text */}
        <motion.div 
          style={{ y: yComms }} 
          className="absolute inset-0 flex items-start mt-20 justify-center pointer-events-none z-0 overflow-hidden"
        >
          <span className="text-[120px] md:text-[180px] lg:text-[220px] font-black font-display text-white whitespace-nowrap opacity-[0.03] select-none tracking-tighter">
            COMMS LAB
          </span>
        </motion.div>

        <div className="container relative z-10 mx-auto px-6 md:px-12 w-full h-full flex flex-col justify-center">
          <div className="max-w-2xl mt-12 md:mt-0 relative">
            <p className="text-[hsl(25,95%,52%)] text-xs uppercase tracking-[0.3em] font-bold mb-8">
              Afrienergy Comms Lab
            </p>
            
            <motion.h1 
              className="text-6xl md:text-[90px] leading-[1.05] font-display mb-8"
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.1 }}
            >
              <div className="overflow-hidden pb-2">
                {line1Words.map((word, i) => (
                  <motion.span key={`l1-${i}`} className="inline-block text-white font-normal mr-4" variants={wordAnimation} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                    {word}
                  </motion.span>
                ))}
              </div>
              <div className="overflow-hidden pb-2">
                {line2Words.map((word, i) => (
                  <motion.span key={`l2-${i}`} className="inline-block text-[hsl(25,95%,52%)] font-black italic mr-4" variants={wordAnimation} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                    {word}
                  </motion.span>
                ))}
              </div>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-white/70 text-lg md:text-xl max-w-xl mb-12 font-medium"
            >
              The intellectual home for Africa's next generation of energy communicators and leaders. Where strategy meets the energy transition.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <Button asChild size="lg" className="rounded-none bg-[hsl(25,95%,52%)] hover:bg-[hsl(25,95%,45%)] text-[hsl(218,60%,9%)] font-bold px-8 h-14 text-base shadow-none">
                <Link href="/register">Register Your Interest</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-none border-white text-white hover:bg-white hover:text-[hsl(218,60%,9%)] bg-transparent font-bold px-8 h-14 text-base shadow-none">
                <Link href="/live-sessions">Explore Programs</Link>
              </Button>
            </motion.div>
          </div>
          
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="absolute bottom-12 left-6 md:left-12 flex items-end gap-3"
          >
            <div className="w-[2px] h-[80px] bg-[hsl(25,95%,52%)]"></div>
            <span className="text-[hsl(25,95%,52%)] text-[10px] uppercase tracking-widest font-bold whitespace-nowrap [writing-mode:vertical-lr] rotate-180 mb-1">
              EST. 2024 — AFRICA
            </span>
          </motion.div>
        </div>
      </section>

      {/* MARQUEE TICKER */}
      <section className="relative w-full overflow-hidden py-4 md:py-5 border-y border-white/5" style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}>
        <motion.div
          animate={reduceMotion ? undefined : { x: ["0%", "-50%"] }}
          transition={{ ease: "linear", duration: 30, repeat: Infinity }}
          className="flex whitespace-nowrap"
        >
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center" aria-hidden={i > 0}>
              <span className="text-3xl md:text-5xl font-display font-black mx-4 tracking-wider" style={{ WebkitTextStroke: "1px hsl(25, 95%, 52%)", color: "transparent" }}>
                STRATEGIC COMMUNICATIONS
              </span>
              <span className="text-[hsl(25,95%,52%)] mx-4">—</span>
              <span className="text-3xl md:text-5xl font-display font-black mx-4 tracking-wider" style={{ WebkitTextStroke: "1px hsl(25, 95%, 52%)", color: "transparent" }}>
                ENERGY TRANSITION
              </span>
              <span className="text-[hsl(25,95%,52%)] mx-4">—</span>
              <span className="text-3xl md:text-5xl font-display font-black mx-4 tracking-wider" style={{ WebkitTextStroke: "1px hsl(25, 95%, 52%)", color: "transparent" }}>
                ADVOCACY
              </span>
              <span className="text-[hsl(25,95%,52%)] mx-4">—</span>
              <span className="text-3xl md:text-5xl font-display font-black mx-4 tracking-wider" style={{ WebkitTextStroke: "1px hsl(25, 95%, 52%)", color: "transparent" }}>
                DESIGN THINKING
              </span>
              <span className="text-[hsl(25,95%,52%)] mx-4">—</span>
            </div>
          ))}
        </motion.div>
      </section>

      {/* SECTION 2: MANIFESTO */}
      <section className="relative py-32 md:py-48 w-full bg-[hsl(38,25%,96%)] text-[hsl(218,60%,9%)] flex items-center justify-center overflow-hidden">
        <ZigZagSeam color="hsl(218, 60%, 9%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90" />
        
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <AdinkraMotif opacity={0.04} color="hsl(218, 60%, 9%)" className="w-[1000px] h-[1000px]" />
        </div>

        <div className="px-6 md:px-12 w-full relative z-10">
          <div className="w-full flex flex-col items-center text-center">
            <h2 className="text-3xl md:text-5xl max-w-5xl mx-auto font-medium font-serif italic leading-snug text-foreground flex flex-wrap justify-center">
              {manifestoWords.map((word, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0.15 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, margin: "-20% 0px -20% 0px" }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="mr-[0.25em] mb-2"
                >
                  {word}
                </motion.span>
              ))}
            </h2>
            
            <motion.div 
              initial={{ scaleX: 0 }} 
              whileInView={{ scaleX: 1 }} 
              viewport={{ once: true }} 
              transition={{ duration: 1, delay: 0.5 }}
              className="w-[200px] h-[2px] bg-[hsl(25,95%,52%)] my-16 origin-center"
            ></motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.8 }}
              className="flex flex-wrap justify-center items-center gap-4 text-sm font-bold uppercase tracking-wider text-foreground/80"
            >
              <span>4 Focus Areas</span>
              <span className="w-1.5 h-1.5 bg-[hsl(25,95%,52%)]"></span>
              <span>Live Expert Programs</span>
              <span className="w-1.5 h-1.5 bg-[hsl(25,95%,52%)]"></span>
              <span>A Growing Community</span>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SECTION 3: FOCUS AREAS */}
      <section className="relative py-32 w-full overflow-hidden" style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}>
        <ZigZagSeam color="hsl(38,25%,96%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90" />
        <KentePattern opacity={0.06} color="white" />
        
        <div className="absolute top-12 right-12 text-[300px] font-display font-black leading-none text-[hsl(25,95%,52%)] opacity-[0.03] pointer-events-none select-none z-0">
          02
        </div>

        <div className="container mx-auto px-6 lg:pl-32 lg:pr-12 relative z-10">
          <SectionKicker text="What We Do" textColor="white" />
          
          <motion.h2 
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-6xl font-display font-black text-white mb-16"
          >
            Our Focus
          </motion.h2>

          <div className="flex flex-col w-full border-t border-white/10 relative">
            {focusAreas.map((area, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, x: -40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                className="group relative flex flex-col md:flex-row md:items-center py-10 md:py-12 border-b border-white/10 transition-colors hover:bg-white/5 cursor-default overflow-hidden"
              >
                {/* Hover border indicator */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(25,95%,52%)] transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-out z-20"></div>
                
                {/* Huge ghost number */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none overflow-hidden z-0 flex items-center justify-end pr-8 md:pr-24">
                  <span className="text-[140px] md:text-[220px] font-black opacity-0 group-hover:opacity-[0.04] text-[hsl(25,95%,52%)] transform translate-x-12 group-hover:translate-x-0 group-hover:scale-105 transition-all duration-500 origin-right leading-none">
                    0{i + 1}
                  </span>
                </div>
                
                <div className="w-full md:w-32 mb-4 md:mb-0 pl-0 md:pl-6 text-3xl font-mono text-[hsl(25,95%,52%)] relative z-10">
                  0{i + 1}
                </div>
                
                <div className="flex-1 pr-6 relative z-10">
                  <h3 className="text-2xl md:text-3xl font-display font-bold text-white group-hover:text-[hsl(25,95%,52%)] transition-colors duration-300">
                    {area.title}
                  </h3>
                </div>
                
                <div className="w-full md:w-[320px] shrink-0 mt-4 md:mt-0 relative z-10">
                  <p className="text-white/60 text-sm leading-relaxed">
                    {area.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 4: UPCOMING PROGRAMS */}
      <section className="py-32 w-full relative overflow-hidden" style={{ backgroundColor: 'hsl(15, 75%, 40%)' }}>
        <ZigZagSeam color="hsl(218, 60%, 9%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90" />
        
        <div className="absolute -top-16 left-0 text-[200px] md:text-[300px] font-display font-black opacity-[0.08] pointer-events-none select-none z-0" style={{ WebkitTextStroke: "2px white", color: "transparent" }}>
          04
        </div>

        <div className="container mx-auto px-6 md:px-12 relative z-10">
          <SectionKicker text="Live Sessions" textColor="white" />
          
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="mb-16"
          >
            <h2 className="text-4xl md:text-6xl font-display font-black text-white">
              Upcoming Programs
            </h2>
          </motion.div>

          <div className="flex flex-col w-full border-t border-white/20">
            {upcomingSessions.map((session, i) => {
              const host = instructors.find(inst => inst.id === session.instructorId);
              const dateObj = new Date(session.date);
              const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
              const day = dateObj.toLocaleDateString('en-US', { day: '2-digit' });
              
              return (
                <motion.div 
                  key={session.id}
                  initial={{ opacity: 0, x: 50, skewX: -10 }}
                  whileInView={{ opacity: 1, x: 0, skewX: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.6, delay: i * 0.1, ease: "easeOut" }}
                  className="flex flex-col lg:flex-row lg:items-center py-8 lg:py-10 border-b border-white/20 hover:bg-white/5 transition-colors group"
                >
                  <div className="flex items-center w-full lg:w-48 shrink-0 mb-6 lg:mb-0 pl-4">
                    <div className="flex flex-col items-start justify-center">
                      <span className="text-white text-lg font-mono uppercase tracking-widest">{month}</span>
                      <span className="text-white text-4xl md:text-5xl font-display font-bold leading-none">{day}</span>
                    </div>
                    <div className="hidden lg:block w-[2px] h-16 bg-white/30 group-hover:bg-[hsl(25,95%,52%)] transition-colors ml-auto mr-8"></div>
                  </div>
                  
                  <div className="flex-1 lg:pr-12 mb-6 lg:mb-0">
                    <h3 className="text-2xl md:text-3xl font-display font-bold text-white mb-2 leading-tight">
                      {session.title}
                    </h3>
                    <p className="text-white/70 text-lg font-medium">
                      Host: {host?.name || 'Guest Expert'}
                    </p>
                  </div>
                  
                  <div className="flex flex-row sm:flex-col lg:flex-row items-center gap-4 shrink-0 pr-4">
                    <div className="px-4 py-1.5 rounded-sm bg-white text-[hsl(15,75%,40%)] text-xs font-bold uppercase tracking-wider">
                      {session.platform}
                    </div>
                    <Button asChild className="rounded-none bg-white text-[hsl(15,75%,40%)] hover:bg-white/90 font-bold px-8 shadow-none group-hover:scale-105 transition-transform">
                      <Link href="/live-sessions">Reserve Spot</Link>
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 5: WHO THIS IS FOR */}
      <section className="relative w-full bg-[hsl(38,25%,96%)] flex flex-col lg:flex-row">
        <ZigZagSeam color="hsl(15, 75%, 40%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90 hidden lg:block" />
        
        {/* Mobile ZigZag Seam needs to account for flex stacking */}
        <ZigZagSeam color="hsl(15, 75%, 40%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90 block lg:hidden" />
        
        {/* Left Image Panel */}
        <div className="w-full lg:w-[50vw] h-[50vh] lg:h-auto relative shrink-0 overflow-hidden">
          <img src={heroImg} alt="Audience" className="w-full h-full object-cover scale-105" />
          <div className="absolute inset-0 mix-blend-multiply" style={{ backgroundColor: 'hsl(15, 75%, 40%)', opacity: 0.35 }}></div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[hsl(38,25%,96%)] opacity-30 lg:opacity-100"></div>
        </div>
        
        {/* Right Text Panel */}
        <div className="w-full lg:w-[50vw] relative flex flex-col justify-center px-8 lg:px-20 py-24 lg:py-32 overflow-hidden">
          <div className="absolute top-12 right-12 text-[240px] font-display font-black leading-none text-[hsl(25,95%,52%)] opacity-5 pointer-events-none select-none z-0">
            03
          </div>
          
          <div className="relative z-10 w-full max-w-xl">
            <SectionKicker text="Audience" />
            
            <motion.h2 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="text-4xl md:text-5xl font-display font-black text-[hsl(218,60%,9%)] mb-12 leading-tight"
            >
              Built for the Communicators of Africa's Energy Future
            </motion.h2>

            <div className="space-y-4">
              {[
                "Policy Communicators", 
                "Energy Advocates", 
                "Strategic Leaders", 
                "Emerging Voices"
              ].map((title, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="group relative block cursor-default"
                >
                  <h3 className="text-4xl md:text-5xl lg:text-[64px] font-display font-black text-[hsl(218,60%,9%)] uppercase tracking-tighter leading-[0.9] transition-all duration-300 group-hover:translate-x-4 group-hover:text-[hsl(25,95%,52%)]">
                    {title}
                  </h3>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: LAB INSIGHTS */}
      <section className="py-32 w-full relative" style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}>
        <ZigZagSeam color="hsl(38,25%,96%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90" />
        <KentePattern opacity={0.05} color="white" />
        
        <div className="container mx-auto px-6 md:px-12 relative z-10">
          <SectionKicker text="Publications" textColor="white" />
          
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6"
          >
            <h2 className="text-4xl md:text-6xl font-display font-black text-white">
              Lab Insights
            </h2>
          </motion.div>

          <div className="flex flex-col w-full border-t border-white/10">
            {insights.map((insight, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="group flex flex-col md:flex-row md:items-center py-10 border-b border-white/10 transition-colors hover:bg-white/5 cursor-pointer relative"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(25,95%,52%)] transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-out z-20"></div>
                
                <div className="w-full md:w-48 shrink-0 mb-4 md:mb-0 md:pl-6 pr-4">
                  <div className="text-[hsl(25,95%,52%)] text-[10px] font-bold uppercase tracking-widest mb-1">
                    {insight.category}
                  </div>
                  <div className="text-white/20 font-mono text-xs">
                    ISSUE 0{i + 1}
                  </div>
                </div>
                
                <div className="flex-1 md:pr-12 mb-4 md:mb-0">
                  <h3 className="text-2xl font-display font-bold text-white group-hover:text-[hsl(25,95%,52%)] transition-colors mb-2">
                    {insight.title}
                  </h3>
                  <div className="text-white/60 text-sm font-medium">
                    By {insight.author}
                  </div>
                </div>
                
                <div className="w-full md:w-72 shrink-0 flex items-center justify-between">
                  <p className="text-white/70 text-sm leading-relaxed pr-6 max-w-xs">
                    {insight.excerpt}
                  </p>
                  <ArrowRight className="text-[hsl(25,95%,52%)] w-6 h-6 shrink-0 transform -translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 7: JOIN THE LAB CTA */}
      <section className="py-40 w-full relative overflow-hidden" style={{ backgroundColor: 'hsl(25, 95%, 52%)' }}>
        <ZigZagSeam color="hsl(218, 60%, 9%)" position="top" className="absolute top-0 left-0 right-0 z-20 opacity-90" />
        <KentePattern opacity={0.08} color="hsl(218, 60%, 9%)" />
        
        <div className="container mx-auto px-6 text-center relative z-10 flex flex-col items-center">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-6xl md:text-[120px] font-display font-black leading-none mb-8 tracking-tighter group cursor-default text-[hsl(218,60%,9%)]"
          >
            Join the Signal<span className="inline-block group-hover:animate-pulse">.</span>
          </motion.h2>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl md:text-2xl font-medium max-w-2xl mx-auto mb-12"
            style={{ color: 'hsla(218, 60%, 9%, 0.7)' }}
          >
            Register your interest and become part of Africa's energy communications movement.
          </motion.p>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <Button asChild size="lg" className="rounded-none bg-[hsl(218,60%,9%)] hover:bg-[hsl(218,60%,15%)] text-white font-bold px-12 h-16 text-lg transition-transform hover:scale-105 shadow-none border border-[hsl(218,60%,9%)]">
              <Link href="/register">Register Your Interest</Link>
            </Button>
          </motion.div>
        </div>
      </section>
      
    </div>
  );
}
