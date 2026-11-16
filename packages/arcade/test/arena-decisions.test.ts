import { expect, test } from "bun:test";
import { q } from "@system-one/ai";
import { limitDecisions } from "../src/games/arena/decisions.ts";
import type { api } from "../src/web/lib/api.ts";

const call = { state: "test", questions: { ready: q.boolean("Is it ready?") } };
const result = {
  answers: { ready: { type: "boolean", probability: 1 } },
  usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
  latencyMs: 1,
  model: "test",
};

test("a full roster completes without exceeding six simultaneous calls", async () => {
  let active = 0;
  let peak = 0;
  const started: string[] = [];
  const decide: typeof api.decide = async (model) => {
    active++;
    peak = Math.max(peak, active);
    started.push(model);
    await Bun.sleep(1);
    active--;
    return result as never;
  };
  const limited = limitDecisions(decide);
  const models = Array.from({ length: 26 }, (_, i) => `model${i}`);
  await Promise.all(models.map((model) => limited(model, "run", call)));
  expect(started).toEqual(models);
  expect(peak).toBe(6);
  expect(active).toBe(0);
});

test("an aborted queued call sends no request and releases its slot", async () => {
  const gate = Promise.withResolvers<void>();
  const sent: string[] = [];
  const decide: typeof api.decide = async (model) => {
    sent.push(model);
    if (model === "first") await gate.promise;
    return result as never;
  };
  const limited = limitDecisions(decide, 1);
  const abort = new AbortController();
  const first = limited("first", "run", call);
  const second = limited("cancelled", "run", { ...call, signal: abort.signal });
  const third = limited("third", "run", call);
  const settled = Promise.allSettled([first, second, third]);
  abort.abort();
  gate.resolve();
  const answers = await settled;
  expect(answers.map((answer) => answer.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect(sent).toEqual(["first", "third"]);
});

test("a provider error releases the slot for the next model", async () => {
  const decide: typeof api.decide = async (model) => {
    if (model === "failed") throw new Error("Provider unavailable.");
    return result as never;
  };
  const limited = limitDecisions(decide, 1);
  const answers = await Promise.allSettled([limited("failed", "run", call), limited("next", "run", call)]);
  expect(answers.map((answer) => answer.status)).toEqual(["rejected", "fulfilled"]);
});
