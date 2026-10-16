import { describe, expect, test } from "bun:test";
import { callToJson, DecisionError, type DecisionModel, image, q } from "@system-one/ai";
import type { BunRequest } from "bun";
import { createApi, type Generator, type Transcriber } from "../src/server/api.ts";
import type { Budget } from "../src/server/budget.ts";
import type { ModelEntry } from "../src/server/models.ts";
import { openStore } from "../src/server/store.ts";

const png = image(await Bun.file(`${import.meta.dir}/../../ai/test/fixtures/red-square.png`).bytes());
const usage = { inputTokens: 300, outputTokens: 0, totalTokens: 300, costUsd: 0.00003, costSource: "list-price" as const };

/** A decision model that answers every boolean with 0.8, or fails the way `fail` says. */
function fakeModel(provider: string, fail?: () => never): DecisionModel {
  return {
    provider,
    modelId: "fake",
    async decide({ questions }) {
      if (fail) fail();
      const answers = Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0.8 }]));
      return { answers: answers as never, model: "fake-1", usage, raw: {} };
    },
  };
}

const entry = (key: string, model: DecisionModel, inputs: ModelEntry["inputs"] = ["text"]): ModelEntry => ({ key, label: key, inputs, env: [], model });

function setup({ budget = { dailyUsd: 1, providers: {} }, transcriber, generator }: { budget?: Budget; transcriber?: Transcriber; generator?: Generator } = {}) {
  const store = openStore(":memory:");
  const models = [
    entry("fake:ok", fakeModel("fake")),
    entry("fake:vision", fakeModel("fake"), ["text", "image"]),
    entry("fake:down", fakeModel("down", () => { throw new DecisionError("http", "down", "503 overloaded", { status: 503 }); })),
    entry("fake:odd", fakeModel("odd", () => { throw new DecisionError("bad_response", "odd", "no answer", { usage }); })),
  ];
  const api = createApi({ store, models, budget, transcriber, generator });
  const post = (path: keyof typeof api, json: unknown, params: Record<string, string> = {}) => {
    const route = api[path] as { POST: (req: Request) => Promise<Response> };
    const req = Object.assign(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(json) }), { params });
    return route.POST(req as BunRequest);
  };
  const get = (path: keyof typeof api, query = "") => (api[path] as { GET: (req: Request) => Promise<Response> }).GET(new Request(`http://x${path}${query}`));
  const runId = store.createRun("test", {});
  return { store, api, post, get, runId };
}

const call = callToJson({ state: "A guard sleeps.", questions: { asleep: q.boolean("Is the guard asleep?") } });

describe("/api/decide", () => {
  test("answers, returns usage and latency, and stores the call", async () => {
    const { post, store, runId } = setup();
    const res = await post("/api/decide", { runId, model: "fake:ok", call });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ answers: { asleep: { type: "boolean", probability: 0.8 } }, usage, model: "fake-1" });
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
    expect(store.spendToday().byProvider.fake).toBeCloseTo(0.00003, 10);
  });

  test("returns 400 for an unknown run, an unknown model or a bad call", async () => {
    const { post, runId } = setup();
    const cases = [
      { runId: "nope", model: "fake:ok", call },
      { runId, model: "fake:nope", call },
      { runId, model: "fake:ok", call: { state: "x", questions: { bad: { type: "choice", instructions: "?", options: { only: null } } } } },
    ];
    for (const json of cases) {
      const res = await post("/api/decide", json);
      expect(res.status).toBe(400);
    }
    const res = await post("/api/decide", { runId: "nope", model: "fake:ok", call });
    expect((await res.json()).error.code).toBe("unknown_run");
  });

  test("returns 400 when the model does not take the input", async () => {
    const { post, runId } = setup();
    const withImage = callToJson({ state: ["Frame:", png], questions: { red: q.boolean("Is it red?") } });
    const res = await post("/api/decide", { runId, model: "fake:ok", call: withImage });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unsupported_input");
    expect((await post("/api/decide", { runId, model: "fake:vision", call: withImage })).status).toBe(200);
  });

  test("returns 429 when the budget is spent", async () => {
    const { post, runId } = setup({ budget: { dailyUsd: 0, providers: {} } });
    const res = await post("/api/decide", { runId, model: "fake:ok", call });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("budget_exceeded");
  });

  test("returns 502 for a provider error and stores the failed call with its usage", async () => {
    const { post, store, runId } = setup();
    const down = await post("/api/decide", { runId, model: "fake:down", call });
    expect(down.status).toBe(502);
    expect((await down.json()).error).toEqual({ code: "http", message: "[down] 503 overloaded" });
    const odd = await post("/api/decide", { runId, model: "fake:odd", call });
    expect(odd.status).toBe(502);
    // The bad_response call was billed, so its cost counts.
    expect(store.spendToday().byProvider).toEqual({ down: 0, odd: 0.00003 });
  });
});

describe("runs, scores and rankings", () => {
  test("creates a run, adds scores and ranks models", async () => {
    const { post, get } = setup();
    const { id } = await (await post("/api/runs", { game: "arena-lockstep", config: { seed: 7 } })).json();
    const added = await post("/api/runs/:id/scores", { scores: [{ model: "fake:ok", metric: "win", value: 1 }] }, { id });
    expect(await added.json()).toEqual({ added: 1 });
    expect(await (await get("/api/rankings", "?game=arena-lockstep")).json()).toEqual([{ model: "fake:ok", metric: "win", rows: 1, mean: 1, sum: 1 }]);
  });

  test("rejects a bad game name, bad scores and an unknown run", async () => {
    const { post, runId } = setup();
    expect((await post("/api/runs", { game: "Bad Name" })).status).toBe(400);
    expect((await post("/api/runs/:id/scores", { scores: [{ model: "m", metric: "win", value: "1" }] }, { id: runId })).status).toBe(400);
    expect((await post("/api/runs/:id/scores", { scores: [] }, { id: "nope" })).status).toBe(400);
  });
});

describe("/api/transcribe", () => {
  test("transcribes with the injected transcriber and stores the cost", async () => {
    const transcriber: Transcriber = async () => ({ text: "open settings", language: "en", durationInSeconds: 2, usage: { ...usage, costUsd: 0.00005 } });
    const { post, store, runId } = setup({ transcriber });
    const res = await post("/api/transcribe", { runId, audio: "data:audio/wav;base64,AAAA" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "open settings", language: "en" });
    expect(store.spendToday().byProvider.gateway).toBeCloseTo(0.00005, 10);
    expect((await post("/api/transcribe", { runId, audio: "not audio" })).status).toBe(400);
  });

  test("returns 502 when the transcriber fails", async () => {
    const { post, runId } = setup({ transcriber: async () => { throw new Error("Bad Request"); } });
    const res = await post("/api/transcribe", { runId, audio: "data:audio/wav;base64,AAAA" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "transcription_failed", message: "Bad Request" });
  });
});

describe("/api/generate", () => {
  test("generates with the injected generator and stores the call", async () => {
    let seen: { system: string; prompt: string } | undefined;
    const generator: Generator = async (request) => {
      seen = request;
      return { text: "headphones", usage: { ...usage, costUsd: 0.00001 } };
    };
    const { post, store, runId } = setup({ generator });
    const res = await post("/api/generate", { runId, system: "Reply with the value only.", prompt: "Search for my headphones" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "headphones" });
    expect(seen).toEqual({ system: "Reply with the value only.", prompt: "Search for my headphones" });
    expect(store.spendToday().byProvider.gateway).toBeCloseTo(0.00001, 10);
  });

  test("rejects a missing prompt, and returns 502 when the generator fails", async () => {
    const { post, runId } = setup({ generator: async () => { throw new Error("Bad Gateway"); } });
    expect((await post("/api/generate", { runId })).status).toBe(400);
    expect((await post("/api/generate", { runId, prompt: "x".repeat(4001) })).status).toBe(400);
    const res = await post("/api/generate", { runId, prompt: "hi" });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("generation_failed");
  });
});

test("/api/budget shows the caps and today's spend", async () => {
  const { get } = setup();
  expect(await (await get("/api/budget")).json()).toEqual({ dailyUsd: 1, providers: {}, spent: { total: 0, byProvider: {} } });
});
