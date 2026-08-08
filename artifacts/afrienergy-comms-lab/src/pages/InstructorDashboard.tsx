import { courses, liveSessions, instructors } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  DollarSign, 
  BookOpen, 
  TrendingUp, 
  PlusCircle, 
  MoreVertical, 
  Edit, 
  Archive, 
  Video, 
  Star
} from 'lucide-react';
import { Link } from 'wouter';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Mock chart data
const revenueData = [
  { name: 'Jan', revenue: 4000 },
  { name: 'Feb', revenue: 3000 },
  { name: 'Mar', revenue: 5000 },
  { name: 'Apr', revenue: 8000 },
  { name: 'May', revenue: 6500 },
  { name: 'Jun', revenue: 9000 },
];

export default function InstructorDashboard() {
  const instructor = instructors[0]; // Mock logged-in instructor
  const myCourses = courses.filter(c => c.instructorId === instructor.id);
  const myUpcomingSessions = liveSessions.filter(ls => ls.instructorId === instructor.id && ls.isUpcoming);

  return (
    <div className="container mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold mb-2">Welcome back, {instructor.name.split(' ')[0]}</h1>
          <p className="text-muted-foreground text-lg">Here's what's happening with your courses today.</p>
        </div>
        <Button size="lg" className="shadow-md shadow-primary/20" asChild>
          <Link href="/create-course">
            <PlusCircle className="mr-2 h-5 w-5" />
            Create New Course
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-none">+12%</Badge>
          </div>
          <div className="text-3xl font-bold mb-1">{instructor.studentCount.toLocaleString()}</div>
          <div className="text-sm font-medium text-muted-foreground">Total Learners</div>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-none">+18%</Badge>
          </div>
          <div className="text-3xl font-bold mb-1">$24,500</div>
          <div className="text-sm font-medium text-muted-foreground">Total Revenue</div>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-accent/20 text-accent-foreground flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold mb-1">{instructor.courseCount}</div>
          <div className="text-sm font-medium text-muted-foreground">Active Courses</div>
        </div>

        <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold mb-1">4.8/5.0</div>
          <div className="text-sm font-medium text-muted-foreground">Average Rating</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Chart */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Revenue Overview</h2>
              <select className="bg-muted text-sm rounded-md px-3 py-1 border border-border outline-none">
                <option>Last 6 Months</option>
                <option>This Year</option>
              </select>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }} 
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Courses Table */}
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
              <h2 className="text-xl font-bold">Your Courses</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-4 font-medium">Course</th>
                    <th className="px-6 py-4 font-medium">Price</th>
                    <th className="px-6 py-4 font-medium">Learners</th>
                    <th className="px-6 py-4 font-medium">Rating</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {myCourses.map((course) => (
                    <tr key={course.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img src={course.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover" />
                          <div className="font-bold max-w-[200px] truncate">{course.title}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium">${course.price}</td>
                      <td className="px-6 py-4">{course.learnerCount.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-accent fill-current" />
                          {course.rating}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem><Edit className="w-4 h-4 mr-2" /> Edit Course</DropdownMenuItem>
                            <DropdownMenuItem><Archive className="w-4 h-4 mr-2" /> Archive</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Upcoming Live Sessions</h2>
              <Button variant="ghost" size="sm" className="text-primary h-auto py-1 px-2" asChild>
                <Link href="/create-course">Schedule</Link>
              </Button>
            </div>
            
            {myUpcomingSessions.length > 0 ? (
              <div className="space-y-4">
                {myUpcomingSessions.map(session => {
                  const date = new Date(session.date);
                  return (
                    <div key={session.id} className="border border-border rounded-xl p-4 hover:border-primary/50 transition-colors bg-muted/10">
                      <div className="flex items-start justify-between mb-3">
                        <div className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded">
                          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                        <Badge variant="outline" className="text-xs">{session.platform}</Badge>
                      </div>
                      <h4 className="font-bold mb-1 leading-tight">{session.title}</h4>
                      <div className="text-sm text-muted-foreground mb-4">
                        {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} • {session.duration}
                      </div>
                      <Button className="w-full" size="sm" asChild>
                        <a href={session.joinUrl} target="_blank" rel="noreferrer">
                          <Video className="w-4 h-4 mr-2" /> Start Session
                        </a>
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No upcoming sessions.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
