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
  { key: "gateway:jev-1.14.0", label: "Jev 1.14 (AI Gateway)", inputs: vision, env: gatewayEnv, model: gateway("typesafe-ai/jev-1.14.0") },
  {
    key: "gateway:gpt-6-luna",
    label: "GPT-6 Luna (AI Gateway)",
    inputs: vision,
    env: gatewayEnv,
    model: gateway("openai/gpt-6-luna-decisions"),
  },
];

/** The registry entries whose credentials are set. */
export function availableModels(env: Record<string, string | undefined> = process.env): ModelEntry[] {
  return registry.filter((entry) => entry.env.every((name) => env[name]));
}
