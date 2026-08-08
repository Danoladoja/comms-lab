import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { liveSessions, instructors } from '@/data/mock';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import heroImg from '@assets/hero.jpg';

export default function Home() {
  const upcomingSessions = liveSessions.filter(s => s.isUpcoming).slice(0, 3);
  
  const insights = [
    {
      title: "The Communications Gap in Africa's Energy Transition",
      author: "Dr. Amina Ndlovu",
      category: "Energy Policy",
      isFeatured: true,
    },
    {
      title: "Why Grid Financing Needs a New Narrative",
      author: "Kwame Osei",
      category: "Infrastructure",
      isFeatured: false,
    },
    {
      title: "Advocacy Lessons from the ECOWAS Energy Summit",
      author: "Sarah Adeyemi",
      category: "Advocacy",
      isFeatured: false,
    }
  ];

  return (
    <div className="flex flex-col w-full">
      {/* 1. HERO - Full Viewport, Cinematic */}
      <section className="relative h-[100vh] min-h-[600px] w-full flex items-end -mt-[72px]">
        <img 
          src={heroImg} 
          alt="African energy landscape" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        {/* Overlay gradient: transparent top-right to dark bottom-left */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0D2B2E]/90 via-[#0D2B2E]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0D2B2E]/70 via-[#0D2B2E]/20 to-transparent h-40 pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-8 relative z-10 pb-20 md:pb-32 w-full flex flex-col md:flex-row md:items-end justify-between gap-12">
          {/* Left Side: Headline & CTAs */}
          <div className="max-w-3xl">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: { staggerChildren: 0.2 }
                }
              }}
            >
              <motion.div 
                variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                className="text-secondary font-medium tracking-[0.2em] text-xs md:text-sm uppercase mb-6"
              >
                The Learning Lab for Africa's Energy Future
              </motion.div>
              
              <motion.h1 
                variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                className="font-serif text-5xl md:text-7xl lg:text-[6rem] leading-[1.05] text-white mb-10"
              >
                Shaping the Minds that Power Africa.
              </motion.h1>
              
              <motion.div 
                variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                className="flex flex-col sm:flex-row gap-4"
              >
                <Button size="lg" asChild className="rounded-none h-14 px-8 bg-white text-black hover:bg-white/90 font-medium text-base">
                  <Link href="/register">Register Your Interest</Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="rounded-none h-14 px-8 bg-transparent border-white text-white hover:bg-white hover:text-black font-medium text-base">
                  <Link href="/live-sessions">View Upcoming Programs</Link>
                </Button>
              </motion.div>
            </motion.div>
          </div>

          {/* Right Side / Bottom: Next Program Box */}
          {upcomingSessions.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8, duration: 0.6 }}
              className="bg-white/10 backdrop-blur-md border border-white/20 p-5 w-full md:w-auto md:min-w-[300px]"
            >
              <div className="text-white/60 text-xs uppercase tracking-wider mb-2 font-medium">Next Program</div>
              <div className="text-white font-medium text-sm md:text-base">
                {new Date(upcomingSessions[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {upcomingSessions[0].title}
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* 2. MISSION - Full-width Dark Statement */}
      <section id="about" className="py-32 md:py-48 bg-sidebar text-white relative">
        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className="max-w-[900px] mx-auto text-center relative py-12"
          >
            {/* Thin vertical framing borders */}
            <div className="absolute left-0 top-0 bottom-0 w-px bg-white/20 hidden md:block" />
            <div className="absolute right-0 top-0 bottom-0 w-px bg-white/20 hidden md:block" />
            
            <h2 className="text-4xl md:text-5xl lg:text-[56px] font-serif leading-tight mb-8 px-4 md:px-12">
              We believe the energy transition in Africa will be led by Africans — and that starts with knowledge.
            </h2>
            <p className="text-white/60 text-lg md:text-xl font-medium max-w-2xl mx-auto px-4">
              A sanctuary for rigorous thinking, bold policy, and transformative leadership.
            </p>
          </motion.div>
        </div>
      </section>

      {/* 3. FOCUS AREAS - Numbered Editorial List */}
      <section className="py-32 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16">
            <div className="text-muted-foreground text-sm uppercase tracking-widest font-medium mb-4">Areas of Practice</div>
            <h2 className="text-5xl md:text-6xl font-serif text-foreground">Where we work.</h2>
          </div>
          
          <div className="border-t border-border mt-8">
            {[
              { id: '01', title: "Energy Transition & Policy", desc: "Navigating the policy landscape driving Africa's shift to sustainable energy." },
              { id: '02', title: "Sustainable Infrastructure", desc: "Understanding the engineering and financing of African energy infrastructure." },
              { id: '03', title: "Energy Communications & Advocacy", desc: "The art of telling Africa's energy story to the world." },
              { id: '04', title: "Innovation & Technology in Energy", desc: "Deploying technology to leapfrog conventional energy systems." }
            ].map((area, i) => (
              <motion.div 
                key={area.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group flex flex-col md:flex-row md:items-center py-10 md:py-14 border-b border-border hover:bg-muted transition-colors duration-500 px-4 md:px-8 -mx-4 md:mx-0 cursor-pointer"
              >
                <div className="md:w-1/4 mb-4 md:mb-0">
                  <span className="font-serif text-6xl md:text-[80px] leading-none text-primary/20 group-hover:text-primary/40 transition-colors">
                    {area.id}
                  </span>
                </div>
                <div className="md:w-1/2 pr-8">
                  <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-3">{area.title}</h3>
                  <p className="text-muted-foreground text-lg">{area.desc}</p>
                </div>
                <div className="md:w-1/4 flex justify-end items-center mt-6 md:mt-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform -translate-x-4 group-hover:translate-x-0">
                  <ArrowRight className="text-primary w-8 h-8" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. UPCOMING PROGRAMS - Editorial Event List */}
      <section className="py-32 bg-muted border-y border-border">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16">
            <div className="text-muted-foreground text-sm uppercase tracking-widest font-medium mb-4">Live Programs</div>
            <h2 className="text-4xl md:text-5xl font-serif text-foreground">Upcoming Sessions.</h2>
          </div>

          <div className="flex flex-col border-t border-border">
            {upcomingSessions.map((session, i) => {
              const host = instructors.find(inst => inst.id === session.instructorId);
              return (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  className="grid grid-cols-1 md:grid-cols-12 gap-6 py-8 border-b border-border items-center"
                >
                  {/* Date */}
                  <div className="md:col-span-3 font-serif text-xl md:text-2xl text-foreground">
                    {new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  
                  {/* Title & Host */}
                  <div className="md:col-span-5">
                    <div className="font-bold text-lg md:text-xl text-foreground mb-1">{session.title}</div>
                    <div className="text-muted-foreground">Hosted by {host?.name || 'Lab Expert'}</div>
                  </div>

                  {/* Badge */}
                  <div className="md:col-span-2">
                    <div className="inline-flex border-l-2 border-primary pl-3 py-1 text-sm font-medium text-foreground">
                      {session.platform}
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="md:col-span-2 text-left md:text-right mt-4 md:mt-0">
                    <Link href="/live-sessions" className="text-primary font-medium hover:text-primary/80 transition-colors inline-flex items-center gap-1 group">
                      Reserve Spot <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-16 text-center">
            <Link href="/live-sessions" className="text-primary font-medium hover:text-primary/80 transition-colors text-sm uppercase tracking-wider inline-flex items-center gap-2 group">
              View all upcoming programs <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* 5. WHO THIS IS FOR - Split Editorial */}
      <section className="py-32 md:py-48 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="flex flex-col lg:flex-row border border-border">
            {/* Left Column */}
            <div className="lg:w-1/2 p-8 md:p-16 lg:p-24 border-b lg:border-b-0 lg:border-r border-border flex items-center">
              <h2 className="text-4xl md:text-5xl lg:text-[48px] font-serif leading-[1.1] text-foreground">
                Built for those who will <span className="text-primary">define</span> how Africa powers itself.
              </h2>
            </div>
            
            {/* Right Column */}
            <div className="lg:w-1/2 p-8 md:p-16 flex flex-col justify-center bg-card/30">
              <ul className="flex flex-col w-full">
                {[
                  { label: "Energy Policy Professionals", desc: "Drafting the regulatory frameworks of tomorrow." },
                  { label: "Grid Engineers & Developers", desc: "Architecting decentralized and robust physical systems." },
                  { label: "Energy Finance Specialists", desc: "Structuring capital for transition infrastructure." },
                  { label: "Communications & Media Practitioners", desc: "Shaping the narrative for global stakeholders." },
                  { label: "Graduate Researchers", desc: "Pushing the boundaries of sustainable energy technology." },
                  { label: "Future Energy Leaders", desc: "Students and early-career innovators." }
                ].map((item, i) => (
                  <li key={i} className="py-6 border-b border-border last:border-0 flex items-start gap-6">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2.5 shrink-0" />
                    <div>
                      <div className="font-bold text-foreground text-lg mb-1">{item.label}</div>
                      <div className="text-muted-foreground">{item.desc}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 6. THOUGHT LEADERSHIP - Magazine Layout */}
      <section className="py-32 bg-sidebar text-white">
        <div className="container mx-auto px-4 md:px-8">
          <div className="mb-16">
            <div className="text-white/60 text-sm uppercase tracking-widest font-medium mb-4">Insights & Perspectives</div>
            <h2 className="text-4xl md:text-5xl font-serif">From the Lab.</h2>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Featured Left */}
            <div className="lg:w-[60%] flex flex-col">
              <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-primary to-sidebar-accent flex flex-col justify-end p-8 md:p-12 border border-white/10 group cursor-pointer overflow-hidden">
                <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-500" />
                <div className="relative z-10">
                  <div className="inline-flex px-3 py-1 bg-white/10 backdrop-blur-md text-white text-xs font-medium uppercase tracking-wider mb-6 border border-white/20">
                    {insights[0].category}
                  </div>
                  <h3 className="font-serif text-3xl md:text-4xl leading-tight mb-4 group-hover:text-white/90 transition-colors">
                    {insights[0].title}
                  </h3>
                  <div className="text-white/60 text-sm">
                    By {insights[0].author}
                  </div>
                </div>
              </div>
            </div>

            {/* Smaller Right */}
            <div className="lg:w-[40%] flex flex-col gap-8">
              {insights.slice(1).map((insight, i) => (
                <div key={i} className="flex-1 bg-black/20 border border-white/10 p-8 flex flex-col justify-center group cursor-pointer hover:bg-black/30 transition-colors">
                  <div className="text-primary text-xs font-medium uppercase tracking-wider mb-4">
                    {insight.category}
                  </div>
                  <h3 className="font-serif text-2xl leading-snug mb-4 group-hover:text-white/90 transition-colors">
                    {insight.title}
                  </h3>
                  <div className="text-white/60 text-sm mt-auto">
                    By {insight.author}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-16 text-center">
            <Button variant="outline" asChild className="rounded-none bg-transparent border-white/30 text-white hover:bg-white hover:text-black hover:border-white h-12 px-8 font-medium">
              <Link href="#">Explore all insights →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 7. COMMUNITY CTA - Full-bleed Closing Statement */}
      <section className="py-40 bg-primary text-primary-foreground text-center">
        <div className="container mx-auto px-4 md:px-8 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="text-white/50 text-sm uppercase tracking-[0.3em] font-bold mb-8">
              Join the Movement
            </div>
            <h2 className="text-6xl md:text-[80px] lg:text-[96px] font-serif leading-[1] mb-8">
              The Lab is Open.
            </h2>
            <p className="text-xl md:text-2xl text-white/70 font-medium mb-12 max-w-2xl mx-auto">
              Register to be part of Africa's growing community of energy leaders.
            </p>
            <Button size="lg" variant="outline" asChild className="rounded-none bg-transparent border-white text-white hover:bg-white hover:text-primary h-16 px-10 text-lg font-medium transition-colors">
              <Link href="/register">Register Interest →</Link>
            </Button>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
