// Known decision model ids per provider, checked 2026-10-16. Other strings are accepted too.

/** From `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`. */
export type OpenRouterDecisionModel =
  // Text and images
  | "~typesafe/jev-latest"
  | "typesafe/jev-1.14"
  | "typesafe/jev-1.13"
  | "cloudflare/clef"
  | "cloudflare/clef-flash"
  | "cloudflare/clef-omni"
  | "openai/gpt-6-luna-decisions"
  | "~perplexity/pplx-decider-latest"
  | "perplexity/pplx-decider-v1.1-27b"
  | "liquid/d1"
  | "liquid/d1-ultra"
  | "inception/mercury-decide"
  | "inception/mercury-decide:free"
  | "respan/span-02"
  | "scaledown/classify-1"
  // Text only
  | "microsoft/microsoft-decision-1"
  | "nace-ai/drex-v2.0"
  | "nace-ai/drex-v1.5"
  | "upstage/solar-decide"
  | "upstage/solar-decide-flash"
  | "respan/span-01"
  | "respan/span-01-lite"
  | "respan/span-01-lite:free"
  | "togethercomputer/tev1-4b-experimental"
  | "jaredpalmer/kev-4b"
  | (string & {});

/** Only `gpt-6-luna` is in the Decisions API public beta. Text and images. */
export type OpenAIDecisionModel = "gpt-6-luna" | (string & {});

/** Workers AI. Clef Omni also reads audio and video, which this package does not send. */
export type CloudflareDecisionModel =
  | "@cf/cloudflare/clef"
  | "@cf/cloudflare/clef-flash"
  | "@cf/cloudflare/clef-omni"
  | (string & {});

/** From `GET https://ai-gateway.vercel.sh/v1/models`, type `evaluation`. */
export type GatewayDecisionModel =
  // Text and images
  | "typesafe-ai/jev-1.14.0"
  | "typesafe-ai/jev-1.13.0"
  | "liquid/d1"
  | "liquid/d1-ultra"
  | "perplexity/pplx-decider-v1.1-27b"
  | "openai/gpt-6-luna-decisions"
  // Text only
  | "typesafe-ai/jev"
  | "microsoft/microsoft-decision-1"
  | "scaledown/scaledown-classify-1"
  | "convaiinnovations/laya"
  | "convaiinnovations/laya-free"
  | (string & {});

export type TypeSafeDecisionModel = "jev-latest" | (string & {});
