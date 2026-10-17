import type { Usage } from "@system-one/ai";
import { Activity, AlertTriangle, ArrowDownUp, Coins, Timer } from "lucide-react";
import type { ReactNode } from "react";
import type { BudgetInfo } from "../lib/api.ts";

/** Totals for one run. The browser sums them from the /api/decide responses. */
export type RunStats = { calls: number; errors: number; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number };

export const emptyStats: RunStats = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };

export function addCall(stats: RunStats, call: { usage: Usage; latencyMs: number } | "error"): RunStats {
  if (call === "error") return { ...stats, errors: stats.errors + 1 };
  return {
    ...stats,
    calls: stats.calls + 1,
    inputTokens: stats.inputTokens + call.usage.inputTokens,
    outputTokens: stats.outputTokens + call.usage.outputTokens,
    costUsd: stats.costUsd + (call.usage.costUsd ?? 0),
    latencyMs: stats.latencyMs + call.latencyMs,
  };
}

export const usd = (n: number) => `$${n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(4) : n.toFixed(6)}`;

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** The run totals in one mono line. `short` leaves out the tokens. The top bar shows the budget, so only the hidden Voice page passes it. */
export function Hud({ stats, budget, short }: { stats: RunStats; budget?: BudgetInfo; short?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">
      <Stat icon={<Activity />} value={`${stats.calls} calls`} />
      {!short && <Stat icon={<ArrowDownUp />} value={`${compact.format(stats.inputTokens)} in / ${compact.format(stats.outputTokens)} out`} />}
      <Stat icon={<Timer />} value={`${stats.calls > 0 ? Math.round(stats.latencyMs / stats.calls) : 0} ms mean`} />
      <Stat icon={<Coins />} value={usd(stats.costUsd)} />
      {stats.errors > 0 && <Stat icon={<AlertTriangle />} value={`${stats.errors} errors`} className="text-destructive" />}
      {budget && <BudgetLine budget={budget} />}
    </div>
  );
}

function Stat({ icon, value, className }: { icon: ReactNode; value: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:opacity-70 ${className ?? ""}`}>
      {icon}
      {value}
    </span>
  );
}

export function BudgetLine({ budget }: { budget: BudgetInfo }) {
  return (
    <span>
      today {usd(budget.spent.total)}
      {budget.dailyUsd !== undefined && ` of ${usd(budget.dailyUsd)}`}
    </span>
  );
}
