// The JSON API every game uses. The server checks the budget and stores every call.
import {
  AudioPart,
  audio,
  callFromJson,
  callToJson,
  DecisionError,
  ImagePart,
  type JsonValue,
  type State,
  type Usage,
} from "@system-one/ai";
import { cheapModels, gatewayCostUsd, generateText, transcribe } from "@system-one/ai/generate";
import type { BunRequest } from "bun";
import { type Budget, overBudget } from "./budget.ts";
import type { ModelEntry } from "./models.ts";
import { redact, type Score, type Store, fingerprint } from "./store.ts";

export type Transcription = { text: string; language: string | undefined; durationInSeconds: number | undefined; usage: Usage };
export type Transcriber = (clip: AudioPart, signal: AbortSignal) => Promise<Transcription>;

// spacexai/grok-stt list price, checked 2026-10-16. Used when AI Gateway reports no cost.
const transcriptionUsdPerSecond = 0.000028;

export const gatewayTranscriber: Transcriber = async (clip, signal) => {
  const result = await transcribe({ model: cheapModels.transcription, audio: clip.base64, abortSignal: signal });
  const reported = gatewayCostUsd(result.providerMetadata);
  const estimate = result.durationInSeconds === undefined ? undefined : result.durationInSeconds * transcriptionUsdPerSecond;
  return {
    text: result.text,
    language: result.language,
    durationInSeconds: result.durationInSeconds,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: reported ?? estimate,
      costSource: reported !== undefined ? "provider" : estimate !== undefined ? "list-price" : undefined,
    },
  };
};

export type Generation = { text: string; usage: Usage };
export type Generator = (request: { system: string; prompt: string }, signal: AbortSignal) => Promise<Generation>;

// mistral/mistral-nemo list price per 1M tokens, checked 2026-10-16. Used when AI Gateway reports no cost.
const textUsdPerMillion = { input: 0.029, output: 0.03 };

/** Short text from the cheap text model, for the few inputs that decisions cannot give (a search query, a message). */
export const gatewayGenerator: Generator = async ({ system, prompt }, signal) => {
  const result = await generateText({ model: cheapModels.text, system, prompt, maxOutputTokens: 80, abortSignal: signal });
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const reported = gatewayCostUsd(result.providerMetadata);
  return {
    text: result.text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: reported ?? (inputTokens * textUsdPerMillion.input + outputTokens * textUsdPerMillion.output) / 1_000_000,
      costSource: reported !== undefined ? "provider" : "list-price",
    },
  };
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Deps = { store: Store; models: readonly ModelEntry[]; budget: Budget; transcriber?: Transcriber; generator?: Generator };

const idPattern = /^[a-z0-9-]{1,40}$/;
const metricPattern = /^[a-z0-9_]{1,40}$/;

export function createApi({ store, models, budget, transcriber = gatewayTranscriber, generator = gatewayGenerator }: Deps) {
  const modelsByKey = new Map(models.map((entry) => [entry.key, entry]));

  const requireRun = (runId: unknown): string => {
    if (typeof runId !== "string" || !store.hasRun(runId)) throw new HttpError(400, "unknown_run", "runId does not name a run");
    return runId;
  };
  const requireModel = (key: unknown): ModelEntry => {
    const entry = typeof key === "string" ? modelsByKey.get(key) : undefined;
    if (!entry) throw new HttpError(400, "unknown_model", `model must be one of: ${[...modelsByKey.keys()].join(", ")}`);
    return entry;
  };
  const requireBudget = (provider: string) => {
    const reason = overBudget(budget, store.spendToday(), provider);
    if (reason) throw new HttpError(429, "budget_exceeded", reason);
  };

  return {
    "/api/models": {
      GET: route(() => models.map(({ key, label, inputs, model }) => ({ key, label, inputs, provider: model.provider }))),
    },

    "/api/runs": {
      POST: route(async (req) => {
        const { game, config = {} } = await body(req);
        if (typeof game !== "string" || !idPattern.test(game)) throw new HttpError(400, "invalid_input", "game must match [a-z0-9-]{1,40}");
        if (JSON.stringify(config).length > 10_000) throw new HttpError(400, "invalid_input", "config is larger than 10,000 characters");
        return { id: store.createRun(game, config as JsonValue) };
      }),
    },

    "/api/runs/:id/scores": {
      POST: route(async (req) => {
        const runId = requireRun((req as BunRequest<"/api/runs/:id/scores">).params.id);
        const { scores } = await body(req);
        if (!Array.isArray(scores) || scores.length > 1000) throw new HttpError(400, "invalid_input", "scores must be an array of at most 1000 rows");
        const rows = scores.map((s: unknown): Score => {
          const { model, metric, value } = (s ?? {}) as Record<string, unknown>;
          if (typeof model !== "string" || typeof metric !== "string" || !metricPattern.test(metric) || typeof value !== "number" || !Number.isFinite(value)) {
            throw new HttpError(400, "invalid_input", "each score needs a model, a metric matching [a-z0-9_]{1,40} and a finite value");
          }
          return { model, metric, value };
        });
        store.addScores(runId, rows);
        return { added: rows.length };
      }),
    },

    "/api/decide": {
      POST: route(async (req) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        const entry = requireModel(json.model);
        const call = callFromJson(json.call);
        for (const input of inputsOf(call.state)) {
          if (!entry.inputs.includes(input)) throw new HttpError(400, "unsupported_input", `${entry.key} does not take ${input} input`);
        }
        requireBudget(entry.model.provider);

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, kind: "decide" as const, provider: entry.model.provider, model: entry.key, startedAt, input: redact(callToJson(call)) };
        try {
          const result = await entry.model.decide({ ...call, signal: req.signal });
          const latencyMs = Math.round(performance.now() - t0);
          store.recordCall({ ...record, latencyMs, usage: result.usage, output: result.answers });
          return { answers: result.answers, usage: result.usage, latencyMs, model: result.model };
        } catch (error) {
          store.recordCall({ ...record, latencyMs: performance.now() - t0, usage: usageOf(error), output: null, errorCode: errorCodeOf(error) });
          throw error;
        }
      }),
    },

    "/api/transcribe": {
      POST: route(async (req) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        if (typeof json.audio !== "string") throw new HttpError(400, "invalid_input", "audio must be a data URL");
        const clip = audio(json.audio);
        requireBudget("gateway");

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, kind: "transcribe" as const, provider: "gateway", model: cheapModels.transcription, startedAt, input: { $audio: fingerprint(clip.dataUrl) } };
        try {
          const result = await transcriber(clip, req.signal);
          const latencyMs = Math.round(performance.now() - t0);
          store.recordCall({ ...record, latencyMs, usage: result.usage, output: { text: result.text, language: result.language } });
          return { ...result, latencyMs };
        } catch (error) {
          store.recordCall({ ...record, latencyMs: performance.now() - t0, usage: undefined, output: null, errorCode: errorCodeOf(error) });
          throw new HttpError(502, "transcription_failed", error instanceof Error ? error.message : String(error));
        }
      }),
    },

    "/api/generate": {
      POST: route(async (req) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        const { system = "", prompt } = json;
        if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > 4000 || typeof system !== "string" || system.length > 2000) {
          throw new HttpError(400, "invalid_input", "prompt must be a string of 1 to 4,000 characters, and system at most 2,000");
        }
        requireBudget("gateway");

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, kind: "generate" as const, provider: "gateway", model: cheapModels.text, startedAt, input: { system, prompt } };
        try {
          const result = await generator({ system, prompt }, req.signal);
          const latencyMs = Math.round(performance.now() - t0);
          store.recordCall({ ...record, latencyMs, usage: result.usage, output: { text: result.text } });
          return { ...result, latencyMs };
        } catch (error) {
          store.recordCall({ ...record, latencyMs: performance.now() - t0, usage: undefined, output: null, errorCode: errorCodeOf(error) });
          throw new HttpError(502, "generation_failed", error instanceof Error ? error.message : String(error));
        }
      }),
    },

    "/api/rankings": {
      GET: route((req) => {
        // ?game=arena-lockstep,arena-realtime&config.policy=top
        const params = new URL(req.url).searchParams;
        const games = (params.get("game") ?? "").split(",").filter(Boolean);
        if (games.length === 0 || games.length > 8 || !games.every((g) => idPattern.test(g))) throw new HttpError(400, "invalid_input", "pass ?game=");
        const config: Record<string, string> = {};
        for (const [key, value] of params) {
          if (!key.startsWith("config.")) continue;
          const name = key.slice("config.".length);
          if (!/^[a-z_]{1,40}$/.test(name) || !/^[\w.:-]{1,100}$/.test(value)) throw new HttpError(400, "invalid_input", `bad filter ${key}`);
          config[name] = value;
        }
        return store.ranking(games, config);
      }),
    },

    "/api/budget": {
      GET: route(() => ({ ...budget, spent: store.spendToday() })),
    },

    "/api/*": route(() => {
      throw new HttpError(404, "not_found", "no such route");
    }),
  };
}

/** Wraps a handler: its return value becomes JSON, and errors become JSON errors with a status. */
function route(handler: (req: Request) => unknown) {
  return async (req: Request): Promise<Response> => {
    try {
      return Response.json(await handler(req));
    } catch (error) {
      const [status, code] =
        error instanceof HttpError
          ? [error.status, error.code]
          : error instanceof TypeError || error instanceof SyntaxError
            ? [400, "invalid_input"]
            : error instanceof DecisionError
              ? [502, error.code]
              : [500, "internal"];
      if (status === 500) console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: { code, message } }, { status });
    }
  };
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const json: unknown = await req.json();
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new HttpError(400, "invalid_input", "expected a JSON object");
  return json as Record<string, unknown>;
}

function inputsOf(state: State): Set<"image" | "audio"> {
  const parts = Array.isArray(state) ? state : [];
  const inputs = new Set<"image" | "audio">();
  for (const p of parts) {
    if (p instanceof ImagePart) inputs.add("image");
    if (p instanceof AudioPart) inputs.add("audio");
  }
  return inputs;
}

function usageOf(error: unknown): Usage | undefined {
  return error instanceof DecisionError ? error.details.usage : undefined;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof DecisionError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "error";
}
