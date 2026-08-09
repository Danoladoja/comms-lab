import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListProgramThreads, useCreateProgramThread, useGetThread, useCreateThreadPost, useSetThreadPinned,
  getListProgramThreadsQueryKey, getGetThreadQueryKey,
  type ForumThread,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, Pin, PinOff, Plus, Send } from 'lucide-react';

function timeAgo(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function AuthorBadge({ role }: { role: string }) {
  if (role === 'Learner') return null;
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider bg-[#F97316]/10 text-[#C2410C] px-1.5 py-0.5 rounded ml-1.5">
      {role}
    </span>
  );
}

/** The cohort forum for one program: thread list, new-thread form, thread view. */
export function ProgramForum({ programId, programTitle }: { programId: number; programTitle: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useListProgramThreads(programId, {
    query: { queryKey: getListProgramThreadsQueryKey(programId) },
  });
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [openThread, setOpenThread] = useState<ForumThread | null>(null);

  const createThread = useCreateProgramThread({
    mutation: {
      onSuccess: (thread) => {
        qc.invalidateQueries({ queryKey: getListProgramThreadsQueryKey(programId) });
        setComposing(false); setTitle(''); setBody('');
        setOpenThread(thread);
      },
      onError: () => toast({ title: 'Could not start the discussion', variant: 'destructive' }),
    },
  });

  if (isLoading) return <div className="h-32 bg-card border border-border rounded-2xl animate-pulse" />;
  if (error) {
    return (
      <p className="text-sm text-muted-foreground bg-card border border-border rounded-xl p-6">
        Discussions open once your enrollment is confirmed.
      </p>
    );
  }

  const threads = data?.threads ?? [];

  return (
    <section className="bg-card border border-border rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-bold text-lg">{programTitle}</h2>
        <Button size="sm" variant={composing ? 'outline' : 'default'} onClick={() => setComposing(v => !v)}>
          <Plus className="w-4 h-4 mr-1.5" />{composing ? 'Cancel' : 'New discussion'}
        </Button>
      </div>

      {composing && (
        <div className="border border-border rounded-xl p-4 mb-4 space-y-3 bg-[#F4F0E8]/50">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What would you like to discuss?"
            maxLength={200}
          />
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Add more detail (optional)..."
            rows={3}
            maxLength={5000}
          />
          <Button
            size="sm"
            className="font-bold"
            disabled={!title.trim() || createThread.isPending}
            onClick={() => createThread.mutate({ id: programId, data: { title: title.trim(), body: body.trim() } })}
          >
            {createThread.isPending ? 'Posting...' : 'Start discussion'}
          </Button>
        </div>
      )}

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No discussions yet. Be the first to start one for your cohort.
        </p>
      ) : (
        <div className="space-y-3">
          {threads.map(t => (
            <button
              key={t.id}
              onClick={() => setOpenThread(t)}
              className="w-full text-left bg-background border border-border rounded-xl p-5 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">
                    {t.pinned && <span className="text-[#C2410C] text-xs font-bold uppercase tracking-wider mr-2">Pinned</span>}
                    {t.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Started by {t.authorName}{t.authorRole !== 'Learner' ? ` (${t.authorRole})` : ''} · last activity {timeAgo(t.lastActivityAt)}
                  </p>
                </div>
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1 flex-shrink-0">
                  <MessageSquare className="w-3.5 h-3.5" />{t.replyCount}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {openThread && (
        <ThreadDialog
          threadId={openThread.id}
          programId={programId}
          canModerate={data?.canModerate ?? false}
          open={!!openThread}
          onOpenChange={(v) => { if (!v) setOpenThread(null); }}
        />
      )}
    </section>
  );
}

function ThreadDialog({ threadId, programId, canModerate, open, onOpenChange }: {
  threadId: number; programId: number; canModerate: boolean; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetThread(threadId, {
    query: { queryKey: getGetThreadQueryKey(threadId), enabled: open },
  });
  const [reply, setReply] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetThreadQueryKey(threadId) });
    qc.invalidateQueries({ queryKey: getListProgramThreadsQueryKey(programId) });
  };

  const post = useCreateThreadPost({
    mutation: {
      onSuccess: () => { setReply(''); invalidate(); },
      onError: () => toast({ title: 'Could not post the reply', variant: 'destructive' }),
    },
  });
  const pin = useSetThreadPinned({
    mutation: {
      onSuccess: invalidate,
      onError: () => toast({ title: 'Could not update the pin', variant: 'destructive' }),
    },
  });

  const thread = data?.thread;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display pr-6">
            {thread?.pinned && <span className="text-[#C2410C] text-xs font-bold uppercase tracking-wider mr-2 align-middle">Pinned</span>}
            {thread?.title ?? 'Discussion'}
          </DialogTitle>
          <DialogDescription>
            {thread && <>Started by {thread.authorName}{thread.authorRole !== 'Learner' ? ` (${thread.authorRole})` : ''} · {timeAgo(thread.createdAt)}</>}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-4">
            {canModerate && thread && (
              <Button
                size="sm"
                variant="outline"
                disabled={pin.isPending}
                onClick={() => pin.mutate({ id: threadId, data: { pinned: !thread.pinned } })}
              >
                {thread.pinned
                  ? <><PinOff className="w-3.5 h-3.5 mr-1.5" />Unpin</>
                  : <><Pin className="w-3.5 h-3.5 mr-1.5" />Pin for the cohort</>}
              </Button>
            )}

            {thread?.body && (
              <p className="text-sm whitespace-pre-wrap bg-[#F4F0E8] border border-border rounded-lg px-3 py-2.5">{thread.body}</p>
            )}

            <div className="space-y-3">
              {(data?.posts ?? []).map(p => (
                <div key={p.id} className={`rounded-lg border px-3 py-2.5 ${p.mine ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                  <p className="text-xs mb-1">
                    <span className="font-semibold">{p.mine ? 'You' : p.authorName}</span>
                    <AuthorBadge role={p.authorRole} />
                    <span className="text-muted-foreground ml-2">{timeAgo(p.createdAt)}</span>
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{p.body}</p>
                </div>
              ))}
              {(data?.posts ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">No replies yet. Start the conversation.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder="Write a reply..."
                rows={2}
                maxLength={5000}
                className="flex-1"
              />
              <Button
                className="self-end"
                size="sm"
                disabled={!reply.trim() || post.isPending}
                onClick={() => post.mutate({ id: threadId, data: { body: reply.trim() } })}
                aria-label="Send reply"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
