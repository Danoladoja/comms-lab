import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { liveSessions, instructors } from '@/data/mock';
import { motion } from 'framer-motion';
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

const SignalArc = ({ className, opacity = 0.15 }: { className?: string, opacity?: number }) => (
  <div className={`pointer-events-none ${className}`} style={{ opacity }}>
    <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M200 200C200 144.772 155.228 100 100 100" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
      <path d="M200 250C200 167.157 132.843 100 50 100" stroke="currentColor" strokeWidth="2" />
      <path d="M200 300C200 89.543 110.457 0 0 0" stroke="currentColor" strokeWidth="4" />
    </svg>
  </div>
);

const wordAnimation = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 }
};

export default function Home() {
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

  return (
    <div className="flex flex-col w-full font-sans">
      
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
        <div className="absolute top-0 right-0 w-[300px] h-[300px] text-white rotate-90 origin-top-right z-0">
          <SignalArc opacity={0.15} className="w-full h-full" />
        </div>

        {/* Enormous Background Text */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden">
          <span className="text-[120px] md:text-[180px] font-black font-display text-white whitespace-nowrap opacity-5 select-none tracking-tighter">
            COMMS LAB
          </span>
        </div>

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
              <div className="overflow-hidden">
                {line1Words.map((word, i) => (
                  <motion.span key={`l1-${i}`} className="inline-block text-white font-normal mr-4" variants={wordAnimation} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                    {word}
                  </motion.span>
                ))}
              </div>
              <div className="overflow-hidden">
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
              <Button asChild size="lg" className="rounded-none bg-[hsl(25,95%,52%)] hover:bg-[hsl(25,95%,45%)] text-[hsl(218,60%,9%)] font-bold px-8 h-14 text-base">
                <Link href="/register">Register Your Interest</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-none border-white text-white hover:bg-white hover:text-[hsl(218,60%,9%)] bg-transparent font-bold px-8 h-14 text-base">
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

      {/* SECTION 2: MANIFESTO */}
      <section className="py-32 w-full bg-[hsl(38,25%,96%)] text-[hsl(218,60%,9%)]">
        <div className="px-6 md:px-12 w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8 }}
            className="w-full flex flex-col items-center text-center"
          >
            <h2 className="text-3xl md:text-5xl max-w-5xl mx-auto font-medium font-serif italic leading-snug text-foreground">
              We exist at the intersection of words, energy, and power — training the communicators who will define how Africa's energy story is told.
            </h2>
            
            <div className="w-[200px] h-[2px] bg-[hsl(25,95%,52%)] my-12"></div>
            
            <div className="flex flex-wrap justify-center items-center gap-4 text-sm font-bold uppercase tracking-wider text-foreground/80">
              <span>4 Focus Areas</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(25,95%,52%)]"></span>
              <span>Live Expert Programs</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(25,95%,52%)]"></span>
              <span>A Growing Community</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* SECTION 3: FOCUS AREAS */}
      <section className="relative py-32 w-full overflow-hidden" style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}>
        <KentePattern opacity={0.06} color="white" />
        
        <div className="absolute top-0 right-12 text-[300px] font-display font-black leading-none text-[hsl(25,95%,52%)] opacity-5 pointer-events-none select-none z-0">
          02
        </div>

        <div className="absolute left-6 md:left-12 top-32 z-10 hidden lg:block">
          <div className="transform -rotate-90 origin-left text-white/40 text-xs uppercase tracking-widest font-bold whitespace-nowrap">
            WHAT WE DO
          </div>
        </div>

        <div className="container mx-auto px-6 lg:pl-32 lg:pr-12 relative z-10">
          <motion.h2 
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-6xl font-display font-black text-white mb-16"
          >
            Our Focus
          </motion.h2>

          <div className="flex flex-col w-full border-t border-white/10">
            {focusAreas.map((area, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, x: -40 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
                className="group relative flex flex-col md:flex-row md:items-center py-10 md:py-12 border-b border-white/10 transition-colors hover:bg-white/5 cursor-default overflow-hidden"
              >
                {/* Hover indicator */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(25,95%,52%)] transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-out"></div>
                
                <div className="w-full md:w-32 mb-4 md:mb-0 pl-0 md:pl-6 text-3xl font-mono text-[hsl(25,95%,52%)]">
                  0{i + 1}
                </div>
                
                <div className="flex-1 pr-6">
                  <h3 className="text-2xl md:text-3xl font-display font-bold text-white group-hover:text-[hsl(25,95%,52%)] transition-colors duration-300">
                    {area.title}
                  </h3>
                </div>
                
                <div className="w-full md:w-[320px] shrink-0 mt-4 md:mt-0">
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
      <section className="py-32 w-full" style={{ backgroundColor: 'hsl(15, 75%, 40%)' }}>
        <div className="container mx-auto px-6 md:px-12">
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
                  initial={{ opacity: 0, x: 40 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  className="flex flex-col lg:flex-row lg:items-center py-8 lg:py-10 border-b border-white/20"
                >
                  <div className="flex items-center w-full lg:w-48 shrink-0 mb-6 lg:mb-0">
                    <div className="flex flex-col items-start justify-center">
                      <span className="text-white text-lg font-mono uppercase tracking-widest">{month}</span>
                      <span className="text-white text-4xl md:text-5xl font-display font-bold leading-none">{day}</span>
                    </div>
                    <div className="hidden lg:block w-[2px] h-16 bg-[hsl(25,95%,52%)] ml-auto mr-8"></div>
                  </div>
                  
                  <div className="flex-1 lg:pr-12 mb-6 lg:mb-0">
                    <h3 className="text-2xl md:text-3xl font-display font-bold text-white mb-2 leading-tight">
                      {session.title}
                    </h3>
                    <p className="text-white/70 text-lg font-medium">
                      Host: {host?.name || 'Guest Expert'}
                    </p>
                  </div>
                  
                  <div className="flex flex-row sm:flex-col lg:flex-row items-center gap-4 shrink-0">
                    <div className="px-4 py-1.5 rounded-full bg-white text-[hsl(15,75%,40%)] text-xs font-bold uppercase tracking-wider">
                      {session.platform}
                    </div>
                    <Button asChild className="rounded-full bg-white text-[hsl(15,75%,40%)] hover:bg-white/90 font-bold px-8">
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
        {/* Left Image Panel */}
        <div className="w-full lg:w-[50vw] h-[50vh] lg:h-auto relative shrink-0">
          <img src={heroImg} alt="Audience" className="w-full h-full object-cover" />
          <div className="absolute inset-0 mix-blend-multiply" style={{ backgroundColor: 'hsl(15, 75%, 40%)', opacity: 0.3 }}></div>
        </div>
        
        {/* Right Text Panel */}
        <div className="w-full lg:w-[50vw] relative flex flex-col justify-center px-8 lg:px-20 py-24 lg:py-32 overflow-hidden">
          <div className="absolute top-12 right-12 text-[240px] font-display font-black leading-none text-[hsl(25,95%,52%)] opacity-5 pointer-events-none select-none z-0">
            03
          </div>
          
          <div className="relative z-10 w-full max-w-xl">
            <motion.h2 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
              className="text-4xl md:text-5xl font-display font-black text-[hsl(218,60%,9%)] mb-16 leading-tight"
            >
              Built for the Communicators of Africa's Energy Future
            </motion.h2>

            <div className="space-y-12">
              {[
                { title: "Policy Communicators", desc: "Shaping narratives for government and regulatory bodies" },
                { title: "Energy Advocates", desc: "Driving public consensus for sustainable infrastructure" },
                { title: "Strategic Leaders", desc: "Guiding the transition at the enterprise level" },
                { title: "Emerging Voices", desc: "The next generation of African energy storytellers" }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="pl-6 border-l-2 border-[hsl(25,95%,52%)]"
                >
                  <h3 className="text-2xl font-display font-bold text-[hsl(218,60%,9%)] mb-1">
                    {item.title}
                  </h3>
                  <p className="text-foreground/60 text-sm font-serif italic">
                    {item.desc}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6: LAB INSIGHTS */}
      <section className="py-32 w-full relative" style={{ backgroundColor: 'hsl(218, 60%, 9%)' }}>
        <KentePattern opacity={0.05} color="white" />
        
        <div className="container mx-auto px-6 md:px-12 relative z-10">
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
                className="group flex flex-col md:flex-row md:items-center py-10 border-b border-white/10 transition-colors hover:bg-white/5 cursor-pointer"
              >
                <div className="w-full md:w-48 shrink-0 mb-4 md:mb-0 pr-4">
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
        <KentePattern opacity={0.08} color="hsl(218, 60%, 9%)" />
        
        <div className="container mx-auto px-6 text-center relative z-10 flex flex-col items-center">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-6xl md:text-[120px] font-display font-black leading-none mb-8 tracking-tighter"
            style={{ color: 'hsl(218, 60%, 9%)' }}
          >
            Join the Signal.
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
            <Button asChild size="lg" className="rounded-full bg-[hsl(218,60%,9%)] hover:bg-[hsl(218,60%,15%)] text-white font-bold px-12 h-16 text-lg transition-transform hover:scale-105">
              <Link href="/register">Register Your Interest</Link>
            </Button>
          </motion.div>
        </div>
      </section>
      
    </div>
  );
}
