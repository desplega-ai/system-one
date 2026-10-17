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
import { type Budget, overBudget, overShare } from "./budget.ts";
import type { ModelEntry } from "./models.ts";
import { createLive } from "./live.ts";
import { type CallRecord, redact, type Score, type Stats, type StatsRange, type Store, fingerprint, statsRanges } from "./store.ts";

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

/**
 * Public mode (a share per visitor) also limits bursts. Without them, a visitor could open many calls at
 * once: each passes the share check before any of them is paid. A webcam session has 3 calls open, a
 * real-time arena up to 6.
 */
const MAX_OPEN_CALLS = { visitor: 8, ip: 16 };
/** New runs per IP and window, so nobody can fill the database with empty runs. */
const MAX_RUNS = { count: 60, windowMs: 10 * 60_000 };
/** Today's stats change fast and the Stats page polls them every 5 s. Longer ranges change slowly. */
const STATS_CACHE_MS: Record<StatsRange, number> = { today: 4_000, "7d": 15_000, "30d": 15_000 };
const listedGame = /^(arena|plane)-(lockstep|realtime)$|^attention-(live|still)$|^setup-(arena|attention)$|^voice-(free|missions)$/;
/** Run names come from the browser, so the public Stats page and the live feed name only the site's games. */
const shownGame = (game: string) => (listedGame.test(game) ? game : "other");
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
  const publicMode = budget.visitorUsd !== undefined || budget.ipUsd !== undefined;
  // The Stats page polls, and anyone can open it, so each range is computed at most every 15 s.
  // Every page polls /api/budget and every call checks the cap, so today's spend is summed at most once a
  // second. The cap can go over by one second of calls at most.
  let spendCache: { at: number; spend: ReturnType<Store["spendToday"]> } | undefined;
  const spendNow = () => {
    if (!spendCache || Date.now() - spendCache.at >= 1000) spendCache = { at: Date.now(), spend: store.spendToday() };
    return spendCache.spend;
  };
  const statsCache = new Map<string, { at: number; stats: Stats }>();
  /** The stats of everyone, or of one visitor ("show mine"). */
  const statsFor = (range: StatsRange, visitor?: string): Stats => {
    const key = `${range} ${visitor ?? ""}`;
    const hit = statsCache.get(key);
    if (hit && Date.now() - hit.at < STATS_CACHE_MS[range]) return hit.stats;
    // Each visitor that shows its own stats adds an entry, so old entries go.
    if (statsCache.size > 1000) {
      for (const [k, v] of statsCache) if (Date.now() - v.at > STATS_CACHE_MS[range]) statsCache.delete(k);
    }
    const raw = store.stats(range, new Date(), visitor);
    const games = new Map<string, Stats["games"][number]>();
    for (const row of raw.games) {
      const game = shownGame(row.game);
      const sum = games.get(game) ?? { game, runs: 0, calls: 0, usd: 0 };
      games.set(game, { game, runs: sum.runs + row.runs, calls: sum.calls + row.calls, usd: sum.usd + row.usd });
    }
    const stats = { ...raw, games: [...games.values()].sort((a, b) => b.calls - a.calls) };
    statsCache.set(key, { at: Date.now(), stats });
    return stats;
  };
  const live = createLive({
    today: (visitor) => store.todayTotals(new Date(), visitor),
    recent: (visitor) => store.recentCalls(20, visitor).map((call) => ({ ...call, game: shownGame(call.game) })),
  });
  /** Stores a call and sends it to the live feed. */
  const recordCall = (call: CallRecord) => {
    store.recordCall(call);
    live.push({
      at: call.startedAt.toISOString(),
      game: shownGame(store.runGame(call.runId) ?? "other"),
      model: call.model,
      provider: call.provider,
      kind: call.kind,
      latencyMs: Math.round(call.latencyMs),
      usd: call.usage?.costUsd ?? null,
      error: call.errorCode ?? null,
    }, call.visitor);
  };
  const open = new Map<string, number>();
  /** Takes a slot for one model call, or throws 429. Returns the function that frees it. */
  const takeSlot = (who: Who): (() => void) => {
    if (!publicMode) return () => {};
    const keys = [`v:${who.visitor}`, `i:${who.ipHash}`] as const;
    if ((open.get(keys[0]) ?? 0) >= MAX_OPEN_CALLS.visitor || (open.get(keys[1]) ?? 0) >= MAX_OPEN_CALLS.ip) {
      throw new HttpError(429, "too_many_calls", "too many calls at once, wait for the open ones");
    }
    for (const key of keys) open.set(key, (open.get(key) ?? 0) + 1);
    return () => {
      for (const key of keys) {
        const n = (open.get(key) ?? 1) - 1;
        if (n <= 0) open.delete(key);
        else open.set(key, n);
      }
    };
  };
  const runTimes = new Map<string, number[]>();
  const requireRunQuota = (who: Who) => {
    if (!publicMode) return;
    const now = Date.now();
    const recent = (runTimes.get(who.ipHash) ?? []).filter((t) => now - t < MAX_RUNS.windowMs);
    if (recent.length >= MAX_RUNS.count) throw new HttpError(429, "too_many_runs", "too many new games, wait a few minutes");
    runTimes.set(who.ipHash, [...recent, now]);
  };

  const requireBudget = (provider: string, who: Who) => {
    const reason = overBudget(budget, spendNow(), provider);
    if (reason) throw new HttpError(429, "budget_exceeded", reason);
    const share = overShare(budget, store.shareToday(who));
    if (share) throw new HttpError(429, "share_exceeded", share);
  };

  return {
    "/api/models": {
      GET: route(() => models.map(({ key, label, inputs, model }) => ({ key, label, inputs, provider: model.provider }))),
    },

    "/api/runs": {
      POST: route(async (req, who) => {
        const { game, config = {} } = await body(req);
        if (typeof game !== "string" || !idPattern.test(game)) throw new HttpError(400, "invalid_input", "game must match [a-z0-9-]{1,40}");
        if (JSON.stringify(config).length > 10_000) throw new HttpError(400, "invalid_input", "config is larger than 10,000 characters");
        requireRunQuota(who);
        return { id: store.createRun(game, config as JsonValue, who.visitor) };
      }),
    },

    "/api/runs/:id/scores": {
      POST: route(async (req, who) => {
        const runId = requireRun((req as BunRequest<"/api/runs/:id/scores">).params.id);
        // A run takes scores once, and only from the visitor that made it, so nobody can stuff the rankings.
        const owner = store.runOwner(runId);
        if (owner !== null && owner !== who.visitor) throw new HttpError(403, "not_your_run", "only the visitor that created the run can score it");
        if (store.hasScores(runId)) throw new HttpError(409, "already_scored", "this run has its scores");
        const { scores } = await body(req);
        if (!Array.isArray(scores) || scores.length > 1000) throw new HttpError(400, "invalid_input", "scores must be an array of at most 1000 rows");
        const rows = scores.map((s: unknown): Score => {
          const { model, metric, value } = (s ?? {}) as Record<string, unknown>;
          if (typeof model !== "string" || typeof metric !== "string" || !metricPattern.test(metric) || typeof value !== "number" || !Number.isFinite(value)) {
            throw new HttpError(400, "invalid_input", "each score needs a model, a metric matching [a-z0-9_]{1,40} and a finite value");
          }
          return { model, metric, value };
        });
        // Only models that answered in this run can have scores. The voice game scores "<key> (transcript)".
        const played = store.playedIn(runId);
        const unplayed = rows.find((r) => !played.has(r.model.replace(/ \(transcript\)$/, "")));
        if (unplayed) throw new HttpError(400, "unplayed_model", `${unplayed.model} made no call in this run`);
        store.addScores(runId, rows);
        return { added: rows.length };
      }),
    },

    "/api/decide": {
      POST: route(async (req, who) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        const entry = requireModel(json.model);
        const call = callFromJson(json.call);
        for (const input of inputsOf(call.state)) {
          if (!entry.inputs.includes(input)) throw new HttpError(400, "unsupported_input", `${entry.key} does not take ${input} input`);
        }
        requireBudget(entry.model.provider, who);
        const free = takeSlot(who);

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, ...whoFields(who), kind: "decide" as const, provider: entry.model.provider, model: entry.key, startedAt, input: redact(callToJson(call)) };
        try {
          const result = await entry.model.decide({ ...call, signal: req.signal });
          const latencyMs = Math.round(performance.now() - t0);
          recordCall({ ...record, latencyMs, usage: result.usage, output: result.answers });
          return { answers: result.answers, usage: result.usage, latencyMs, model: result.model };
        } catch (error) {
          recordCall({ ...record, latencyMs: performance.now() - t0, usage: usageOf(error), output: null, errorCode: errorCodeOf(error) });
          throw error;
        } finally {
          free();
        }
      }),
    },

    "/api/transcribe": {
      POST: route(async (req, who) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        if (typeof json.audio !== "string") throw new HttpError(400, "invalid_input", "audio must be a data URL");
        const clip = audio(json.audio);
        requireBudget("gateway", who);
        const free = takeSlot(who);

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, ...whoFields(who), kind: "transcribe" as const, provider: "gateway", model: cheapModels.transcription, startedAt, input: { $audio: fingerprint(clip.dataUrl) } };
        try {
          const result = await transcriber(clip, req.signal);
          const latencyMs = Math.round(performance.now() - t0);
          recordCall({ ...record, latencyMs, usage: result.usage, output: { text: result.text, language: result.language } });
          return { ...result, latencyMs };
        } catch (error) {
          recordCall({ ...record, latencyMs: performance.now() - t0, usage: undefined, output: null, errorCode: errorCodeOf(error) });
          throw new HttpError(502, "transcription_failed", error instanceof Error ? error.message : String(error));
        } finally {
          free();
        }
      }),
    },

    "/api/generate": {
      POST: route(async (req, who) => {
        const json = await body(req);
        const runId = requireRun(json.runId);
        const { system = "", prompt } = json;
        if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > 4000 || typeof system !== "string" || system.length > 2000) {
          throw new HttpError(400, "invalid_input", "prompt must be a string of 1 to 4,000 characters, and system at most 2,000");
        }
        requireBudget("gateway", who);
        const free = takeSlot(who);

        const startedAt = new Date();
        const t0 = performance.now();
        const record = { runId, ...whoFields(who), kind: "generate" as const, provider: "gateway", model: cheapModels.text, startedAt, input: { system, prompt } };
        try {
          const result = await generator({ system, prompt }, req.signal);
          const latencyMs = Math.round(performance.now() - t0);
          recordCall({ ...record, latencyMs, usage: result.usage, output: { text: result.text } });
          return { ...result, latencyMs };
        } catch (error) {
          recordCall({ ...record, latencyMs: performance.now() - t0, usage: undefined, output: null, errorCode: errorCodeOf(error) });
          throw new HttpError(502, "generation_failed", error instanceof Error ? error.message : String(error));
        } finally {
          free();
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
      // With a share per visitor, `you` holds this visitor's spend today and its cap.
      GET: route((_req, who) => ({
        ...budget,
        spent: spendNow(),
        ...(budget.visitorUsd !== undefined ? { you: { spent: store.shareToday(who).visitor, cap: budget.visitorUsd } } : {}),
      })),
    },

    "/api/live": {
      // Server-sent events: the newest calls first, then each new call within a second. ?mine=1 follows only
      // the calls of this browser's visitor cookie.
      GET: (req: Request) => {
        const who = whoOf(req);
        return live.open(who.ipHash, req.signal, new URL(req.url).searchParams.get("mine") === "1" ? who.visitor : undefined);
      },
    },

    "/api/stats": {
      // ?range=today|7d|30d, and ?mine=1 for only this browser's calls
      GET: route((req, who) => {
        const params = new URL(req.url).searchParams;
        const range = params.get("range") ?? "today";
        if (!statsRanges.includes(range as StatsRange)) throw new HttpError(400, "invalid_input", `range must be one of: ${statsRanges.join(", ")}`);
        return statsFor(range as StatsRange, params.get("mine") === "1" ? who.visitor : undefined);
      }),
    },

    "/api/*": route(() => {
      throw new HttpError(404, "not_found", "no such route");
    }),
  };
}

/** Who calls: a visitor id from a cookie (new on the first call) and a hash of the IP address. */
export type Who = { visitor: string; ipHash: string; isNew: boolean };

const VISITOR_COOKIE = "s1v";
// The salt keeps raw IP addresses out of the database. Without SYSTEM_ONE_SALT it changes on each restart.
const salt = process.env.SYSTEM_ONE_SALT ?? crypto.randomUUID();
const secureCookie = process.env.NODE_ENV === "production";

function whoOf(req: Request): Who {
  const visitor = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([0-9a-f-]{36})(?:;|$)`).exec(req.headers.get("cookie") ?? "")?.[1];
  // Fly sets Fly-Client-IP. Behind another proxy, the first X-Forwarded-For address.
  const ip = req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const ipHash = new Bun.CryptoHasher("sha256").update(`${salt}:${networkOf(ip)}`).digest("hex").slice(0, 24);
  return visitor ? { visitor, ipHash, isNew: false } : { visitor: crypto.randomUUID(), ipHash, isNew: true };
}

const whoFields = (who: Who) => ({ visitor: who.visitor, ipHash: who.ipHash });

/** An IPv4 address as it is. An IPv6 address as its /64 network: one home or phone gets a whole /64. */
export function networkOf(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Wraps a handler: its return value becomes JSON, and errors become JSON errors with a status. A new visitor gets its cookie. */
function route(handler: (req: Request, who: Who) => unknown) {
  return async (req: Request): Promise<Response> => {
    const who = whoOf(req);
    const res = await respond(req, who, handler);
    if (who.isNew) {
      res.headers.append("Set-Cookie", `${VISITOR_COOKIE}=${who.visitor}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secureCookie ? "; Secure" : ""}`);
    }
    return res;
  };
}

async function respond(req: Request, who: Who, handler: (req: Request, who: Who) => unknown): Promise<Response> {
  try {
    return Response.json(await handler(req, who));
  } catch (error) {
    // "aborted": the page stopped the request (a newer turn replaced it), so nobody reads this answer.
    const [status, code] =
      error instanceof HttpError
        ? [error.status, error.code]
        : error instanceof TypeError || error instanceof SyntaxError
          ? [400, "invalid_input"]
          : error instanceof DecisionError
            ? [502, error.code]
            : errorCodeOf(error) === "aborted"
              ? [499, "aborted"]
              : [500, "internal"];
    if (status === 500) console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: { code, message } }, { status });
  }
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
