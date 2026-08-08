import { courses, liveSessions } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'wouter';
import { PlayCircle, Award, Calendar, ChevronRight, Video, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function LearnerDashboard() {
  // Mock data for enrolled courses (progress injected for visual effect)
  const enrolledCourses = [
    { ...courses[0], progress: 65, lastAccessed: '2 days ago' },
    { ...courses[2], progress: 12, lastAccessed: 'Yesterday' }
  ];

  const upcomingSessions = liveSessions.filter(ls => ls.isUpcoming).slice(0, 2);

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">Welcome back, Student</h1>
        <p className="text-lg text-muted-foreground">Ready to continue your learning journey?</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-10">
          
          <section>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold font-display">In Progress</h2>
            </div>
            
            <div className="space-y-6">
              {enrolledCourses.map(course => (
                <div key={course.id} className="flex flex-col sm:flex-row bg-card rounded-2xl border border-border shadow-sm overflow-hidden group hover:shadow-md transition-all">
                  <div className="w-full sm:w-1/3 md:w-1/4 h-40 sm:h-auto relative">
                    <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/30 backdrop-blur border border-white/50 flex items-center justify-center transform scale-90 group-hover:scale-100 transition-transform">
                        <PlayCircle className="w-6 h-6 text-white fill-current" />
                      </div>
                    </div>
                  </div>
                  <div className="p-6 flex-1 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline" className="mb-2 bg-muted/50">{course.category}</Badge>
                      <span className="text-xs text-muted-foreground">Last accessed: {course.lastAccessed}</span>
                    </div>
                    <h3 className="font-bold text-lg mb-4 line-clamp-1 group-hover:text-primary transition-colors">
                      <Link href={`/courses/${course.id}`}>{course.title}</Link>
                    </h3>
                    
                    <div className="mt-auto">
                      <div className="flex justify-between text-sm font-medium mb-2">
                        <span>{course.progress}% Complete</span>
                      </div>
                      <Progress value={course.progress} className="h-2 bg-muted">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${course.progress}%` }} />
                      </Progress>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold font-display mb-6">Recommended for You</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {courses.slice(1, 3).map(course => (
                <Link key={course.id} href={`/courses/${course.id}`}>
                  <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition-colors group h-full flex flex-col">
                    <div className="aspect-video rounded-lg overflow-hidden mb-4">
                      <img src={course.thumbnail} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
                    </div>
                    <h4 className="font-bold mb-2 group-hover:text-primary transition-colors">{course.title}</h4>
                    <div className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">{course.description}</div>
                    <div className="flex items-center text-sm font-medium text-primary mt-auto">
                      View Details <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Upcoming Live Sessions */}
          <div className="bg-sidebar text-sidebar-foreground rounded-2xl p-6 border border-sidebar-border shadow-md">
            <div className="flex items-center gap-2 mb-6">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold">Upcoming Sessions</h2>
            </div>
            
            <div className="space-y-4">
              {upcomingSessions.map(session => {
                const date = new Date(session.date);
                return (
                  <div key={session.id} className="bg-background rounded-xl p-4 border border-border text-foreground">
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm font-bold text-primary">
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <h4 className="font-bold mb-1 leading-tight">{session.title}</h4>
                    <div className="text-sm text-muted-foreground mb-4">Duration: {session.duration}</div>
                    <Button className="w-full" size="sm" asChild>
                      <a href={session.joinUrl} target="_blank" rel="noreferrer">
                        <Video className="w-4 h-4 mr-2" /> Join {session.platform}
                      </a>
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button variant="link" className="w-full mt-4 text-sidebar-foreground hover:text-primary" asChild>
              <Link href="/live-sessions">View Calendar <ChevronRight className="w-4 h-4 ml-1" /></Link>
            </Button>
          </div>

          {/* Certificates */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Award className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-bold">Your Certificates</h2>
            </div>
            <div className="border border-border rounded-xl p-4 bg-muted/20 hover:bg-muted/40 transition-colors flex items-center justify-between group cursor-pointer" onClick={() => window.location.href='/certificate/cert-123'}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/20 text-accent-foreground flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-sm">Strategic Leadership</div>
                  <div className="text-xs text-muted-foreground">Issued Oct 2024</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
