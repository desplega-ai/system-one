import { cn } from "cn";

/**
 * Text whose changed characters flip in, like a split-flap clock. A character keeps its key while it stays
 * the same at the same place counted from the right, so "$9.99" to "$10.00" flips only what changed. Use a
 * monospace font, so the width does not jump.
 */
export function FlipText({ text, className }: { text: string; className?: string }) {
  const chars = [...text];
  return (
    <span className={cn("inline-flex [perspective:300px]", className)}>
      <span className="sr-only">{text}</span>
      {chars.map((char, i) => (
        <span key={`${chars.length - i}:${char}`} aria-hidden="true" className="flap">
          {char}
        </span>
      ))}
    </span>
  );
}
