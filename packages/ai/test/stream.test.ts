import { afterEach, expect, jest, test } from "bun:test";
import { decisionStream } from "../src/index.ts";

afterEach(() => {
  jest.useRealTimers();
});

/** A fake decide whose calls resolve only when the test says so. */
function controlledDecide() {
  const pending: { call: number; resolve: (r: string) => void; reject: (e: unknown) => void; signal: AbortSignal }[] = [];
  const decide = (call: number, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => pending.push({ call, resolve, reject, signal }));
  return { decide, pending };
}

const flush = () => new Promise((r) => setImmediate(r));

test("calls at once and then every everyMs, up to maxInFlight open calls", () => {
  jest.useFakeTimers();
  const { decide, pending } = controlledDecide();
  let n = 0;
  const stream = decisionStream({ makeCall: () => ++n, decide, everyMs: 100, maxInFlight: 2, onResult: () => {} });

  expect(pending).toHaveLength(1);
  jest.advanceTimersByTime(100);
  expect(pending).toHaveLength(2);
  // Two calls are open, so the next ticks are skipped.
  jest.advanceTimersByTime(300);
  expect(pending).toHaveLength(2);
  expect(stream.inFlight).toBe(2);
  stream.stop();
});

test("drops a result that arrives after a newer one", async () => {
  jest.useFakeTimers();
  const { decide, pending } = controlledDecide();
  const results: string[] = [];
  let n = 0;
  const stream = decisionStream({ makeCall: () => ++n, decide, everyMs: 100, maxInFlight: 3, onResult: (r) => results.push(r) });
  jest.advanceTimersByTime(100);

  pending[1]!.resolve("second");
  await flush();
  pending[0]!.resolve("first, but late");
  await flush();
  expect(results).toEqual(["second"]);
  stream.stop();
});

test("skips a tick when makeCall returns null", () => {
  jest.useFakeTimers();
  const { decide, pending } = controlledDecide();
  let ready = false;
  const stream = decisionStream({ makeCall: () => (ready ? 1 : null), decide, everyMs: 100, onResult: () => {} });
  jest.advanceTimersByTime(300);
  expect(pending).toHaveLength(0);
  ready = true;
  jest.advanceTimersByTime(100);
  expect(pending).toHaveLength(1);
  stream.stop();
});

test("stop() aborts open calls and no callback runs after it", async () => {
  jest.useFakeTimers();
  const { decide, pending } = controlledDecide();
  const seen: string[] = [];
  const stream = decisionStream({
    makeCall: () => 1,
    decide,
    everyMs: 100,
    onResult: () => seen.push("result"),
    onError: () => seen.push("error"),
  });
  stream.stop();
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[0]!.resolve("late");
  await flush();
  jest.advanceTimersByTime(500);
  expect(pending).toHaveLength(1);
  expect(seen).toEqual([]);
});

test("passes errors to onError with the call, and keeps going", async () => {
  jest.useFakeTimers();
  const { decide, pending } = controlledDecide();
  const errors: [unknown, number][] = [];
  let n = 0;
  const stream = decisionStream({ makeCall: () => ++n, decide, everyMs: 100, onResult: () => {}, onError: (e, call) => errors.push([e, call]) });
  pending[0]!.reject(new Error("502"));
  await flush();
  expect(errors).toEqual([[new Error("502"), 1]]);
  jest.advanceTimersByTime(100);
  expect(pending).toHaveLength(2);
  stream.stop();
});
