import { describe, expect, test } from "bun:test";
import { withCost } from "../../ai/src/pricing.ts";
import { overBudget, parseBudget } from "../src/server/budget.ts";
import { registry } from "../src/server/models.ts";
import { openStore, redact } from "../src/server/store.ts";

const usage = (costUsd: number) => ({ inputTokens: 100, outputTokens: 0, totalTokens: 100, costUsd, costSource: "provider" as const });

describe("store", () => {
  test("records calls and sums today's spend per provider", () => {
    const store = openStore(":memory:");
    const runId = store.createRun("arena-lockstep", { seed: 1 });
    expect(store.hasRun(runId)).toBe(true);
    expect(store.hasRun("nope")).toBe(false);

    const now = new Date("2026-10-16T12:00:00Z");
    const base = { runId, kind: "decide" as const, model: "m", latencyMs: 150, input: null, output: null };
    store.recordCall({ ...base, provider: "openai", startedAt: now, usage: usage(0.01) });
    store.recordCall({ ...base, provider: "openai", startedAt: now, usage: usage(0.02) });
    store.recordCall({ ...base, provider: "cloudflare", startedAt: now, usage: usage(0.005) });
    // Yesterday does not count, and a failed call without usage counts as nothing.
    store.recordCall({ ...base, provider: "openai", startedAt: new Date("2026-10-15T23:59:59Z"), usage: usage(5) });
    store.recordCall({ ...base, provider: "openai", startedAt: now, usage: undefined, errorCode: "http" });

    const spend = store.spendToday(now);
    expect(spend.byProvider.openai).toBeCloseTo(0.03, 10);
    expect(spend.byProvider.cloudflare).toBeCloseTo(0.005, 10);
    expect(spend.total).toBeCloseTo(0.035, 10);
  });

  test("ranks over agent rows, so a model that plays twice counts twice", () => {
    const store = openStore(":memory:");
    const a = store.createRun("arena-lockstep", {});
    const b = store.createRun("arena-lockstep", {});
    const other = store.createRun("arena-realtime", {});
    store.addScores(a, [
      { model: "jev", metric: "win", value: 1 },
      { model: "jev", metric: "win", value: 0 },
      { model: "clef", metric: "win", value: 0 },
    ]);
    store.addScores(b, [{ model: "clef", metric: "win", value: 1 }]);
    store.addScores(other, [{ model: "jev", metric: "win", value: 1 }]);

    expect(store.ranking("arena-lockstep")).toEqual([
      { model: "clef", metric: "win", rows: 2, mean: 0.5, sum: 1 },
      { model: "jev", metric: "win", rows: 2, mean: 0.5, sum: 1 },
    ]);
  });

  test("ranks over several games, and keeps only runs whose config matches", () => {
    const store = openStore(":memory:");
    const top = store.createRun("arena-lockstep", { policy: "top" });
    const sample = store.createRun("arena-realtime", { policy: "sample" });
    store.addScores(top, [{ model: "jev", metric: "win", value: 1 }]);
    store.addScores(sample, [{ model: "jev", metric: "win", value: 0 }]);

    expect(store.ranking(["arena-lockstep", "arena-realtime"])).toEqual([{ model: "jev", metric: "win", rows: 2, mean: 0.5, sum: 1 }]);
    expect(store.ranking(["arena-lockstep", "arena-realtime"], { policy: "sample" })).toEqual([{ model: "jev", metric: "win", rows: 1, mean: 0, sum: 0 }]);
    expect(() => store.ranking("arena-lockstep", { "policy') OR 1=1 --": "x" })).toThrow();
  });

  test("stats() sums the call log per model, game, hour and error, with latency percentiles", () => {
    const store = openStore(":memory:");
    const arena = store.createRun("arena-lockstep", {}, "v1");
    const attention = store.createRun("attention-live", {}, "v2");
    const now = new Date("2026-10-17T12:30:00Z");
    const call = (runId: string, model: string, at: string, latencyMs: number, extra: { errorCode?: string; visitor?: string } = {}) =>
      store.recordCall({ runId, kind: "decide", provider: model.split(":")[0]!, model, startedAt: new Date(at), latencyMs, usage: usage(0.001), input: null, output: null, ...extra });
    for (const ms of [100, 200, 300, 400]) call(arena, "openai:luna", "2026-10-17T09:10:00Z", ms, { visitor: "v1" });
    call(arena, "openai:luna", "2026-10-17T09:20:00Z", 5000, { errorCode: "http", visitor: "v1" });
    call(attention, "cloudflare:clef", "2026-10-17T11:00:00Z", 250, { visitor: "v2" });
    call(attention, "cloudflare:clef", "2026-10-17T11:01:00Z", 900, { errorCode: "aborted", visitor: "v2" });
    // Yesterday is outside "today", inside "7d".
    call(arena, "openai:luna", "2026-10-16T20:00:00Z", 100, { visitor: "v1" });

    const today = store.stats("today", now);
    expect(today.since).toBe("2026-10-17T00:00:00.000Z");
    expect(today.series).toHaveLength(24);
    expect(today.series[9]).toEqual({ at: "2026-10-17T09:00:00.000Z", calls: 5, failed: 1, usd: expect.closeTo(0.005, 10) });
    expect(today.series[11]).toMatchObject({ calls: 2, failed: 0 });
    expect(today.totals).toMatchObject({ calls: 7, failed: 1, aborted: 1, inputTokens: 700, visitors: 2, runs: 2 });
    // Latency counts successful calls only: 100, 200, 250, 300, 400.
    expect(today.totals).toMatchObject({ p50Ms: 250, p95Ms: 400 });
    expect(today.models.map((m) => [m.model, m.calls, m.failed, m.aborted, m.p50Ms])).toEqual([
      ["openai:luna", 5, 1, 0, 200],
      ["cloudflare:clef", 2, 0, 1, 250],
    ]);
    expect(today.games).toEqual([
      { game: "arena-lockstep", runs: 1, calls: 5, usd: expect.closeTo(0.005, 10) },
      { game: "attention-live", runs: 1, calls: 2, usd: expect.closeTo(0.002, 10) },
    ]);
    expect(today.errors).toEqual([
      { code: "aborted", calls: 1 },
      { code: "http", calls: 1 },
    ]);

    const week = store.stats("7d", now);
    expect(week.series.map((b) => b.at.slice(0, 10))).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(week.series.map((b) => b.calls)).toEqual([0, 0, 0, 0, 0, 1, 7]);
    expect(store.stats("30d", now).series).toHaveLength(30);
  });

  test("redact() keeps text and replaces media with a hash and a size", () => {
    const redacted = redact({ state: ["Frames:", { $image: "data:image/png;base64,AAAA" }, { hp: 3 }], questions: {} });
    expect(redacted.state).toEqual(["Frames:", { $image: { sha256: expect.any(String), bytes: 3 } }, { hp: 3 }]);
  });
});

describe("budget", () => {
  test("parses the env and defaults to $1 a day", () => {
    expect(parseBudget(undefined)).toEqual({ dailyUsd: 1, providers: {} });
    expect(parseBudget('{"dailyUsd":2,"providers":{"openai":0.25}}')).toEqual({ dailyUsd: 2, providers: { openai: 0.25 } });
    expect(parseBudget('{"providers":{"openai":0.25}}')).toEqual({ dailyUsd: undefined, providers: { openai: 0.25 } });
    expect(() => parseBudget('{"dailyUsd":-1}')).toThrow("dailyUsd");
    expect(() => parseBudget('{"providers":{"openai":"lots"}}')).toThrow("providers");
    expect(() => parseBudget("not json")).toThrow(SyntaxError);
  });

  test("blocks at the cap, in total and per provider", () => {
    const budget = { dailyUsd: 1, providers: { openai: 0.25 } };
    expect(overBudget(budget, { total: 0.5, byProvider: { openai: 0.1 } }, "openai")).toBeUndefined();
    expect(overBudget(budget, { total: 1, byProvider: {} }, "cloudflare")).toContain("daily budget of $1");
    expect(overBudget(budget, { total: 0.3, byProvider: { openai: 0.25 } }, "openai")).toContain("openai budget");
    expect(overBudget(budget, { total: 0.3, byProvider: { openai: 0.25 } }, "cloudflare")).toBeUndefined();
    expect(overBudget({ dailyUsd: 0, providers: {} }, { total: 0, byProvider: {} }, "openai")).toContain("is spent");
  });
});

test("every registry model has a list price, so the budget can count it", () => {
  for (const { key, model } of registry) {
    const { costUsd } = withCost({ inputTokens: 1000 }, model.provider, model.modelId);
    expect({ key, priced: costUsd !== undefined }).toEqual({ key, priced: true });
  }
});
