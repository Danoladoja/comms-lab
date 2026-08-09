import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Mic, MicOff, Video as VideoIcon, Hand, MessageSquare, Users,
  PhoneOff, ScreenShare, ArrowLeft,
} from 'lucide-react';

import slideImg from '@/assets/live/slide.jpg';
import facilitatorImg from '@/assets/live/facilitator.jpg';
import p1 from '@/assets/live/p1.jpg';
import p2 from '@/assets/live/p2.jpg';
import p3 from '@/assets/live/p3.jpg';
import p4 from '@/assets/live/p4.jpg';

const participants = [
  { name: 'Amara O.', img: p1, muted: true },
  { name: 'Zanele M.', img: p2, muted: true },
  { name: 'Kwame A.', img: p3, muted: false },
  { name: 'Fatima D.', img: p4, muted: true, hand: true },
];

const chat = [
  { name: 'Zanele M.', time: '14:03', text: 'The framing on slide 4 is so useful for ministry briefings.' },
  { name: 'Kwame A.', time: '14:04', text: 'Could you share the narrative canvas template afterwards?' },
  { name: 'Ngozi E. (Facilitator)', time: '14:04', text: 'Yes! It will be in the recap email with the recording.', facilitator: true },
  { name: 'Fatima D.', time: '14:05', text: 'Raising my hand, I have an example from Senegal.' },
];

export default function LiveClassroomPreview() {
  return (
    <div className="min-h-[100dvh] bg-[#07111E] text-[#F4F0E8] flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 px-4 md:px-6 py-3 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-[#F4F0E8]/60 hover:text-[#F4F0E8] flex-shrink-0" aria-label="Back to home">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <p className="font-display font-bold truncate">Energy Narrative Lab · Session 2</p>
            <p className="text-xs text-[#F4F0E8]/60 truncate">Building a Story Spine for Policy Audiences</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="flex items-center gap-1.5 bg-[#C2410C] text-white text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Live
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-[#F4F0E8]/70">
            <Users className="w-4 h-4" /> 18 in session
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 md:p-6 max-w-[1400px] w-full mx-auto">
        {/* Stage */}
        <main className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black">
            <img src={slideImg} alt="Shared slides" className="w-full aspect-video object-cover" />
            <span className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur text-xs font-medium px-2.5 py-1 rounded-full">
              <ScreenShare className="w-3.5 h-3.5 text-[#F97316]" /> Ngozi is presenting
            </span>
            {/* Facilitator picture-in-picture */}
            <div className="absolute bottom-3 right-3 w-32 sm:w-44 rounded-xl overflow-hidden border-2 border-[#F97316] shadow-xl">
              <img src={facilitatorImg} alt="Facilitator webcam" className="w-full aspect-video object-cover" />
              <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold bg-black/60 px-1.5 py-0.5 rounded">
                Ngozi E. · Facilitator
              </span>
            </div>
          </div>

          {/* Participant strip */}
          <div className="grid grid-cols-4 gap-3">
            {participants.map((p) => (
              <div key={p.name} className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={p.img} alt={p.name} className="w-full aspect-video object-cover" />
                <span className="absolute bottom-1 left-1.5 text-[10px] font-medium bg-black/60 px-1.5 py-0.5 rounded max-w-[85%] truncate">
                  {p.name}
                </span>
                <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
                  {p.hand && <Hand className="w-3.5 h-3.5 text-[#F97316]" />}
                  {p.muted
                    ? <MicOff className="w-3.5 h-3.5 text-[#F4F0E8]/70" />
                    : <Mic className="w-3.5 h-3.5 text-[#4ADE80]" />}
                </span>
              </div>
            ))}
          </div>

          {/* Controls (visual preview only) */}
          <div className="flex items-center justify-center gap-3 py-2">
            <button className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Microphone">
              <Mic className="w-5 h-5" />
            </button>
            <button className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Camera">
              <VideoIcon className="w-5 h-5" />
            </button>
            <button className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Raise hand">
              <Hand className="w-5 h-5" />
            </button>
            <button className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center lg:hidden" aria-label="Chat">
              <MessageSquare className="w-5 h-5" />
            </button>
            <button className="h-11 px-5 rounded-full bg-[#C2410C] hover:bg-[#A83A0B] flex items-center gap-2 font-semibold text-sm" aria-label="Leave session">
              <PhoneOff className="w-5 h-5" /> Leave
            </button>
          </div>
        </main>

        {/* Chat panel */}
        <aside className="w-full lg:w-80 flex-shrink-0 bg-white/5 border border-white/10 rounded-2xl flex flex-col">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#F97316]" />
            <h2 className="font-semibold text-sm">Session chat</h2>
          </div>
          <div className="flex-1 p-4 space-y-4 overflow-y-auto min-h-[220px]">
            {chat.map((m, i) => (
              <div key={i}>
                <p className="text-xs mb-0.5">
                  <span className={`font-semibold ${m.facilitator ? 'text-[#F97316]' : ''}`}>{m.name}</span>
                  <span className="text-[#F4F0E8]/40 ml-2">{m.time}</span>
                </p>
                <p className="text-sm text-[#F4F0E8]/85">{m.text}</p>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-white/10">
            <div className="bg-white/10 rounded-lg px-3 py-2 text-sm text-[#F4F0E8]/50">
              Send a message to everyone...
            </div>
          </div>
        </aside>
      </div>

      {/* Preview notice */}
      <footer className="px-4 pb-5 text-center">
        <p className="text-xs text-[#F4F0E8]/50 mb-3">
          This is a preview with placeholder images. Real classes run on your video platform via the Join link on each session.
        </p>
        <Button asChild variant="outline" className="border-white/20 bg-transparent text-[#F4F0E8] hover:bg-white/10">
          <Link href="/courses">Browse Programs</Link>
        </Button>
      </footer>
    </div>
  );
}
