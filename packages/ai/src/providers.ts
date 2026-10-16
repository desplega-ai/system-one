import { DecisionError } from "./errors.ts";
import { ImagePart } from "./image.ts";
import type {
  CloudflareDecisionModel,
  GatewayDecisionModel,
  OpenAIDecisionModel,
  OpenRouterDecisionModel,
  TypeSafeDecisionModel,
} from "./models.ts";
import { type ReportedUsage, withCost } from "./pricing.ts";
import type { Answers, DecideCall, DecideResult, DecisionModel, Questions, State } from "./types.ts";
import { decodeOpenAI, encodeOpenAI, openAIUsage } from "./wire/openai.ts";
import { type Decoded, isParts, type Raw } from "./wire/shared.ts";
import { decodeSystemOne, encodeSystemOne, systemOneUsage } from "./wire/system-one.ts";

export type ProviderOptions = {
  /** Defaults to the provider's environment variable, read at call time. */
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

/** OpenRouter Decisions API: 25 decision models from many makers, most with image input. */
export function openrouter(modelId: OpenRouterDecisionModel, options: ProviderOptions = {}): DecisionModel {
  const provider = "openrouter";
  return httpModel({
    provider,
    modelId,
    url: () => `${options.baseURL ?? "https://openrouter.ai/api/alpha"}/decisions`,
    headers: () => ({ ...bearer(provider, options.apiKey, "OPENROUTER_API_KEY"), ...options.headers }),
    encode: (state, questions) => ({ model: modelId, ...encodeSystemOne(state, questions, "parts") }),
    decode: decodeSystemOne,
    usage: systemOneUsage,
  });
}

/** OpenAI Decisions API (public beta). */
export function openai(modelId: OpenAIDecisionModel, options: ProviderOptions = {}): DecisionModel {
  const provider = "openai";
  return httpModel({
    provider,
    modelId,
    url: () => `${options.baseURL ?? "https://api.openai.com/v1"}/decisions`,
    headers: () => ({ ...bearer(provider, options.apiKey, "OPENAI_API_KEY"), ...options.headers }),
    encode: (state, questions) => ({ model: modelId, ...encodeOpenAI(state, questions) }),
    decode: decodeOpenAI,
    usage: openAIUsage,
  });
}

/** Cloudflare Workers AI (Clef models). At most 4 images per request. */
export function cloudflare(
  modelId: CloudflareDecisionModel,
  options: ProviderOptions & { accountId?: string } = {},
): DecisionModel {
  const provider = "cloudflare";
  return httpModel({
    provider,
    modelId,
    url: () => {
      const base =
        options.baseURL ??
        `https://api.cloudflare.com/client/v4/accounts/${credential(provider, options.accountId, "CLOUDFLARE_ACCOUNT_ID")}/ai/run`;
      return `${base}/${modelId}`;
    },
    headers: () => ({ ...bearer(provider, options.apiKey, "CLOUDFLARE_API_TOKEN"), ...options.headers }),
    // The body repeats the model as "clef", "clef-flash" or "clef-omni".
    encode: (state, questions) => ({ model: modelId.split("/").pop(), ...encodeSystemOne(state, questions, "field") }),
    decode: (name, body, questions) => {
      if (!body?.result) throw new DecisionError("bad_response", name, "response has no result", { body });
      return decodeSystemOne(name, body.result, questions);
    },
    usage: (body) => systemOneUsage(body?.result),
  });
}

/** Vercel AI Gateway, through its OpenAI-compatible Decisions endpoint. */
export function gateway(modelId: GatewayDecisionModel, options: ProviderOptions = {}): DecisionModel {
  const provider = "gateway";
  return httpModel({
    provider,
    modelId,
    url: () => `${options.baseURL ?? "https://ai-gateway.vercel.sh/v1"}/decisions`,
    headers: () => ({ ...bearer(provider, options.apiKey, "AI_GATEWAY_API_KEY"), ...options.headers }),
    encode: (state, questions) => ({ model: modelId, ...encodeOpenAI(state, questions) }),
    decode: decodeOpenAI,
    usage: openAIUsage,
  });
}

/** TypeSafe System One API (Jev), direct. Accepts PNG and JPEG images, 280 to 1568 px per side. */
export function typesafe(modelId: TypeSafeDecisionModel, options: ProviderOptions = {}): DecisionModel {
  const provider = "typesafe";
  return httpModel({
    provider,
    modelId,
    url: () => `${options.baseURL ?? "https://api.typesafe.ai/v1"}/systemone`,
    headers: (state) => ({
      ...bearer(provider, options.apiKey, "TYPESAFE_API_KEY"),
      // TypeSafe keeps images behind an opt-in header while the feature is early.
      ...(isParts(state) && state.some((p) => p instanceof ImagePart) && { "TypeSafe-Danger-Zone-Images": "true" }),
      ...options.headers,
    }),
    encode: (state, questions) => ({ model: modelId, ...encodeSystemOne(state, questions, "assets") }),
    decode: decodeSystemOne,
    usage: systemOneUsage,
  });
}

type HttpModelSpec = {
  provider: string;
  modelId: string;
  url: () => string;
  headers: (state: State) => Record<string, string>;
  encode: (state: State, questions: Questions) => object;
  decode: (provider: string, body: Raw, questions: Questions) => Decoded;
  usage: (body: Raw) => ReportedUsage;
};

function httpModel(spec: HttpModelSpec): DecisionModel {
  return {
    provider: spec.provider,
    modelId: spec.modelId,
    async decide<const Qs extends Questions>({ state, questions, signal }: DecideCall<Qs>): Promise<DecideResult<Qs>> {
      const response = await fetch(spec.url(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...spec.headers(state) },
        body: JSON.stringify(spec.encode(state, questions)),
        signal,
      });
      const text = await response.text();
      const body = parseJson(text);
      if (!response.ok) {
        const message = errorMessage(body) ?? text.slice(0, 500);
        throw new DecisionError("http", spec.provider, `${response.status} ${message}`, {
          status: response.status,
          body: body ?? text,
        });
      }
      if (body === undefined) {
        throw new DecisionError("bad_response", spec.provider, "response is not JSON", { body: text });
      }
      const usage = withCost(spec.usage(body), spec.provider, spec.modelId);
      let decoded: Decoded;
      try {
        decoded = spec.decode(spec.provider, body, questions);
      } catch (error) {
        // The provider answered and billed the call, so keep its usage on the error.
        if (error instanceof DecisionError) error.details.usage = usage;
        throw error;
      }
      return { answers: decoded.answers as Answers<Qs>, model: decoded.model, usage, raw: body };
    },
  };
}

function parseJson(text: string): Raw {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Error messages from OpenAI/OpenRouter (`error.message`), Cloudflare (`errors[]`) and TypeSafe (`detail`). */
function errorMessage(body: Raw): string | undefined {
  const message = body?.error?.message ?? body?.errors?.[0]?.message ?? body?.detail?.message ?? body?.detail;
  return typeof message === "string" ? message : undefined;
}

function credential(provider: string, value: string | undefined, envName: string): string {
  const found = value ?? globalThis.process?.env?.[envName];
  if (!found) throw new DecisionError("missing_credentials", provider, `pass it in the options or set ${envName}`);
  return found;
}

function bearer(provider: string, apiKey: string | undefined, envName: string) {
  return { Authorization: `Bearer ${credential(provider, apiKey, envName)}` };
}
