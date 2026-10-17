import type { ReactNode } from "react";

/** One row of a game's setup panel: a small caps label, then the controls. */
export function SetupRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-start gap-2 sm:grid-cols-[5.5rem_1fr] sm:gap-4">
      <span className="caps text-muted-foreground sm:pt-2.5">{label}</span>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}
