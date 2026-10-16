// Daily spend caps, in total and per provider, from one JSON env.
import type { Spend } from "./store.ts";

export type Budget = {
  /** USD per UTC day, over all providers. */
  dailyUsd?: number;
  /** USD per UTC day for one provider, for example { "openai": 0.25 }. */
  providers: Record<string, number>;
};

/** The cap when SYSTEM_ONE_BUDGET is unset. */
export const defaultBudget: Budget = { dailyUsd: 1, providers: {} };

/** Reads SYSTEM_ONE_BUDGET, for example '{"dailyUsd":1,"providers":{"openai":0.25}}'. Throws on bad JSON. */
export function parseBudget(env: string | undefined): Budget {
  if (env === undefined || env.trim() === "") return defaultBudget;
  const raw: unknown = JSON.parse(env);
  const isUsd = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (typeof raw !== "object" || raw === null) throw new TypeError("SYSTEM_ONE_BUDGET: expected a JSON object");
  const { dailyUsd, providers = {} } = raw as { dailyUsd?: unknown; providers?: unknown };
  if (dailyUsd !== undefined && !isUsd(dailyUsd)) throw new TypeError("SYSTEM_ONE_BUDGET: dailyUsd must be a number >= 0");
  if (typeof providers !== "object" || providers === null || !Object.values(providers).every(isUsd)) {
    throw new TypeError("SYSTEM_ONE_BUDGET: providers must map provider names to numbers >= 0");
  }
  return { dailyUsd, providers: providers as Record<string, number> };
}

/** Returns why a call to this provider is over budget, or undefined when it may go ahead. */
export function overBudget(budget: Budget, spend: Spend, provider: string): string | undefined {
  if (budget.dailyUsd !== undefined && spend.total >= budget.dailyUsd) {
    return `daily budget of $${budget.dailyUsd} is spent ($${spend.total.toFixed(6)} today)`;
  }
  const cap = budget.providers[provider];
  const spent = spend.byProvider[provider] ?? 0;
  if (cap !== undefined && spent >= cap) return `daily ${provider} budget of $${cap} is spent ($${spent.toFixed(6)} today)`;
  return undefined;
}
