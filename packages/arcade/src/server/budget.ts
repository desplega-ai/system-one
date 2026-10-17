// Daily spend caps, in total, per provider and per visitor, from one JSON env.
import type { Spend } from "./store.ts";

export type Budget = {
  /** USD per UTC day, over all providers. */
  dailyUsd?: number;
  /** USD per UTC day for one provider, for example { "openai": 0.25 }. */
  providers: Record<string, number>;
  /** USD per UTC day for one visitor (a cookie). Unset: no cap per visitor, as on your own machine. */
  visitorUsd?: number;
  /** USD per UTC day for one IP address, so clearing the cookie does not reset the share. */
  ipUsd?: number;
};

/** The cap when SYSTEM_ONE_BUDGET is unset. */
export const defaultBudget: Budget = { dailyUsd: 1, providers: {} };

/** Reads SYSTEM_ONE_BUDGET, for example '{"dailyUsd":5,"providers":{"openai":0.25},"visitorUsd":0.05,"ipUsd":0.15}'. Throws on bad JSON. */
export function parseBudget(env: string | undefined): Budget {
  if (env === undefined || env.trim() === "") return defaultBudget;
  const raw: unknown = JSON.parse(env);
  const isUsd = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (typeof raw !== "object" || raw === null) throw new TypeError("SYSTEM_ONE_BUDGET: expected a JSON object");
  const { dailyUsd, providers = {}, visitorUsd, ipUsd } = raw as { dailyUsd?: unknown; providers?: unknown; visitorUsd?: unknown; ipUsd?: unknown };
  for (const [name, value] of Object.entries({ dailyUsd, visitorUsd, ipUsd })) {
    if (value !== undefined && !isUsd(value)) throw new TypeError(`SYSTEM_ONE_BUDGET: ${name} must be a number >= 0`);
  }
  if (typeof providers !== "object" || providers === null || !Object.values(providers).every(isUsd)) {
    throw new TypeError("SYSTEM_ONE_BUDGET: providers must map provider names to numbers >= 0");
  }
  return {
    dailyUsd: dailyUsd as number | undefined,
    providers: providers as Record<string, number>,
    ...(visitorUsd !== undefined ? { visitorUsd: visitorUsd as number } : {}),
    ...(ipUsd !== undefined ? { ipUsd: ipUsd as number } : {}),
  };
}

/** Returns why this visitor is over its share, or undefined. `spent` is today's spend of the visitor and of its IP. */
export function overShare(budget: Budget, spent: { visitor: number; ip: number }): string | undefined {
  const cap = budget.visitorUsd;
  if (cap !== undefined && spent.visitor >= cap) return `You used today's free share of $${cap}. Come back tomorrow (UTC).`;
  if (budget.ipUsd !== undefined && spent.ip >= budget.ipUsd) return `This network used today's free share of $${budget.ipUsd}. Come back tomorrow (UTC).`;
  return undefined;
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
