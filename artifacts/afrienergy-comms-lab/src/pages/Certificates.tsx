import { Link } from 'wouter';
import { useListMyCertificates, useListPendingCertificates } from '@workspace/api-client-react';
import { Award, ArrowRight, Clock, FileText } from 'lucide-react';
import { Link as WLink } from 'wouter';
import { CouldNotLoad } from '@/components/CouldNotLoad';
import NameOnYourCertificate from '@/components/NameOnYourCertificate';

function formatDate(iso: string | null) {
  if (!iso) return 'Date to be confirmed';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Lists every certificate the learner has earned, one per fully completed program. */
export default function Certificates() {
  const { data: certificates = [], isLoading, isError, refetch } = useListMyCertificates();
  /*
    Programmes where the work is done and something else is holding it up.

    Without this the page tells somebody who has finished every module to go
    and finish the modules, because the list above filters them out and leaves
    nothing here to tell them apart from somebody who enrolled this morning.
  */
  const { data: pending = [] } = useListPendingCertificates();

  // Telling somebody who finished a programme that they have no certificate is
  // the worst version of this bug, so it is the first thing checked.
  if (isError) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <CouldNotLoad what="your certificates" onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2">My certificates</h1>
        <p className="text-muted-foreground max-w-2xl">
          You earn a certificate when you complete every module of a program: attend live, pass the quizzes, and submit the assignments.
        </p>
      </div>

      {/*
        Above the lists rather than inside the pending card, because the name
        is not per-programme and because somebody still working through their
        first module should be able to set it now rather than discover the
        question on the day they finish.
      */}
      <NameOnYourCertificate />

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
          {[0, 1].map(i => <div key={i} className="h-40 bg-card border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : certificates.length === 0 && pending.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center max-w-xl">
          <Award className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-bold mb-1">No certificates yet</h2>
          <p className="text-sm text-muted-foreground mb-4">Finish all the modules in a program and your certificate will appear here.</p>
          <Link href="/dashboard" className="text-sm font-semibold text-primary hover:underline">Continue learning</Link>
        </div>
      ) : certificates.length === 0 ? (
        <div className="max-w-3xl" />
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

      {/*
        Finished the work, held by something else. This block is the whole
        reason the pending route exists: a learner stuck behind a capstone or a
        survey is told which, and taken to it, rather than left to conclude the
        Lab lost their work.
      */}
      {pending.length > 0 && (
        <div className="mt-10 max-w-3xl">
          <h2 className="font-display font-bold mb-3">Nearly there</h2>
          <div className="space-y-3">
            {pending.map(p => (
              <div key={p.programId} className="bg-card border border-amber-500/40 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <h3 className="font-display font-bold">{p.programTitle}</h3>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.waitingOn}</p>
                    <div className="flex flex-wrap gap-4 mt-3">
                      {p.capstoneOutstanding && p.capstoneStatus !== 'submitted' && (
                        <WLink
                          href={`/programs/${p.programId}/capstone`}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <FileText className="w-4 h-4" aria-hidden />
                          {p.capstoneStatus === 'returned' ? 'Rework your capstone' : 'Write your capstone'}
                        </WLink>
                      )}
                      {p.nameOutstanding && (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                          <ArrowRight className="w-4 h-4" aria-hidden /> Add your name at the top of this page
                        </span>
                      )}
                      {p.surveyOutstanding && (
                        <WLink
                          href="/dashboard"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                          <ArrowRight className="w-4 h-4" aria-hidden /> Fill in the closing survey
                        </WLink>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
