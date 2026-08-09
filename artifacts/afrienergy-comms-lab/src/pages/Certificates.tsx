import { Link } from 'wouter';
import { useListMyCertificates } from '@workspace/api-client-react';
import { Award, ArrowRight } from 'lucide-react';

function formatDate(iso: string | null) {
  if (!iso) return 'Date to be confirmed';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Lists every certificate the learner has earned, one per fully completed program. */
export default function Certificates() {
  const { data: certificates = [], isLoading } = useListMyCertificates();

  return (
    <div className="container mx-auto px-4 md:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">My certificates</h1>
        <p className="text-muted-foreground max-w-2xl">
          You earn a certificate when you complete every module of a program: attend live, pass the quizzes, and submit the assignments.
        </p>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
          {[0, 1].map(i => <div key={i} className="h-40 bg-card border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : certificates.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center max-w-xl">
          <Award className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-bold mb-1">No certificates yet</h2>
          <p className="text-sm text-muted-foreground mb-4">Finish all the modules in a program and your certificate will appear here.</p>
          <Link href="/dashboard" className="text-sm font-semibold text-primary hover:underline">Continue learning</Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
          {certificates.map(c => (
            <Link
              key={c.programId}
              href={`/certificate/${c.programId}`}
              className="group bg-card border border-border rounded-2xl p-6 hover:border-primary/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-amber-100 text-[#C2410C] flex items-center justify-center mb-4">
                <Award className="w-5 h-5" />
              </div>
              <h2 className="font-display font-bold mb-1">{c.programTitle}</h2>
              <p className="text-xs text-muted-foreground mb-4">Completed {formatDate(c.completedAt as unknown as string | null)} · {c.certificateId}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                View certificate<ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
