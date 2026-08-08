import { useParams, Link } from 'wouter';
import { courses, instructors, modules, lessons } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Star, Clock, Users, PlayCircle, FileText, CheckCircle2, ChevronDown, GraduationCap, Calendar, Share2 } from 'lucide-react';
import { useState } from 'react';

export default function CourseDetail() {
  const { id } = useParams();
  const course = courses.find(c => c.id === id);
  const instructor = instructors.find(i => i.id === course?.instructorId);
  const courseModules = modules.filter(m => m.courseId === course?.id).sort((a, b) => a.order - b.order);
  
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({
    [courseModules[0]?.id]: true // Expand first module by default
  });

  if (!course) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h2 className="text-2xl font-bold mb-4">Course not found</h2>
        <Button asChild><Link href="/courses">Back to Catalog</Link></Button>
      </div>
    );
  }

  const toggleModule = (moduleId: string) => {
    setExpandedModules(prev => ({
      ...prev,
      [moduleId]: !prev[moduleId]
    }));
  };

  return (
    <div className="pb-24 lg:pb-0">
      {/* Course Banner */}
      <div className="bg-sidebar text-sidebar-foreground pt-12 pb-24 border-b border-sidebar-border relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 mix-blend-overlay noise-bg"></div>
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-3xl">
            <div className="flex gap-2 mb-6">
              <Badge className="bg-primary/20 text-primary border-none hover:bg-primary/30">{course.category}</Badge>
              <Badge variant="outline" className="text-sidebar-foreground border-sidebar-border">{course.level}</Badge>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6 leading-tight">
              {course.title}
            </h1>
            <p className="text-xl text-sidebar-foreground/80 mb-8 leading-relaxed">
              {course.description}
            </p>
            
            <div className="flex flex-wrap items-center gap-6 text-sm font-medium">
              <div className="flex items-center gap-2">
                <div className="flex items-center text-accent">
                  <Star className="w-5 h-5 fill-current" />
                  <span className="ml-1 text-sidebar-foreground">{course.rating}</span>
                </div>
                <span className="text-sidebar-foreground/60">(128 ratings)</span>
              </div>
              <div className="flex items-center gap-2 text-sidebar-foreground/80">
                <Users className="w-5 h-5" />
                {course.learnerCount.toLocaleString()} learners enrolled
              </div>
              <div className="flex items-center gap-2 text-sidebar-foreground/80">
                <Clock className="w-5 h-5" />
                {course.duration}
              </div>
            </div>
            
            <div className="mt-8 flex items-center gap-4">
              <img src={instructor?.imageUrl} alt={instructor?.name} className="w-12 h-12 rounded-full border-2 border-primary object-cover" />
              <div>
                <div className="text-sm text-sidebar-foreground/60">Instructed by</div>
                <div className="font-bold text-lg">{instructor?.name}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 -mt-12 relative z-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-12 bg-background p-6 md:p-10 rounded-2xl border border-border shadow-xl">
            
            {/* What you'll learn */}
            <section>
              <h2 className="text-2xl font-bold mb-6 font-display">What you'll learn</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {course.whatYouWillLearn.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <hr className="border-border" />

            {/* Curriculum */}
            <section>
              <div className="flex justify-between items-end mb-6">
                <h2 className="text-2xl font-bold font-display">Curriculum</h2>
                <div className="text-sm text-muted-foreground">{courseModules.length} modules • {lessons.filter(l => courseModules.some(m => m.id === l.moduleId)).length} lessons</div>
              </div>
              
              <div className="space-y-4">
                {courseModules.map((module) => {
                  const moduleLessons = lessons.filter(l => l.moduleId === module.id).sort((a, b) => a.order - b.order);
                  const isExpanded = expandedModules[module.id];
                  
                  return (
                    <div key={module.id} className="border border-border rounded-xl overflow-hidden bg-card">
                      <button 
                        onClick={() => toggleModule(module.id)}
                        className="w-full px-6 py-4 flex items-center justify-between bg-muted/30 hover:bg-muted transition-colors text-left"
                      >
                        <div className="font-bold text-lg">Module {module.order}: {module.title}</div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{moduleLessons.length} lessons</span>
                          <ChevronDown className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                      
                      {isExpanded && (
                        <div className="px-6 py-2 divide-y divide-border/50">
                          {moduleLessons.map(lesson => (
                            <div key={lesson.id} className="py-4 flex items-center justify-between group">
                              <div className="flex items-center gap-3">
                                {lesson.type === 'video' && <PlayCircle className="w-5 h-5 text-primary" />}
                                {lesson.type === 'text' && <FileText className="w-5 h-5 text-secondary" />}
                                {lesson.type === 'quiz' && <CheckCircle2 className="w-5 h-5 text-accent" />}
                                <span className="font-medium group-hover:text-primary transition-colors">{lesson.title}</span>
                              </div>
                              {lesson.duration && (
                                <div className="text-sm text-muted-foreground">{lesson.duration}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <hr className="border-border" />

            {/* Instructor */}
            <section>
              <h2 className="text-2xl font-bold mb-6 font-display">Your Instructor</h2>
              <div className="flex flex-col sm:flex-row gap-6">
                <img src={instructor?.imageUrl} alt={instructor?.name} className="w-32 h-32 rounded-xl object-cover shadow-md border border-border" />
                <div>
                  <h3 className="text-xl font-bold mb-1">{instructor?.name}</h3>
                  <div className="text-primary font-medium mb-4">{instructor?.title}</div>
                  <div className="flex gap-4 text-sm text-muted-foreground mb-4">
                    <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {instructor?.studentCount} Students</span>
                    <span className="flex items-center gap-1"><PlayCircle className="w-4 h-4" /> {instructor?.courseCount} Courses</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {instructor?.bio}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar Floating Card — desktop only */}
          <div className="hidden lg:block lg:sticky lg:top-24 space-y-6">
            <div className="bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
              <div className="aspect-video relative">
                <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-full flex items-center justify-center border border-white/30 cursor-pointer hover:scale-110 transition-transform">
                    <PlayCircle className="w-8 h-8 text-white fill-current" />
                  </div>
                </div>
              </div>
              
              <div className="p-6">
                <div className="text-4xl font-bold mb-6 text-foreground">${course.price}</div>
                
                <Button size="lg" className="w-full h-14 text-lg font-bold mb-4 shadow-lg shadow-primary/20" asChild>
                  <Link href={`/enroll/${course.id}`}>Enroll Now</Link>
                </Button>
                
                <p className="text-center text-sm text-muted-foreground mb-6">30-Day Money-Back Guarantee</p>
                
                <div className="space-y-4 text-sm font-medium text-foreground">
                  <div className="flex justify-between pb-4 border-b border-border">
                    <span className="flex items-center gap-2 text-muted-foreground"><GraduationCap className="w-4 h-4" /> Completion Certificate</span>
                    <span>Yes</span>
                  </div>
                  <div className="flex justify-between pb-4 border-b border-border">
                    <span className="flex items-center gap-2 text-muted-foreground"><Calendar className="w-4 h-4" /> Live Sessions</span>
                    <span>Included</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground"><Clock className="w-4 h-4" /> Access</span>
                    <span>Lifetime</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-muted/50 p-4 border-t border-border flex justify-center">
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                  <Share2 className="w-4 h-4 mr-2" /> Share this course
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky enroll bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border px-4 py-3 flex items-center gap-4">
        <div className="font-bold text-2xl flex-shrink-0">${course.price}</div>
        <Link href={`/enroll/${course.id}`} className="flex-1">
          <button className="w-full py-3 px-6 bg-primary text-primary-foreground font-bold text-sm rounded-lg">
            Enroll Now
          </button>
        </Link>
      </div>
    </div>
  );
}
