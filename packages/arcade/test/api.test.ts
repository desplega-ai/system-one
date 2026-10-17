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
    entry("fake:slow", { ...fakeModel("fake"), decide: async (c) => (await Bun.sleep(20), fakeModel("fake").decide(c)) }),
    entry("fake:down", fakeModel("down", () => { throw new DecisionError("http", "down", "503 overloaded", { status: 503 }); })),
    entry("fake:odd", fakeModel("odd", () => { throw new DecisionError("bad_response", "odd", "no answer", { usage }); })),
  ];
  const api = createApi({ store, models, budget, transcriber, generator });
  // One browser: the first response sets the visitor cookie, and later requests send it back.
  let cookie = "";
  const keep = (res: Response) => {
    cookie ||= res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return res;
  };
  const post = async (path: keyof typeof api, json: unknown, params: Record<string, string> = {}, headers?: Record<string, string>) => {
    const route = api[path] as { POST: (req: Request) => Promise<Response> };
    const req = Object.assign(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(json), headers: headers ?? { cookie } }), { params });
    return keep(await route.POST(req as BunRequest));
  };
  const get = async (path: keyof typeof api, query = "") =>
    keep(await (api[path] as { GET: (req: Request) => Promise<Response> }).GET(new Request(`http://x${path}${query}`, { headers: { cookie } })));
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

  test("each visitor has its own share, and /api/budget reports it", async () => {
    const { post, get, runId } = setup({ budget: { dailyUsd: 1, providers: {}, visitorUsd: 0.00005 } });
    expect((await post("/api/decide", { runId, model: "fake:ok", call })).status).toBe(200);
    expect((await post("/api/decide", { runId, model: "fake:ok", call })).status).toBe(200);
    // 2 calls of $0.00003 put this visitor over $0.00005.
    const over = await post("/api/decide", { runId, model: "fake:ok", call });
    expect(over.status).toBe(429);
    expect((await over.json()).error.code).toBe("share_exceeded");
    expect((await (await get("/api/budget")).json()).you).toEqual({ spent: expect.closeTo(0.00006, 10), cap: 0.00005 });
    // Another visitor still has its share.
    expect((await post("/api/decide", { runId, model: "fake:ok", call }, {}, { cookie: "s1v=00000000-0000-4000-8000-000000000000" })).status).toBe(200);
  });

  test("public mode limits open calls per visitor", async () => {
    const { post, runId } = setup({ budget: { dailyUsd: 1, providers: {}, visitorUsd: 1 } });
    // One visitor: the same cookie on every call (the calls start before the first response sets one).
    const me = { cookie: "s1v=11111111-1111-4111-8111-111111111111" };
    const results = await Promise.all(Array.from({ length: 12 }, () => post("/api/decide", { runId, model: "fake:slow", call }, {}, me)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(8);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    // The slots free up when the calls end.
    expect((await post("/api/decide", { runId, model: "fake:ok", call }, {}, me)).status).toBe(200);
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

/** Creates a run in which fake:ok answered once, so the run can take scores for it. */
async function playedRun(post: ReturnType<typeof setup>["post"], game = "arena-lockstep", config: object = {}) {
  const { id } = await (await post("/api/runs", { game, config })).json();
  await post("/api/decide", { runId: id, model: "fake:ok", call });
  return id as string;
}

describe("runs, scores and rankings", () => {
  test("creates a run, adds scores and ranks models", async () => {
    const { post, get } = setup();
    const id = await playedRun(post, "arena-lockstep", { seed: 7 });
    const added = await post("/api/runs/:id/scores", { scores: [{ model: "fake:ok", metric: "win", value: 1 }] }, { id });
    expect(await added.json()).toEqual({ added: 1 });
    expect(await (await get("/api/rankings", "?game=arena-lockstep")).json()).toEqual([{ model: "fake:ok", metric: "win", rows: 1, mean: 1, sum: 1 }]);
  });

  test("rankings take several games and config filters", async () => {
    const { post, get } = setup();
    const id = await playedRun(post, "arena-lockstep", { policy: "top" });
    await post("/api/runs/:id/scores", { scores: [{ model: "fake:ok", metric: "win", value: 1 }] }, { id });
    expect(await (await get("/api/rankings", "?game=arena-lockstep,arena-realtime&config.policy=top")).json()).toHaveLength(1);
    expect(await (await get("/api/rankings", "?game=arena-lockstep&config.policy=sample")).json()).toEqual([]);
    expect((await get("/api/rankings", "?game=arena-lockstep&config.bad-key=1")).status).toBe(400);
  });

  test("a run takes scores once, and only from the visitor that made it", async () => {
    const { post } = setup();
    const id = await playedRun(post);
    const scores = { scores: [{ model: "fake:ok", metric: "win", value: 1 }] };
    // A model that made no call in the run cannot have a score.
    expect((await post("/api/runs/:id/scores", { scores: [{ model: "fake:vision", metric: "win", value: 1 }] }, { id })).status).toBe(400);
    expect((await post("/api/runs/:id/scores", scores, { id }, { cookie: "s1v=00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect((await post("/api/runs/:id/scores", scores, { id })).status).toBe(200);
    expect((await post("/api/runs/:id/scores", scores, { id })).status).toBe(409);
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

test("/api/stats sums the call log, keeps visitor data out, and checks the range", async () => {
  const { post, get, runId } = setup();
  await post("/api/decide", { runId, model: "fake:ok", call });
  const res = await get("/api/stats", "?range=7d");
  expect(res.status).toBe(200);
  const stats = await res.json();
  expect(stats).toMatchObject({ range: "7d", totals: { calls: 1, visitors: 1, runs: 1 }, models: [{ model: "fake:ok", calls: 1 }] });
  expect(stats.series).toHaveLength(7);
  expect(JSON.stringify(stats)).not.toMatch(/visitor"|ip_hash|ipHash/);
  // The browser names the runs, so names outside the site's games show as "other".
  expect(stats.games).toEqual([{ game: "other", runs: 1, calls: 1, usd: expect.closeTo(0.00003, 10) }]);
  expect((await get("/api/stats", "?range=1y")).status).toBe(400);
});

describe("/api/live", () => {
  /** Reads server-sent events from a stream, skipping comment lines. */
  function events(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return async () => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (chunk.startsWith("data: ")) return JSON.parse(chunk.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed");
        buffer += decoder.decode(value);
      }
    };
  }
  const open = (api: ReturnType<typeof setup>["api"], signal: AbortSignal, ip = "1.2.3.4") =>
    (api["/api/live"] as { GET: (req: Request) => Response }).GET(new Request("http://x/api/live", { signal, headers: { "fly-client-ip": ip } }));

  test("sends the newest calls, then each new call, without visitor data", async () => {
    const { api, post, runId } = setup();
    await post("/api/decide", { runId, model: "fake:ok", call });
    const abort = new AbortController();
    const res = open(api, abort.signal);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const next = events(res);
    const first = await next();
    expect(first).toMatchObject({ backlog: true, calls: [{ model: "fake:ok", game: "other", kind: "decide", error: null }], today: { calls: 1 }, viewers: 1 });
    expect(JSON.stringify(first)).not.toMatch(/visitor|ip_hash|ipHash|input|output/);

    await post("/api/decide", { runId, model: "fake:down", call });
    const second = await next();
    expect(second).toMatchObject({ backlog: false, calls: [{ model: "fake:down", error: "http" }], today: { calls: 2 } });
    abort.abort();
  });

  test("caps the open pages per IP", async () => {
    const { api } = setup();
    const abort = new AbortController();
    const statuses = Array.from({ length: 5 }, () => open(api, abort.signal).status);
    expect(statuses).toEqual([200, 200, 200, 200, 503]);
    expect(open(api, abort.signal, "5.6.7.8").status).toBe(200);
    abort.abort();
  });
});

test("/api/budget shows the caps and today's spend", async () => {
  const { get } = setup();
  expect(await (await get("/api/budget")).json()).toEqual({ dailyUsd: 1, providers: {}, spent: { total: 0, byProvider: {} } });
});

describe("networkOf", () => {
  test("keeps IPv4 and groups IPv6 by /64", async () => {
    const { networkOf } = await import("../src/server/api.ts");
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7");
    expect(networkOf("2a09:8280:1:0:abcd::1")).toBe("2a09:8280:1:0::/64");
    expect(networkOf("2a09:8280:0001:0000:ffff:1:2:3")).toBe("2a09:8280:1:0::/64");
    expect(networkOf("2a09::1")).toBe("2a09:0:0:0::/64");
  });
});
