import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { liveSessions, instructors } from '@/data/mock';
import { motion } from 'framer-motion';
import { ArrowRight, Video, Users, BookOpen, Globe2, Lightbulb, Zap, LineChart, FileText } from 'lucide-react';
import heroImg from '@assets/hero.jpg';

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

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-32 md:pt-32 md:pb-48 bg-background noise-bg border-b border-border">
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-[600px] h-[600px] bg-secondary/5 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="max-w-2xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary font-medium text-sm mb-6 border border-primary/20 tracking-wide uppercase">
                The Definitive Hub
              </div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6 text-foreground font-display">
                Shaping the <span className="text-primary italic font-serif">Minds</span> that Power Africa.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed max-w-xl">
                The intellectual home for Africa's next generation of energy leaders. Advancing knowledge across the energy transition, sustainable infrastructure, policy, and communications.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild className="rounded-full text-base h-14 px-8 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all font-bold">
                  <Link href="/register">
                    Register Your Interest <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="rounded-full text-base h-14 px-8 bg-background hover:bg-muted font-bold border-2">
                  <Link href="/live-sessions">
                    View Upcoming Programs
                  </Link>
                </Button>
              </div>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative lg:ml-auto w-full max-w-lg aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl shadow-foreground/10 border-4 border-background"
            >
              <img src={heroImg} alt="Afrienergy Comms Lab" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-foreground/20 to-transparent mix-blend-multiply" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Mission Statement Strip */}
      <section id="about" className="py-24 bg-sidebar text-sidebar-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 noise-bg mix-blend-overlay pointer-events-none"></div>
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl md:text-5xl font-display font-medium leading-tight md:leading-tight">
              We exist to build the minds that will drive the continent's energy transition. <span className="text-sidebar-primary italic font-serif">A sanctuary for rigorous thinking, bold policy, and transformative leadership.</span>
            </h2>
          </div>
        </div>
      </section>

      {/* Focus Areas */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium text-sm mb-4 uppercase tracking-wider">
              Pillars of Practice
            </div>
            <h2 className="text-4xl md:text-5xl font-bold mb-6 font-display">Core Focus Areas</h2>
            <p className="text-lg text-muted-foreground">
              Our initiatives span the critical domains necessary to navigate and lead Africa's complex energy landscape.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              { icon: Globe2, title: "Energy Transition & Policy", desc: "Navigating regulatory frameworks, international climate agreements, and the economics of shifting from fossil dependency to renewable adoption." },
              { icon: Zap, title: "Sustainable Infrastructure", desc: "Building resilient physical and digital systems capable of scaling across diverse geographical realities and overcoming connectivity challenges." },
              { icon: Users, title: "Energy Communications & Advocacy", desc: "Mastering the narrative power required to align stakeholders, secure financing, and drive public consensus on critical energy projects." },
              { icon: Lightbulb, title: "Innovation & Technology", desc: "Exploring the frontier of decentralized grids, storage solutions, and data-driven grid management specific to the African context." }
            ].map((area, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                key={i}
                className="group flex flex-col sm:flex-row gap-6 p-8 bg-card rounded-3xl border border-border shadow-sm hover:shadow-md transition-all"
              >
                <div className="w-16 h-16 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                  <area.icon className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold mb-3 font-display">{area.title}</h3>
                  <p className="text-muted-foreground leading-relaxed mb-6">
                    {area.desc}
                  </p>
                  <Button variant="link" asChild className="p-0 h-auto text-primary font-bold group-hover:text-primary/80">
                    <Link href="/courses">
                      Learn More <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming Live Programs */}
      <section className="py-24 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Upcoming Live Programs</h2>
              <p className="text-lg text-muted-foreground">Join expert-led sessions designed to tackle immediate challenges and explore emerging opportunities.</p>
            </div>
            <Button variant="outline" asChild className="font-bold border-2 rounded-full">
              <Link href="/live-sessions">View Calendar</Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcomingSessions.map((session, i) => {
              const host = instructors.find(inst => inst.id === session.instructorId);
              return (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  key={session.id} 
                  className="bg-card rounded-2xl p-6 border border-border flex flex-col h-full shadow-sm hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary/10 text-secondary text-xs font-bold uppercase tracking-wider rounded-md">
                      <Video className="w-3 h-3" /> Live Session
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-foreground">
                        {new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(session.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold mb-4 font-display leading-tight">{session.title}</h3>
                  
                  <div className="flex items-center gap-3 mt-auto mb-6">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-muted">
                      {host && <img src={host.imageUrl} alt={host.name} className="w-full h-full object-cover" />}
                    </div>
                    <div>
                      <div className="text-sm font-bold">{host?.name || 'Guest Expert'}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{host?.title}</div>
                    </div>
                  </div>
                  
                  <Button asChild className="w-full font-bold rounded-xl shadow-none">
                    <Link href="/live-sessions">Reserve Your Spot</Link>
                  </Button>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative">
              <div className="aspect-square max-w-md mx-auto relative">
                <div className="absolute inset-0 bg-primary/10 rounded-[3rem] transform -rotate-6"></div>
                <div className="absolute inset-0 bg-secondary/10 rounded-[3rem] transform rotate-3"></div>
                <div className="absolute inset-0 bg-card border border-border shadow-xl rounded-[3rem] overflow-hidden p-8 flex flex-col justify-center">
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/20 text-primary rounded-2xl flex items-center justify-center shrink-0"><LineChart className="w-6 h-6" /></div>
                      <div>
                        <div className="font-bold text-lg">Policy Makers</div>
                        <div className="text-sm text-muted-foreground">Shaping regulatory environments</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-secondary/20 text-secondary rounded-2xl flex items-center justify-center shrink-0"><Zap className="w-6 h-6" /></div>
                      <div>
                        <div className="font-bold text-lg">Engineers & Innovators</div>
                        <div className="text-sm text-muted-foreground">Building resilient infrastructure</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-accent/20 text-accent-foreground rounded-2xl flex items-center justify-center shrink-0"><Users className="w-6 h-6" /></div>
                      <div>
                        <div className="font-bold text-lg">Communicators</div>
                        <div className="text-sm text-muted-foreground">Driving narrative & advocacy</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-muted text-foreground rounded-2xl flex items-center justify-center shrink-0"><BookOpen className="w-6 h-6" /></div>
                      <div>
                        <div className="font-bold text-lg">Emerging Leaders</div>
                        <div className="text-sm text-muted-foreground">Students & early-career professionals</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 font-display">Who is the Lab for?</h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                The transition requires a multidisciplinary approach. Afrienergy Comms Lab convenes those who are actively participating in or preparing to enter the energy sector across the continent. 
                <br /><br />
                Whether you are drafting policy, engineering decentralized grids, advocating for climate finance, or studying the future of energy economics—this is your community.
              </p>
              <ul className="space-y-4 mb-8">
                {['Rigorous intellectual environment', 'Cross-disciplinary networking', 'Access to leading practitioners', 'Action-oriented discourse'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                    <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-primary"></div>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Insights Preview */}
      <section className="py-24 bg-sidebar text-sidebar-foreground">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Lab Insights</h2>
              <p className="text-lg text-sidebar-foreground/70">Expert perspectives, research summaries, and analytical essays from our community of practitioners.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {insights.map((insight, i) => (
              <div key={i} className="group cursor-pointer border-t border-sidebar-border pt-6 flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sidebar-primary text-xs font-bold uppercase tracking-wider">{insight.category}</span>
                </div>
                <h3 className="text-xl font-bold mb-4 font-display group-hover:text-sidebar-primary transition-colors leading-snug">{insight.title}</h3>
                <p className="text-sidebar-foreground/70 text-sm mb-6 flex-grow">{insight.excerpt}</p>
                <div className="flex items-center gap-2 text-sm font-medium mt-auto">
                  <FileText className="w-4 h-4 text-sidebar-foreground/40" />
                  <span>By {insight.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Community CTA */}
      <section className="py-32 bg-primary text-primary-foreground relative overflow-hidden text-center">
        <div className="absolute inset-0 opacity-10 noise-bg mix-blend-overlay"></div>
        {/* Subtle decorative circles */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-primary-foreground/10 rounded-full pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-primary-foreground/20 rounded-full pointer-events-none"></div>
        
        <div className="container mx-auto px-4 md:px-6 relative z-10 max-w-3xl">
          <h2 className="text-5xl md:text-6xl font-bold mb-6 font-display">Join the Lab</h2>
          <p className="text-xl text-primary-foreground/90 mb-10 leading-relaxed font-medium">
            Become part of the growing movement of professionals, policymakers, and innovators shaping Africa's energy future.
          </p>
          <Button size="lg" variant="secondary" asChild className="rounded-full text-lg h-16 px-10 font-bold shadow-2xl hover:scale-105 transition-transform text-primary">
            <Link href="/register">Register Your Interest</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
