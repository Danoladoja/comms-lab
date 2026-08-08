/**
 * KenteOverlay
 * A tileable SVG kente-inspired geometric pattern:
 * horizontal band borders, vertical strip dividers, and
 * alternating motifs (diamonds, crosses, chevrons, dots).
 * Apply as an absolute overlay on `position: relative; overflow: hidden` containers.
 */
export function KenteOverlay({
  opacity = 0.07,
  color = '#F97316',
}: {
  opacity?: number;
  color?: string;
}) {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="kente" x="0" y="0" width="48" height="24" patternUnits="userSpaceOnUse">
          {/* band borders */}
          <line x1="0"  y1="0"  x2="48" y2="0"  stroke={color} strokeWidth="1.5" />
          <line x1="0"  y1="24" x2="48" y2="24" stroke={color} strokeWidth="1.5" />
          <line x1="0"  y1="12" x2="48" y2="12" stroke={color} strokeWidth="0.6" />
          {/* vertical strip dividers — 3 cells × 16 px */}
          <line x1="0"  y1="0" x2="0"  y2="24" stroke={color} strokeWidth="1"   />
          <line x1="16" y1="0" x2="16" y2="24" stroke={color} strokeWidth="0.8" />
          <line x1="32" y1="0" x2="32" y2="24" stroke={color} strokeWidth="0.8" />
          <line x1="48" y1="0" x2="48" y2="24" stroke={color} strokeWidth="1"   />
          {/* cell 1 top: diamond */}
          <polygon points="8,2 14,6 8,10 2,6" fill="none" stroke={color} strokeWidth="0.8" />
          {/* cell 2 top: cross + inner square */}
          <line x1="24" y1="2.5" x2="24" y2="9.5" stroke={color} strokeWidth="0.8" />
          <line x1="20" y1="6"   x2="28" y2="6"   stroke={color} strokeWidth="0.8" />
          <rect x="21.5" y="3.5" width="5" height="5" fill="none" stroke={color} strokeWidth="0.5" />
          {/* cell 3 top: diamond */}
          <polygon points="40,2 46,6 40,10 34,6" fill="none" stroke={color} strokeWidth="0.8" />
          {/* cell 1 bottom: chevrons */}
          <polyline points="2,14.5  8,18 14,14.5" fill="none" stroke={color} strokeWidth="0.8" />
          <polyline points="2,19.5  8,23 14,19.5" fill="none" stroke={color} strokeWidth="0.8" />
          {/* cell 2 bottom: dot cluster */}
          <circle cx="20" cy="15.5" r="1"   fill={color} />
          <circle cx="24" cy="18"   r="1.3" fill={color} />
          <circle cx="28" cy="15.5" r="1"   fill={color} />
          <circle cx="20" cy="22"   r="1"   fill={color} />
          <circle cx="28" cy="22"   r="1"   fill={color} />
          {/* cell 3 bottom: inverted chevrons */}
          <polyline points="34,18 40,14.5 46,18" fill="none" stroke={color} strokeWidth="0.8" />
          <polyline points="34,23 40,19.5 46,23" fill="none" stroke={color} strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kente)" />
    </svg>
  );
}
