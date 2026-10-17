import type { Answer, Question } from "@system-one/ai";
import { cn } from "cn";

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Shows one answer: a meter for a boolean, one bar per option or level for a choice or a score.
 * The top bar fills with `color` (the player's color). `limit` keeps only the most likely options of a choice. */
export function ProbabilityBars({
  title,
  question,
  answer,
  color,
  limit,
  minRows = 1,
}: {
  title: string;
  question?: Question;
  answer: Answer | undefined;
  color?: string;
  limit?: number;
  /** Empty rows keep the height steady while the number of options changes. */
  minRows?: number;
}) {
  const shown =
    answer === undefined || answer.type === "refusal" || answer.type === "boolean"
      ? 1
      : answer.type === "choice"
        ? Math.min(limit ?? Infinity, Object.keys(answer.probabilities).length)
        : answer.probabilities.length;
  return (
    <div className="space-y-1">
      <div className="caps text-[10px] text-muted-foreground">{title}</div>
      {answer === undefined ? (
        <div className="h-4 text-xs text-muted-foreground">waiting</div>
      ) : answer.type === "refusal" ? (
        <div className="h-4 truncate text-xs text-destructive">refused{answer.reason ? `: ${answer.reason}` : ""}</div>
      ) : answer.type === "boolean" ? (
        <Bar label="yes" p={answer.probability} best={answer.probability >= 0.5} color={color} />
      ) : answer.type === "choice" ? (
        // With a limit, only the most likely options, most likely first.
        (limit ? Object.entries(answer.probabilities).sort(([, a], [, b]) => b - a).slice(0, limit) : Object.entries(answer.probabilities)).map(([option, p]) => (
          <Bar key={option} label={option} p={p} best={option === answer.choice} color={color} />
        ))
      ) : (
        answer.probabilities.map((p, i) => {
          const label = question?.type === "score" ? (question.levels[i] ?? String(i)) : String(i);
          return <Bar key={label} label={label} p={p} best={label === answer.level} color={color} />;
        })
      )}
      {Array.from({ length: Math.max(0, minRows - shown) }, (_, i) => (
        <div key={`pad-${i}`} aria-hidden className="h-4" />
      ))}
    </div>
  );
}

function Bar({ label, p, best, color }: { label: string; p: number; best: boolean; color?: string }) {
  return (
    <div className="grid h-4 grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2 text-xs">
      <span className={cn("truncate", best ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <span
          className="block h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: pct(p), background: best ? (color ?? "var(--foreground)") : "oklch(1 0 0 / 22%)" }}
        />
      </span>
      <span className="text-right font-mono tabular-nums text-muted-foreground">{pct(p)}</span>
    </div>
  );
}
