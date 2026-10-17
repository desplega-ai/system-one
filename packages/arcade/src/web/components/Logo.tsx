/** A 3x3 grid with the center cell lit: one decision picked from a set of options. Same drawing as favicon.svg. */
export function Logo({ className }: { className?: string }) {
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ x: 6 + col * 7.25, y: 6 + row * 7.25, lit: row === 1 && col === 1 })));
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#15171c" stroke="rgba(255,255,255,0.1)" />
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="5.5" height="5.5" rx="1.2" fill={c.lit ? "#ff5d52" : "rgba(255,255,255,0.18)"} />
      ))}
    </svg>
  );
}
