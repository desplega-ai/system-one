import type { Usage } from "@system-one/ai";
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

export function Hud({ stats, budget }: { stats: RunStats; budget?: BudgetInfo }) {
  return (
    <div className="hud">
      <span>{stats.calls} calls</span>
      {stats.errors > 0 && <span className="refused">{stats.errors} errors</span>}
      <span>
        {stats.inputTokens.toLocaleString()} in / {stats.outputTokens.toLocaleString()} out
      </span>
      <span>{usd(stats.costUsd)}</span>
      <span>{stats.calls > 0 ? Math.round(stats.latencyMs / stats.calls) : 0} ms mean</span>
      {budget && <BudgetLine budget={budget} />}
    </div>
  );
}

export function BudgetLine({ budget }: { budget: BudgetInfo }) {
  return (
    <span className="muted">
      today {usd(budget.spent.total)}
      {budget.dailyUsd !== undefined && ` of ${usd(budget.dailyUsd)}`}
    </span>
  );
}
