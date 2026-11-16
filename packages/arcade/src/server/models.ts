// The decision models that games can use. Each one has a known cost, so the budget can count it.
import { cloudflare, type DecisionModel, gateway, openai, openrouter, typesafe } from "@system-one/ai";

export type Input = "text" | "image" | "audio";

export type ModelEntry = {
  /** Stable id used by the API, the database and the rankings. */
  key: string;
  label: string;
  inputs: readonly Input[];
  /** Environment variables the provider needs. */
  env: readonly string[];
  model: DecisionModel;
};

const openrouterEnv = ["OPENROUTER_API_KEY"];
const cloudflareEnv = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const gatewayEnv = ["AI_GATEWAY_API_KEY"];
const vision = ["text", "image"] as const;

export const registry: readonly ModelEntry[] = [
  { key: "cloudflare:clef-flash", label: "Clef Flash (Cloudflare)", inputs: vision, env: cloudflareEnv, model: cloudflare("@cf/cloudflare/clef-flash") },
  { key: "cloudflare:clef", label: "Clef (Cloudflare)", inputs: vision, env: cloudflareEnv, model: cloudflare("@cf/cloudflare/clef") },
  {
    key: "cloudflare:clef-omni",
    label: "Clef-Omni (Cloudflare)",
    inputs: ["text", "image", "audio"],
    env: cloudflareEnv,
    model: cloudflare("@cf/cloudflare/clef-omni"),
  },
  { key: "openai:gpt-6-luna", label: "GPT-6 Luna (OpenAI)", inputs: vision, env: ["OPENAI_API_KEY"], model: openai("gpt-6-luna") },
  { key: "typesafe:jev-latest", label: "Jev (TypeSafe)", inputs: vision, env: ["TYPESAFE_API_KEY"], model: typesafe("jev-latest") },
  { key: "openrouter:jev-latest", label: "Jev (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("~typesafe/jev-latest") },
  { key: "openrouter:clef-flash", label: "Clef Flash (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("cloudflare/clef-flash") },
  {
    key: "openrouter:gpt-6-luna",
    label: "GPT-6 Luna (OpenRouter)",
    inputs: vision,
    env: openrouterEnv,
    model: openrouter("openai/gpt-6-luna-decisions"),
  },
  { key: "openrouter:decider-latest", label: "Decider (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("~perplexity/pplx-decider-latest") },
  { key: "openrouter:decider-flash-latest", label: "Decider Flash (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("~perplexity/pplx-decider-flash-latest") },
  { key: "openrouter:decider-v1.3-free", label: "Decider 1.3 Free (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("perplexity/pplx-decider-v1.3:free") },
  { key: "openrouter:decider-flash-v1.3-free", label: "Decider Flash 1.3 Free (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("perplexity/pplx-decider-flash-v1.3:free") },
  { key: "openrouter:liquid-d1.1", label: "Liquid d1.1 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("liquid/d1.1") },
  { key: "openrouter:liquid-d1-ultra", label: "Liquid d1 Ultra (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("liquid/d1-ultra") },
  { key: "openrouter:gemini-decision-1", label: "Gemini Decision 1 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("google/gemini-decision-1") },
  { key: "openrouter:reflex", label: "Reflex (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("morph/reflex") },
  { key: "openrouter:joey-1", label: "Joey 1 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("baseten/joey-1") },
  { key: "openrouter:elephant-1", label: "Elephant 1 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("baseten/elephant-1") },
  { key: "openrouter:mammoth-1", label: "Mammoth 1 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("baseten/mammoth-1") },
  { key: "openrouter:span-02", label: "Span-02 (OpenRouter)", inputs: vision, env: openrouterEnv, model: openrouter("respan/span-02") },
  { key: "gateway:jev-1.14.0", label: "Jev 1.14 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("typesafe-ai/jev-1.14.0") },
  {
    key: "gateway:gpt-6-luna",
    label: "GPT-6 Luna (AI Gateway)",
    inputs: vision,
    env: gatewayEnv,
    model: gateway("openai/gpt-6-luna-decisions"),
  },
  { key: "gateway:decider-v1.3", label: "Decider 1.3 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("perplexity/pplx-decider-v1.3") },
  { key: "gateway:decider-flash-v1.3", label: "Decider Flash 1.3 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("perplexity/pplx-decider-flash-v1.3") },
  { key: "gateway:gemini-decision-1", label: "Gemini Decision 1 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("google/gemini-decision-1") },
  { key: "gateway:drex-max-v1.1", label: "Drex Max 1.1 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("nace-ai/drex-max-v1.1") },
];

/** The registry entries whose credentials are set. */
export function availableModels(env: Record<string, string | undefined> = process.env): ModelEntry[] {
  return registry.filter((entry) => entry.env.every((name) => env[name]));
}
