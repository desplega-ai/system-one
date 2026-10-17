import { cn } from "cn";
import { Card } from "@/web/components/ui/card";
import { ModelName } from "./ModelName.tsx";

export type ResultRow = { key: string; label: string; color: string; place?: number; out?: boolean; stats: string[] };

/** How a game ended: a headline in the winner's color, why it ended, and one line per model. */
export function ResultCard({ title, detail, rows, color }: { title: string; detail: string; rows: ResultRow[]; color?: string }) {
  return (
    <Card className="gap-3 border-white/15 px-5 py-4 duration-500 animate-in fade-in slide-in-from-top-2">
      <div>
        <div className="caps text-muted-foreground">Result</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight" style={color ? { color, textShadow: `0 0 18px ${color}66` } : undefined}>
          {title}
        </div>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      <ol className="divide-y">
        {rows.map((row) => (
          <li key={row.key} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2", row.out && "opacity-60")}>
            {row.place !== undefined && <span className="w-4 font-mono text-sm text-muted-foreground">{row.place}</span>}
            <ModelName label={row.label} color={row.color} className="min-w-0 flex-1" />
            <span className="flex w-full flex-wrap gap-x-3 pl-7 font-mono text-xs text-muted-foreground tabular-nums sm:w-auto sm:shrink-0 sm:pl-0">
              {row.stats.map((stat) => (
                <span key={stat}>{stat}</span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
