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
