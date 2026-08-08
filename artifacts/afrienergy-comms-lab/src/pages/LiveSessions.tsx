import { useState } from 'react';
import { liveSessions, courses } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarIcon, Video, Clock, Users, PlayCircle, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

export default function LiveSessions() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  
  // Sort sessions by date
  const upcoming = liveSessions.filter(ls => ls.isUpcoming).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = liveSessions.filter(ls => !ls.isUpcoming);

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold mb-4">Live Sessions Hub</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Join interactive workshops, Q&A sessions, and networking events. Learn directly from experts in real-time.
          </p>
        </div>
        <Button size="lg" className="shadow-md shadow-primary/20" asChild>
          <Link href="/instructor">
            <Plus className="w-5 h-5 mr-2" /> Host a Session
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* Main List */}
        <div className="lg:col-span-2 space-y-12">
          <section>
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
              </span>
              Upcoming Events
            </h2>
            
            <div className="space-y-4">
              {upcoming.map((session) => {
                const date = new Date(session.date);
                const course = courses.find(c => c.id === session.courseId);
                
                return (
                  <div key={session.id} className="bg-card border border-border p-6 rounded-2xl shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center hover:border-primary/40 transition-colors">
                    <div className="bg-muted rounded-xl p-4 text-center min-w-[100px] flex-shrink-0 border border-border/50">
                      <div className="text-sm font-bold text-destructive uppercase mb-1">{date.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div className="text-3xl font-bold font-display">{date.getDate()}</div>
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex gap-2 mb-2">
                        <Badge variant="outline" className="bg-background">{session.platform}</Badge>
                        {course && <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">{course.category}</Badge>}
                      </div>
                      <h3 className="text-xl font-bold mb-2 leading-tight">{session.title}</h3>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ({session.duration})</span>
                        <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Open to enrolled learners</span>
                      </div>
                    </div>
                    
                    <div className="w-full md:w-auto">
                      <Button size="lg" className="w-full md:w-auto" asChild>
                        <a href={session.joinUrl} target="_blank" rel="noreferrer">
                          <Video className="w-4 h-4 mr-2" /> Join {session.platform}
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-6">Past Recordings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {past.map(session => (
                <div key={session.id} className="bg-card border border-border rounded-xl overflow-hidden group cursor-pointer hover:shadow-md transition-all">
                  <div className="aspect-video bg-muted relative flex items-center justify-center">
                    <Video className="w-12 h-12 text-muted-foreground/30" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <PlayCircle className="w-12 h-12 text-white" />
                    </div>
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-medium">
                      {session.duration}
                    </div>
                  </div>
                  <div className="p-5">
                    <h4 className="font-bold mb-2 line-clamp-1 group-hover:text-primary transition-colors">{session.title}</h4>
                    <div className="text-sm text-muted-foreground">
                      Recorded on {new Date(session.date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Sidebar Calendar */}
        <div className="lg:sticky lg:top-24 h-max">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-primary" /> Calendar View
            </h3>
            
            <div className="border border-border rounded-xl p-2 bg-background flex justify-center">
               <DayPicker 
                mode="single" 
                selected={selectedDate} 
                onSelect={setSelectedDate}
                className="mx-auto"
                modifiers={{
                  hasEvent: upcoming.map(u => new Date(u.date))
                }}
                modifiersStyles={{
                  hasEvent: { fontWeight: 'bold', color: 'hsl(var(--primary))', textDecoration: 'underline' }
                }}
              />
            </div>
            
            <div className="mt-6 p-4 bg-muted/50 rounded-xl border border-border">
              <div className="font-medium mb-2">Events on selected date:</div>
              <div className="text-sm text-muted-foreground italic">
                {selectedDate?.toLocaleDateString() === new Date().toLocaleDateString() 
                  ? "Select a highlighted date to see events." 
                  : "No events scheduled for this day."}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
