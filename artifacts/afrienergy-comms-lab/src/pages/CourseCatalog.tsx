import { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { useListPrograms } from '@workspace/api-client-react';
import { acceptsEnrolment } from '@workspace/domain';
import { Input } from '@/components/ui/input';
import { Search, Filter, ArrowRight, Calendar, Clock, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CourseCatalog() {
  const { data: programs = [], isLoading } = useListPrograms();
  const [query, setQuery] = useState('');
  const [activeFocus, setActiveFocus] = useState('All');
  const [activeFormat, setActiveFormat] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  const focusAreas = useMemo(() => ['All', ...Array.from(new Set(programs.map(p => p.tag)))], [programs]);
  const formats = useMemo(() => ['All', ...Array.from(new Set(programs.map(p => p.format)))], [programs]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return programs.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      const matchesFocus = activeFocus === 'All' || p.tag === activeFocus;
      const matchesFormat = activeFormat === 'All' || p.format === activeFormat;
      return matchesSearch && matchesFocus && matchesFormat;
    });
  }, [programs, query, activeFocus, activeFormat]);

  return (
    <div className="container mx-auto px-4 md:px-6 py-12">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-display font-bold mb-4">Programs</h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Practitioner-led programs designed for Africa's energy communicators, policy advocates,
          and strategic storytellers. All programs run in cohorts with limited places.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Filters */}
        <aside className="w-full lg:w-64 flex-shrink-0">
          <div className="flex items-center gap-2 mb-4 lg:hidden">
            <button
              className="w-full flex items-center justify-center gap-2 border border-border rounded-md px-4 py-2 text-sm font-medium"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
          </div>

          <div className={`space-y-8 ${showFilters ? 'block' : 'hidden lg:block'}`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search programs..."
                className="pl-9 bg-card"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-4">Focus Area</h3>
              <div className="flex flex-col gap-1.5">
                {focusAreas.map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFocus(f)}
                    className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeFocus === f ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-muted-foreground mb-4">Format</h3>
              <div className="flex flex-col gap-1.5">
                {formats.map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFormat(f)}
                    className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeFormat === f ? 'bg-secondary/10 text-secondary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {(activeFocus !== 'All' || activeFormat !== 'All' || query) && (
              <button
                onClick={() => { setActiveFocus('All'); setActiveFormat('All'); setQuery(''); }}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Clear all filters
              </button>
            )}
          </div>
        </aside>

        {/* Program Grid */}
        <main className="flex-1">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[0, 1, 2].map(i => (
                <div key={i} className="bg-card rounded-2xl border border-border h-72 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-bold mb-2">No programs found</h3>
              <p className="text-muted-foreground mb-6">Try adjusting your search or filters.</p>
              <button
                className="border border-border rounded-md px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => { setQuery(''); setActiveFocus('All'); setActiveFormat('All'); }}
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground mb-6">
                Showing <span className="font-medium text-foreground">{filtered.length}</span>{' '}
                {filtered.length === 1 ? 'program' : 'programs'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {filtered.map(program => {
                    const placesLeft = Math.max(0, program.capacity - program.enrolledCount);
                    return (
                      <motion.div
                        layout
                        key={program.id}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.2 }}
                        className="group flex flex-col bg-card rounded-2xl overflow-hidden border border-border shadow-sm hover:shadow-lg transition-all"
                      >
                        {/* Thumbnail */}
                        <div className="relative aspect-video overflow-hidden bg-[#07111E]">
                          {program.thumbnailUrl ? (
                            <img
                              src={program.thumbnailUrl}
                              alt={program.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-end p-5">
                              <span className="font-display font-bold text-xl leading-snug text-[#F4F0E8]">
                                {program.title}
                              </span>
                            </div>
                          )}
                          <span className="absolute top-3 left-3 bg-background/90 backdrop-blur-sm text-foreground text-xs font-semibold px-2.5 py-1 rounded-full border border-border/50">
                            {program.format}
                          </span>
                          {/* A closed cohort stays listed, so it has to say so
                              here — before somebody reads the whole page and
                              only then finds there is no way in. */}
                          {!acceptsEnrolment(program.status) && (
                            <span className="absolute top-3 right-3 bg-[#07111E]/90 backdrop-blur-sm text-[#F4F0E8] text-xs font-semibold px-2.5 py-1 rounded-full">
                              Sign-ups closed
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col flex-1 p-5">
                          <p className="text-xs uppercase tracking-widest mb-3 font-medium text-[#C2410C]">
                            {program.tag}
                          </p>
                          <h3 className="font-display font-semibold text-base leading-snug mb-3 group-hover:text-primary transition-colors line-clamp-2">
                            {program.title}
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-4 flex-1">
                            {program.description}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5" />
                              {program.startDate}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {program.duration}
                            </span>
                          </div>
                        </div>

                        <div className="px-5 py-4 border-t border-border flex items-center justify-between bg-muted/20">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Users className="w-3.5 h-3.5" />
                            {!acceptsEnrolment(program.status)
                              ? 'Cohort closed'
                              : placesLeft > 0 ? `${placesLeft} places left` : 'Waitlist open'}
                          </span>
                          <Link href={`/programs/${program.id}`}>
                            <button className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-foreground hover:text-primary transition-colors group-hover:text-primary">
                              View Program
                              <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </button>
                          </Link>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
