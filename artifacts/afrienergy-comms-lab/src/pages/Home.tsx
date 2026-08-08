import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { courses, instructors } from '@/data/mock';
import { motion } from 'framer-motion';
import { ArrowRight, Star, BookOpen, Users, Award, PlayCircle, BarChart3, Clock } from 'lucide-react';
import heroImg from '@assets/hero.jpg';

export default function Home() {
  const featuredCourses = courses.slice(0, 3);
  
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
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary font-medium text-sm mb-6 border border-primary/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                World-class learning built for Africa
              </div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6 text-foreground">
                Master the Skills that <span className="text-primary italic font-serif">Power</span> the Future.
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed max-w-xl">
                Join the definitive learning platform for African professionals. Whether you're scaling a startup, mastering renewable economics, or leading teams.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild className="rounded-full text-base h-14 px-8 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
                  <Link href="/courses">
                    Explore Catalog <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="rounded-full text-base h-14 px-8 bg-background hover:bg-muted">
                  <Link href="/instructor">
                    Become an Instructor
                  </Link>
                </Button>
              </div>
              
              <div className="mt-12 flex items-center gap-6">
                <div className="flex -space-x-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-background overflow-hidden bg-muted">
                      <img src={`https://i.pravatar.cc/100?img=${i + 40}`} alt="Student" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <div className="text-sm font-medium">
                  <span className="text-foreground font-bold">10,000+</span> professionals <br/>are already learning
                </div>
              </div>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative lg:ml-auto w-full max-w-lg aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl shadow-foreground/10 border-4 border-background"
            >
              <img src={heroImg} alt="Afrienergy Comms Lab" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/20 to-transparent" />
              
              {/* Floating badges */}
              <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end">
                <div className="bg-background/95 backdrop-blur rounded-2xl p-4 shadow-xl border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary">
                      <Star className="h-6 w-6 fill-current" />
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground font-medium">Platform Rating</div>
                      <div className="text-xl font-bold text-foreground">4.9/5.0</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-sidebar text-sidebar-foreground">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center divide-x divide-sidebar-border/50">
            <div>
              <div className="text-4xl md:text-5xl font-bold text-primary mb-2">50+</div>
              <div className="text-sidebar-foreground/70 font-medium">Expert Courses</div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-bold text-primary mb-2">12k</div>
              <div className="text-sidebar-foreground/70 font-medium">Active Learners</div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-bold text-primary mb-2">98%</div>
              <div className="text-sidebar-foreground/70 font-medium">Completion Rate</div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-bold text-primary mb-2">24/7</div>
              <div className="text-sidebar-foreground/70 font-medium">Community Access</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Courses */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Featured Courses</h2>
              <p className="text-lg text-muted-foreground">Hand-picked programs designed to accelerate your career in Africa's fastest-growing sectors.</p>
            </div>
            <Button variant="ghost" asChild className="group text-primary hover:text-primary hover:bg-primary/5">
              <Link href="/courses">
                View all courses <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {featuredCourses.map((course, i) => {
              const instructor = instructors.find(inst => inst.id === course.instructorId);
              return (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  key={course.id} 
                  className="group flex flex-col bg-card rounded-2xl overflow-hidden border border-border shadow-sm hover:shadow-xl transition-all duration-300"
                >
                  <div className="relative aspect-video overflow-hidden">
                    <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <div className="absolute top-4 left-4">
                      <span className="px-3 py-1 bg-background/90 backdrop-blur text-foreground text-xs font-semibold rounded-full shadow-sm">
                        {course.category}
                      </span>
                    </div>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3 font-medium">
                      <span className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {course.duration}</span>
                      <span>•</span>
                      <span className="flex items-center"><Users className="w-3 h-3 mr-1" /> {course.learnerCount} learners</span>
                    </div>
                    <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors line-clamp-2">{course.title}</h3>
                    
                    <div className="flex items-center gap-3 mt-auto pt-6">
                      <img src={instructor?.imageUrl} alt={instructor?.name} className="w-10 h-10 rounded-full object-cover border-2 border-background" />
                      <div>
                        <div className="text-sm font-bold text-foreground">{instructor?.name}</div>
                        <div className="text-xs text-muted-foreground">{instructor?.title}</div>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/30">
                    <div className="font-bold text-lg">${course.price}</div>
                    <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary hover:bg-primary/10">
                      <Link href={`/courses/${course.id}`}>View Details</Link>
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Platform Features */}
      <section className="py-24 bg-muted/30 relative overflow-hidden">
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything you need to succeed</h2>
            <p className="text-lg text-muted-foreground">A platform designed not just for consuming content, but for true skill acquisition and professional networking.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                <PlayCircle className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Rich Video Learning</h3>
              <p className="text-muted-foreground leading-relaxed">High-quality video courses optimized for all bandwidths, with offline viewing capabilities for mobile learners.</p>
            </div>
            
            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
              <div className="w-12 h-12 bg-secondary/10 text-secondary rounded-xl flex items-center justify-center mb-6">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Live Interactive Sessions</h3>
              <p className="text-muted-foreground leading-relaxed">Join instructors via integrated Zoom and Google Meet sessions for real-time Q&A, workshops, and networking.</p>
            </div>

            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
              <div className="w-12 h-12 bg-accent/20 text-accent-foreground rounded-xl flex items-center justify-center mb-6">
                <Award className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Verified Certificates</h3>
              <p className="text-muted-foreground leading-relaxed">Earn verifiable, beautifully designed certificates upon completion to showcase your skills on LinkedIn.</p>
            </div>

            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
              <div className="w-12 h-12 bg-destructive/10 text-destructive rounded-xl flex items-center justify-center mb-6">
                <BookOpen className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Interactive Assessments</h3>
              <p className="text-muted-foreground leading-relaxed">Test your knowledge with built-in quizzes and assignments that ensure material retention and mastery.</p>
            </div>

            <div className="bg-card p-8 rounded-2xl border border-border shadow-sm lg:col-span-2 flex flex-col md:flex-row items-center gap-8">
              <div className="flex-1">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-3">Powerful Instructor Tools</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">A complete suite for creators. Build courses with a drag-and-drop builder, track student progress, and monitor your revenue in real-time.</p>
                <Button variant="outline" asChild>
                  <Link href="/instructor">Explore Instructor Features</Link>
                </Button>
              </div>
              <div className="flex-1 w-full bg-muted rounded-xl p-4 border border-border">
                {/* Mock dashboard graphic */}
                <div className="flex gap-2 mb-4">
                  <div className="w-full h-24 bg-card rounded-lg border border-border flex items-end p-2 gap-1">
                    <div className="w-1/4 h-[40%] bg-primary/40 rounded-sm"></div>
                    <div className="w-1/4 h-[70%] bg-primary/60 rounded-sm"></div>
                    <div className="w-1/4 h-[50%] bg-primary/80 rounded-sm"></div>
                    <div className="w-1/4 h-[90%] bg-primary rounded-sm"></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-card rounded border border-border w-full"></div>
                  <div className="h-4 bg-card rounded border border-border w-5/6"></div>
                  <div className="h-4 bg-card rounded border border-border w-4/6"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 noise-bg mix-blend-overlay"></div>
        <div className="container mx-auto px-4 md:px-6 relative z-10 text-center max-w-3xl">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 font-display">Ready to accelerate your growth?</h2>
          <p className="text-xl text-primary-foreground/80 mb-10 leading-relaxed">
            Join thousands of professionals building the future of Africa. Start learning today or share your expertise with the world.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button size="lg" variant="secondary" asChild className="rounded-full text-lg h-14 px-8 font-bold hover:scale-105 transition-transform">
              <Link href="/courses">Browse Catalog</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="rounded-full text-lg h-14 px-8 font-bold border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              <Link href="/register">Create Free Account</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
