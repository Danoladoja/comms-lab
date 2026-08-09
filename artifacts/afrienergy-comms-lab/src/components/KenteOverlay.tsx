import patternBg from '@/assets/pattern-bg.jpeg';

/**
 * KenteOverlay
 * A subtle tiled background texture (African symbol pattern image).
 * Apply as an absolute overlay on `position: relative; overflow: hidden` containers.
 * The `color` prop is kept for API compatibility but is no longer used.
 */
export function KenteOverlay({
  opacity = 0.07,
  color: _color,
}: {
  opacity?: number;
  color?: string;
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        opacity,
        backgroundImage: `url(${patternBg})`,
        backgroundSize: '420px auto',
        backgroundRepeat: 'repeat',
        mixBlendMode: 'screen',
      }}
    />
  );
}
