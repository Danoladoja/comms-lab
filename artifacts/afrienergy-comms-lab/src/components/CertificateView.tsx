import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Certificate, PublicCertificate } from '@workspace/api-client-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * One line of text, shrunk until it fits the width it was given.
 *
 * Two things on this sheet are written by somebody else and cannot be sized in
 * advance: the learner's name, and the signatories'. Names here run from three
 * characters to well over thirty, and the signing face is fetched from Google
 * — so on any network that blocks or delays it, the browser substitutes a
 * fallback that is nearly twice as wide. The first version of this measured
 * nothing and simply stepped the size down by character count, and the two
 * signatures ran straight through each other the moment the fallback rendered.
 *
 * So the width is measured rather than guessed, and measured again once the
 * fonts have actually arrived and whenever the sheet is resized. Nothing is
 * ever clipped and nothing ever collides, whichever font wins.
 */
function FitLine({ width, style, children }: { width: string; style: CSSProperties; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const b = box.current;
    const l = line.current;
    if (!b || !l) return;
    const avail = b.clientWidth;
    const needed = l.scrollWidth;
    if (!avail || !needed) return;
    setScale(needed > avail ? avail / needed : 1);
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    // Fonts land after the first paint, and the fallback is a different width.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) void fonts.ready.then(measure).catch(() => {});

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <span ref={box} style={{ ...style, width, display: 'block', whiteSpace: 'nowrap' }}>
      <span
        ref={line}
        style={{ display: 'inline-block', transform: `scale(${scale})`, transformOrigin: 'left center' }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * The month the programme was finished, in the certificate's own voice.
 *
 * A day number is noise on a document somebody hangs on a wall, and it dates
 * the sheet far more precisely than anybody needs. Month and year is what a
 * qualification is usually dated by.
 */
export function formatCertDate(iso: string | null) {
  if (!iso) return 'DATE TO BE CONFIRMED';
  return new Date(iso)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    .toUpperCase();
}

/**
 * The parts of a certificate this component renders. Both the learner's own
 * certificate and the public verification payload satisfy it, so the two pages
 * cannot drift apart.
 */
export type CertificateLike = Pick<
  Certificate & PublicCertificate,
  'programTitle' | 'learnerName' | 'completedAt' | 'certificateId' | 'modulesCompleted' | 'reviewsWritten'
> & { capstoneApproved?: boolean };

/**
 * The sheet is drawn at 1200 × 848 and scales to whatever it is put in.
 *
 * Every measurement below is the number from the approved design, divided by
 * twelve: the sheet is a container, so 100cqw is its width, which makes one
 * design pixel one twelfth of a cqw at any size. Keeping the design's own
 * numbers in the source means the next change to the artwork can be copied
 * across as written, rather than translated and mistranslated.
 */
const u = (px: number) => `${(px / 12).toFixed(4)}cqw`;

/**
 * The two finishes, as colour and nothing else.
 *
 * Every measurement, every word and every mark on the sheet is shared; only
 * these six values change. Kept as a pair of tables rather than two components
 * so that a change to the layout can never land on one finish and miss the
 * other — which is how a Lab ends up quietly issuing two different documents.
 *
 * `logo` matters more than it looks: the white wordmark disappears on cream
 * and the full-colour one disappears on clay, so the sheet carries the right
 * one rather than the same one twice.
 */
const FINISHES = {
  clay: {
    ink: '#FBEFE6',
    muted: '#F6D8C6',
    ground: '#A8421F',
    letter: '#B95733',
    name: '#FBEFE6',
    rule: '#FBEFE6',
    logo: 'logo-white.png',
  },
  cream: {
    ink: '#1E3A2B',
    muted: '#5A6B5F',
    ground: '#F4F0E8',
    letter: '#E3DCCD',
    name: '#9C4521',
    rule: '#C9C0AE',
    logo: 'logo.png',
  },
} as const;

export type CertificateFinishName = keyof typeof FINISHES;

/**
 * ANANSE COMMS LAB down the margin, scattered and cropped by the edge of the
 * sheet. The last two sit below the bottom edge on purpose: the word runs off
 * the page rather than stopping politely inside it.
 */
const MARGIN_LETTERS: { ch: string; left: number; top: number; size: number; rot: number }[] = [
  { ch: 'A', left: -16, top: -56, size: 128, rot: -9 },
  { ch: 'N', left: 107, top: 16, size: 104, rot: 7 },
  { ch: 'A', left: -7, top: 108, size: 118, rot: 4 },
  { ch: 'N', left: 113, top: 202, size: 96, rot: -12 },
  { ch: 'S', left: 0, top: 276, size: 126, rot: 10 },
  { ch: 'E', left: 121, top: 378, size: 100, rot: -5 },
  { ch: 'C', left: -12, top: 459, size: 112, rot: -8 },
  { ch: 'O', left: 111, top: 543, size: 96, rot: 13 },
  { ch: 'M', left: 2, top: 617, size: 120, rot: 5 },
  { ch: 'M', left: 128, top: 715, size: 98, rot: -10 },
  { ch: 'S', left: -9, top: 776, size: 110, rot: 8 },
  { ch: 'L', left: 113, top: 868, size: 102, rot: -6 },
  { ch: 'A', left: 8, top: 917, size: 116, rot: 11 },
];

/**
 * Who signs it.
 *
 * The two blocks are set well apart and given their own width, because the
 * names are very different lengths and a signature is written to fit its
 * space rather than scaled to match its neighbour. The slight tilt is
 * deliberate: a signature sitting perfectly level reads as type.
 */
const SIGNATORIES: { name: string; title: string; left: number; width: number; size: number; rot: number }[] = [
  { name: 'Abiodun Salako', title: 'CO-FOUNDER', left: 650, width: 225, size: 40, rot: -2 },
  { name: 'Rosemary Akpo-Ga Emmanuel', title: 'LEARNING MANAGER', left: 905, width: 255, size: 32, rot: 1.5 },
];

/**
 * What this learner actually did, rather than the word "completed".
 *
 * Assembled from what is true of them: a cohort that wrote no critiques does
 * not get a clause claiming any, and a programme with no capstone does not get
 * one claiming a capstone. Built rather than written out, because every
 * combination of the clauses has to read as English.
 */
function whatTheyDid(cert: CertificateLike): string {
  const parts: string[] = [
    `${cert.modulesCompleted} module${cert.modulesCompleted === 1 ? '' : 's'}`,
  ];
  if (cert.reviewsWritten > 0) {
    parts.push(`${cert.reviewsWritten} peer critique${cert.reviewsWritten === 1 ? '' : 's'} written`);
  }
  if (cert.capstoneApproved) parts.push('a capstone read and approved by the Lab');

  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** Read-only render of a certificate, shared by the learner and public pages. */
export default function CertificateView(
  { cert, finish = 'clay' }: { cert: CertificateLike; finish?: CertificateFinishName },
) {
  // Unknown values fall back rather than rendering a sheet with no colours at
  // all: this is read from a database column a learner may never have set.
  const { ink: INK, muted: MUTED, ground: GROUND, letter: LETTER, name: NAME, rule: RULE, logo: LOGO } =
    FINISHES[finish] ?? FINISHES.clay;

  return (
    <div
      className="w-full max-w-[1200px] mx-auto shadow-2xl print:shadow-none"
      style={{
        containerType: 'inline-size',
        aspectRatio: '1200 / 848',
        background: GROUND,
        color: INK,
        fontFamily: "Archivo, 'Helvetica Neue', Arial, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}
      data-print-root
    >
      {MARGIN_LETTERS.map((l, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            position: 'absolute',
            left: u(l.left),
            top: u(l.top),
            fontSize: u(l.size),
            fontWeight: 800,
            lineHeight: 0.8,
            color: LETTER,
            transform: `rotate(${l.rot}deg)`,
            userSelect: 'none',
          }}
        >
          {l.ch}
        </span>
      ))}

      <img
        src={`${basePath}/${LOGO}`}
        alt="Ananse Comms Lab"
        /*
          The mark is 456 × 160, so at this height it is 379 wide. It was set
          to 327, which squeezed the wordmark by a sixth — visible on the
          letterforms once the sheet is printed at any size.
        */
        style={{ position: 'absolute', right: u(62), top: u(57), height: u(133), width: u(379), display: 'block' }}
      />

      <h1 style={{
        position: 'absolute', left: u(211), top: u(227), margin: 0,
        fontSize: u(80), fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 0.98, color: INK,
      }}>
        CERTIFICATE
      </h1>

      <p style={{
        position: 'absolute', left: u(211), top: u(321), width: u(535), margin: 0,
        fontSize: u(20), letterSpacing: '0.12em', color: MUTED,
      }}>
        OF SUCCESSFUL PROGRAM COMPLETION
      </p>

      <div style={{ position: 'absolute', left: u(211), top: u(360), width: u(535), height: u(2), background: RULE }} />

      <p style={{
        position: 'absolute', left: u(211), top: u(416), width: u(820), margin: 0,
        fontSize: u(15), letterSpacing: '0.1em', color: MUTED,
      }}>
        THIS CERTIFICATE IS PRESENTED TO
      </p>

      <FitLine
        width={u(600)}
        style={{
          position: 'absolute', left: u(211), top: u(445),
          fontSize: u(48), fontWeight: 700, letterSpacing: '-0.01em', color: NAME,
        }}
      >
        {cert.learnerName}
      </FitLine>

      <p style={{
        position: 'absolute', left: u(211), top: u(517), width: u(820), margin: 0,
        fontSize: u(16), letterSpacing: '0.09em', color: MUTED,
      }}>
        {formatCertDate(cert.completedAt as unknown as string | null)}
      </p>

      <div style={{ position: 'absolute', left: u(211), top: u(580), width: u(380), height: u(1), background: RULE }} />

      <p style={{
        position: 'absolute', left: u(211), top: u(614), width: u(390), margin: 0,
        fontSize: u(15), lineHeight: 1.55, color: MUTED,
      }}>
        For completing{' '}
        <span style={{ color: INK, fontWeight: 600 }}>{cert.programTitle}</span>
        {' — '}{whatTheyDid(cert)}.
      </p>

      {SIGNATORIES.map((s) => (
        <div key={s.name}>
          <span style={{
            position: 'absolute', left: u(s.left), top: u(597),
            transform: `rotate(${s.rot}deg)`, transformOrigin: 'left bottom',
          }}>
            <FitLine
              width={u(s.width)}
              style={{
                fontFamily: "'Mrs Saint Delafield', 'Snell Roundhand', cursive",
                fontSize: u(s.size), lineHeight: 1, color: INK,
              }}
            >
              {s.name}
            </FitLine>
          </span>
          <FitLine
            width={u(s.width)}
            style={{
              position: 'absolute', left: u(s.left + 6), top: u(644),
              fontSize: u(15), fontWeight: 700, color: INK,
            }}
          >
            {s.name}
          </FitLine>
          <p style={{
            position: 'absolute', left: u(s.left + 6), top: u(665), width: u(s.width), margin: 0,
            fontSize: u(13), letterSpacing: '0.05em', color: MUTED,
          }}>
            {s.title}
          </p>
        </div>
      ))}

      {/*
        The code, and where to check it. Without this the sheet cannot be
        verified by anybody it is shown to, which is the one thing a
        certificate from a young school has to be able to do.
      */}
      <p style={{
        position: 'absolute', left: u(211), top: u(762), margin: 0,
        fontSize: u(12), letterSpacing: '0.06em', color: MUTED,
      }}>
        {cert.certificateId} &nbsp;·&nbsp; verify at energycommslab.africa/verify
      </p>
    </div>
  );
}
