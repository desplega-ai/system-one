import type { Usage } from "./types.ts";

/** Token counts and cost as the provider reports them. Any field can be missing. */
export type ReportedUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number };

// USD per 1M input tokens, checked 2026-10-16. Decision models do not bill output tokens.
// Used only when a response has no cost: always for OpenAI, Cloudflare and TypeSafe, and as a
// fallback for OpenRouter and AI Gateway. Free tiers (Cloudflare) and regional or long-context
// premiums (OpenAI) are not included.
const inputPricePerMillion: { readonly [provider: string]: { readonly [modelId: string]: number } } = {
  openrouter: { "~typesafe/jev-latest": 0.042, "cloudflare/clef-flash": 0.038, "openai/gpt-6-luna-decisions": 0.1 },
  gateway: { "typesafe-ai/jev-1.14.0": 0.042, "openai/gpt-6-luna-decisions": 0.1 },
  openai: { "gpt-6-luna": 0.1 },
  cloudflare: { "@cf/cloudflare/clef": 0.24, "@cf/cloudflare/clef-flash": 0.038, "@cf/cloudflare/clef-omni": 0.15 },
  typesafe: { "jev-latest": 0.042, "jev-1.13.0": 0.042 },
};

/** Fills in the cost from the list price when the provider reports none. Missing token counts become 0. */
export function withCost(reported: ReportedUsage, provider: string, modelId: string): Usage {
  const inputTokens = reported.inputTokens ?? 0;
  const outputTokens = reported.outputTokens ?? 0;
  const tokens = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  if (reported.costUsd !== undefined) return { ...tokens, costUsd: reported.costUsd, costSource: "provider" };
  const price = inputPricePerMillion[provider]?.[modelId];
  if (price !== undefined) return { ...tokens, costUsd: (inputTokens * price) / 1_000_000, costSource: "list-price" };
  return { ...tokens, costUsd: undefined, costSource: undefined };
}
