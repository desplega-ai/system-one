import type { Usage } from "./types.ts";

/** Token counts and cost as the provider reports them. Any field can be missing. */
export type ReportedUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number };

// USD per 1M input tokens, checked 2026-10-16. Decision models do not bill output tokens.
// Used only when a response has no cost: always for OpenAI, Cloudflare and TypeSafe, and as a
// fallback for OpenRouter and AI Gateway (also when they report $0, see withCost). Free tiers
// (Cloudflare) and regional or long-context premiums (OpenAI) are not included.
// Prices for additions on OpenRouter and AI Gateway checked 2026-11-16 against their Models APIs.
const inputPricePerMillion: { readonly [provider: string]: { readonly [modelId: string]: number } } = {
  openrouter: {
    "~typesafe/jev-latest": 0.042,
    "cloudflare/clef-flash": 0.038,
    "openai/gpt-6-luna-decisions": 0.1,
    "~perplexity/pplx-decider-latest": 0.02,
    "~perplexity/pplx-decider-flash-latest": 0.01,
    "perplexity/pplx-decider-v1.3:free": 0,
    "perplexity/pplx-decider-flash-v1.3:free": 0,
    "liquid/d1.1": 0.02,
    "liquid/d1-ultra": 0.042,
    "google/gemini-decision-1": 0.1,
    "morph/reflex": 0.042,
    "baseten/joey-1": 0.01,
    "baseten/elephant-1": 0.035,
    "baseten/mammoth-1": 0.1,
    "respan/span-02": 0.01,
  },
  gateway: {
    "typesafe-ai/jev-1.14.0": 0.042,
    "openai/gpt-6-luna-decisions": 0.1,
    "perplexity/pplx-decider-v1.3": 0.02,
    "perplexity/pplx-decider-flash-v1.3": 0.01,
    "google/gemini-decision-1": 0.1,
    "nace-ai/drex-max-v1.1": 0.03,
  },
  openai: { "gpt-6-luna": 0.1 },
  cloudflare: { "@cf/cloudflare/clef": 0.24, "@cf/cloudflare/clef-flash": 0.038, "@cf/cloudflare/clef-omni": 0.15 },
  typesafe: { "jev-latest": 0.042, "jev-1.13.0": 0.042 },
};

/**
 * Fills in the cost from the list price when the provider reports none. Missing token counts become 0.
 * A reported $0 for a call with input tokens also takes the list price (OpenRouter reports $0 for GPT-6
 * Luna), so a budget does not count a paid call as free. A model without a list price keeps the $0.
 */
export function withCost(reported: ReportedUsage, provider: string, modelId: string): Usage {
  const inputTokens = reported.inputTokens ?? 0;
  const outputTokens = reported.outputTokens ?? 0;
  const tokens = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  const price = inputPricePerMillion[provider]?.[modelId];
  const zeroForTokens = reported.costUsd === 0 && inputTokens > 0 && price !== undefined;
  if (reported.costUsd !== undefined && !zeroForTokens) return { ...tokens, costUsd: reported.costUsd, costSource: "provider" };
  if (price !== undefined) return { ...tokens, costUsd: (inputTokens * price) / 1_000_000, costSource: "list-price" };
  return { ...tokens, costUsd: undefined, costSource: undefined };
}
