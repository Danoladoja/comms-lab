import { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { courses, instructors } from '@/data/mock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, Clock, Users, Star, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CATEGORIES = ['All', 'Technology', 'Energy', 'Business', 'Communications'];
const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export default function CourseCatalog() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeLevel, setActiveLevel] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      const matchesSearch = course.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            course.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === 'All' || course.category === activeCategory;
      const matchesLevel = activeLevel === 'All' || course.level === activeLevel;
      
      return matchesSearch && matchesCategory && matchesLevel;
    });
  }, [searchQuery, activeCategory, activeLevel]);

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      <div className="mb-12">
        <h1 className="text-4xl font-display font-bold mb-4">Explore Courses</h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Discover programs taught by leading experts across Africa. Level up your skills in tech, energy, business, and communications.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Filters (Desktop) / Expandable (Mobile) */}
        <aside className="w-full lg:w-64 flex-shrink-0">
          <div className="flex items-center gap-2 mb-4 lg:hidden">
            <Button variant="outline" className="w-full" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="w-4 h-4 mr-2" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </Button>
          </div>

          <div className={`space-y-8 ${showFilters ? 'block' : 'hidden lg:block'}`}>
            <div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Search courses..." 
                  className="pl-9 bg-card"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">Category</h3>
              <div className="flex flex-col gap-2">
                {CATEGORIES.map(category => (
                  <button
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeCategory === category 
                        ? 'bg-primary/10 text-primary font-medium' 
                        : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">Level</h3>
              <div className="flex flex-col gap-2">
                {LEVELS.map(level => (
                  <button
                    key={level}
                    onClick={() => setActiveLevel(level)}
                    className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeLevel === level 
                        ? 'bg-secondary/10 text-secondary font-medium' 
                        : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Course Grid */}
        <main className="flex-1">
          <div className="flex justify-between items-center mb-6">
            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredCourses.length}</span> courses
            </div>
          </div>

          {filteredCourses.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-2">No courses found</h3>
              <p className="text-muted-foreground mb-6">Try adjusting your search or filters to find what you're looking for.</p>
              <Button 
                variant="outline" 
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('All');
                  setActiveLevel('All');
                }}
              >
                Clear all filters
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {filteredCourses.map((course) => {
                  const instructor = instructors.find(i => i.id === course.instructorId);
                  
                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      key={course.id}
                      className="group flex flex-col bg-card rounded-2xl overflow-hidden border border-border shadow-sm hover:shadow-xl transition-all"
                    >
                      <div className="relative aspect-video overflow-hidden">
                        <img 
                          src={course.thumbnail} 
                          alt={course.title} 
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                        />
                        <div className="absolute top-3 left-3 flex gap-2">
                          <Badge variant="secondary" className="bg-background/90 text-foreground backdrop-blur-sm border-none pointer-events-none">
                            {course.category}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="p-5 flex flex-col flex-1">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 font-medium">
                          <span className="flex items-center"><Clock className="w-3 h-3 mr-1" /> {course.duration}</span>
                          <span className="flex items-center"><Star className="w-3 h-3 mr-1 text-accent fill-current" /> {course.rating}</span>
                          <span className="flex items-center px-2 py-0.5 bg-muted rounded-full">{course.level}</span>
                        </div>
                        
                        <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors leading-tight line-clamp-2">
                          {course.title}
                        </h3>
                        
                        <div className="flex items-center gap-3 mt-auto pt-4">
                          <img src={instructor?.imageUrl} alt={instructor?.name} className="w-8 h-8 rounded-full object-cover" />
                          <div className="text-sm font-medium text-foreground">{instructor?.name}</div>
                        </div>
                      </div>
                      
                      <div className="px-5 py-4 border-t border-border flex items-center justify-between bg-muted/20">
                        <div className="font-bold text-lg">${course.price}</div>
                        <Button variant="ghost" size="sm" asChild className="group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          <Link href={`/courses/${course.id}`}>
                            Details <ArrowRight className="w-4 h-4 ml-1 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                          </Link>
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
