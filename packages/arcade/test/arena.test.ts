import { describe, expect, test } from "bun:test";
import {
  alive,
  chooseAction,
  createMatch,
  createRng,
  distance,
  endReason,
  hitChance,
  isOver,
  type Match,
  playTick,
  scores,
  standings,
  type Turn,
} from "../src/games/arena/engine.ts";
import { type ArenaAnswers, questionsFor, stateFor } from "../src/games/arena/state.ts";

const usage = { inputTokens: 400, outputTokens: 0, totalTokens: 400, costUsd: 0.00002, costSource: "list-price" as const };

/** Answers that pick one option with certainty. */
function sure(move: string, target: string, fire: boolean): ArenaAnswers {
  return {
    move: { type: "choice", choice: move as never, probabilities: { clockwise: 0, stay: 0, counterclockwise: 0, [move]: 1 } },
    target: { type: "choice", choice: target, probabilities: { [target]: 1 } },
    fire: { type: "boolean", probability: fire ? 1 : 0 },
  };
}
const turn = (answers: ArenaAnswers, latencyMs = 200): Turn => ({ answers, usage, latencyMs });
/** An rng that always returns the same number: 0 makes every shot hit, 0.99 makes every shot miss. */
const fixed = (n: number) => () => n;

describe("setup and geometry", () => {
  test("agents start evenly spaced with 3 hp", () => {
    const match = createMatch(["a", "b", "c", "d"]);
    expect(match.agents.map((a) => [a.id, a.angle, a.hp])).toEqual([
      ["red", 0, 3],
      ["blue", 90, 3],
      ["green", 180, 3],
      ["yellow", 270, 3],
    ]);
    expect(() => createMatch(["solo"])).toThrow(RangeError);
  });

  test("distance is the chord, and hit chance falls with distance and movement", () => {
    const [red, , green] = createMatch(["a", "b", "c", "d"]).agents;
    expect(distance(red!, green!)).toBeCloseTo(20, 10);
    expect(hitChance(0, false, false)).toBeCloseTo(0.9, 10);
    expect(hitChance(20, false, false)).toBeCloseTo(0.2, 10);
    expect(hitChance(10, true, false)).toBeLessThan(hitChance(10, false, false));
    expect(hitChance(20, true, true)).toBeCloseTo(0.072, 10);
    expect(hitChance(40, true, true)).toBe(0.05);
  });

  test("the seeded rng repeats", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("chooseAction()", () => {
  test("a refused answer falls back and is counted, the others still count", () => {
    const answers: ArenaAnswers = { ...sure("clockwise", "blue", true), fire: { type: "refusal", reason: "no" } };
    expect(chooseAction(answers, "top", fixed(0.5), ["blue"])).toEqual({
      action: { move: "clockwise", target: "blue", fire: false },
      refusals: 1,
    });
  });

  test("top takes the most probable answer, sample draws from the probabilities", () => {
    const answers: ArenaAnswers = {
      move: { type: "choice", choice: "stay", probabilities: { clockwise: 0.3, stay: 0.6, counterclockwise: 0.1 } },
      target: { type: "choice", choice: "blue", probabilities: { blue: 0.9, nobody: 0.1 } },
      fire: { type: "boolean", probability: 0.4 },
    };
    expect(chooseAction(answers, "top", fixed(0), ["blue"]).action).toEqual({ move: "stay", target: "blue", fire: false });
    // r = 0.05 lands in clockwise (first 0.3), blue (first 0.9), and fires (0.05 < 0.4).
    expect(chooseAction(answers, "sample", fixed(0.05), ["blue"]).action).toEqual({ move: "clockwise", target: "blue", fire: true });
    // r = 0.95 lands in counterclockwise, nobody, and holds fire.
    expect(chooseAction(answers, "sample", fixed(0.95), ["blue"]).action).toEqual({ move: "counterclockwise", target: null, fire: false });
  });
});

describe("playTick()", () => {
  test("moves first, then shots, then damage, so two agents can knock each other out", () => {
    let match: Match = createMatch(["m1", "m2"]);
    match = { ...match, agents: match.agents.map((a) => ({ ...a, hp: 1 })) };
    const next = playTick(match, { red: turn(sure("stay", "blue", true)), blue: turn(sure("stay", "red", true)) }, "top", fixed(0));
    expect(next.agents.map((a) => [a.id, a.hp, a.diedAt])).toEqual([
      ["red", 0, 1],
      ["blue", 0, 1],
    ]);
    expect(next.shots).toEqual([
      { from: "red", to: "blue", hit: true },
      { from: "blue", to: "red", hit: true },
    ]);
    expect(isOver(next)).toBe(true);
  });

  test("moving turns the agent 15 degrees and misses are counted", () => {
    const match = createMatch(["m1", "m2"]);
    const next = playTick(match, { red: turn(sure("counterclockwise", "blue", true)), blue: turn(sure("clockwise", "nobody", true)) }, "top", fixed(0.99));
    expect(next.agents.map((a) => [a.id, a.angle, a.hp, a.shots, a.hits])).toEqual([
      ["red", 345, 3, 1, 0],
      ["blue", 195, 3, 0, 0],
    ]);
    expect(next.events).toEqual(["red missed blue"]);
  });

  test("a failed call is an idle turn, and an agent without a turn does nothing", () => {
    const match = createMatch(["m1", "m2", "m3"]);
    const next = playTick(match, { red: { error: "502" }, blue: turn(sure("clockwise", "green", false)) }, "top", fixed(0));
    const [red, blue, green] = next.agents;
    expect([red!.errors, red!.actions, red!.calls]).toEqual([1, 1, 0]);
    expect([blue!.actions, blue!.calls, blue!.latencyMs, blue!.costUsd]).toEqual([1, 1, 200, 0.00002]);
    expect([green!.actions, green!.angle]).toEqual([0, 240]);
  });

  test("a turn that folds several real-time answers counts all their calls", () => {
    const match = createMatch(["m1", "m2"]);
    const next = playTick(match, { red: { ...turn(sure("stay", "nobody", false), 500), calls: 3 } }, "top", fixed(0));
    expect([next.agents[0]!.calls, next.agents[0]!.actions, next.agents[0]!.latencyMs]).toEqual([3, 1, 500]);
  });

  test("a shot at an agent that is already out does nothing", () => {
    let match = createMatch(["m1", "m2", "m3"]);
    match = { ...match, agents: match.agents.map((a) => (a.id === "green" ? { ...a, hp: 0, diedAt: 0 } : a)) };
    const next = playTick(match, { red: turn(sure("stay", "green", true)) }, "top", fixed(0));
    expect(next.shots).toEqual([]);
    expect(next.agents[0]!.shots).toBe(0);
  });

  test("the match ends at maxTicks", () => {
    let match = createMatch(["m1", "m2"], { maxTicks: 2 });
    match = playTick(match, {}, "top", fixed(0));
    expect(isOver(match)).toBe(false);
    match = playTick(match, {}, "top", fixed(0));
    expect(isOver(match)).toBe(true);
  });
});

describe("stalemate", () => {
  const quiet = () => turn(sure("stay", "nobody", false));

  test("quiet turns add up, a shot resets them, and the match ends in a draw at the limit", () => {
    let match = createMatch(["m1", "m2"], { stalemateTurns: 3 });
    match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0.99));
    match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0.99));
    expect(match.quietTurns).toBe(2);
    match = playTick(match, { red: turn(sure("stay", "blue", true)), blue: quiet() }, "top", fixed(0.99));
    expect(match.quietTurns).toBe(0);
    for (let i = 0; i < 3; i++) match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0.99));
    expect(endReason(match)).toBe("stalemate");
    expect(match.events[0]).toBe("stalemate: nobody fired for 3 turns");

    const rows = scores(match);
    expect(rows.filter((r) => r.metric === "win").map((r) => r.value)).toEqual([0, 0]);
    expect(rows.filter((r) => r.metric === "stalemate").map((r) => r.value)).toEqual([1, 1]);
    expect(rows.find((r) => r.metric === "stay_rate")!.value).toBe(1);
  });

  test("in real-time a turn ends only when every standing agent has acted", () => {
    let match = createMatch(["fast", "slow"], { stalemateTurns: 2 });
    // The fast agent acts on 3 ticks before the slow one answers once: that is one quiet turn.
    for (let i = 0; i < 3; i++) match = playTick(match, { red: quiet() }, "top", fixed(0.99));
    expect(match.quietTurns).toBe(0);
    match = playTick(match, { blue: quiet() }, "top", fixed(0.99));
    expect(match.quietTurns).toBe(1);
    expect(isOver(match)).toBe(false);
  });

  test("the state tells the models about the rule and the count", () => {
    let match = createMatch(["m1", "m2"], { stalemateTurns: 4 });
    match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0.99));
    const state = stateFor(match, match.agents[0]!) as { rules: string; quietTurns: number; drawAfterQuietTurns: number };
    expect(state.rules).toContain("nobody fires for 4 turns");
    expect([state.quietTurns, state.drawAfterQuietTurns]).toEqual([1, 4]);
  });
});

describe("standings and scores", () => {
  test("ranks by standing, then later knockout, then hp, then hits", () => {
    const match = createMatch(["m1", "m2", "m3", "m4"]);
    const set = (id: string, patch: object) => match.agents.splice(match.agents.findIndex((a) => a.id === id), 1, { ...match.agents.find((a) => a.id === id)!, ...patch });
    set("red", { hp: 0, diedAt: 5 });
    set("blue", { hp: 0, diedAt: 9 });
    set("green", { hp: 1, hits: 2 });
    set("yellow", { hp: 1, hits: 4 });
    expect(standings(match).map((a) => a.id)).toEqual(["yellow", "green", "blue", "red"]);
  });

  test("scores have one row per agent and metric, and a tie for first is not a win", () => {
    const match = { ...createMatch(["jev", "jev"]), tick: 100 };
    const rows = scores(match);
    expect(rows.filter((r) => r.metric === "win")).toEqual([
      { model: "jev", metric: "win", value: 0 },
      { model: "jev", metric: "win", value: 0 },
    ]);
    expect(new Set(rows.map((r) => r.metric))).toEqual(
      new Set(["win", "placement", "stalemate", "stay_rate", "survived_ticks", "hits", "shots", "actions", "refusals", "errors", "latency_ms", "cost_usd"]),
    );
  });
});

describe("state for the model", () => {
  test("gives each agent the others with computed geometry, and only standing targets", () => {
    let match = createMatch(["m1", "m2", "m3", "m4"]);
    match = { ...match, agents: match.agents.map((a) => (a.id === "yellow" ? { ...a, hp: 0, diedAt: 1 } : a)) };
    const red = match.agents[0]!;
    const state = stateFor(match, red) as { others: { id: string; distance: string; degreesAway: number; direction: string }[] };
    expect(state.others.map((o) => [o.id, o.distance, o.degreesAway, o.direction])).toEqual([
      ["blue", "mid", 90, "clockwise"],
      ["green", "far", 180, "clockwise"],
    ]);
    expect(Object.keys(questionsFor(match, red).target.options)).toEqual(["blue", "green", "nobody"]);
    expect(alive(match)).toHaveLength(3);
  });
});

test("every preset uses registry models, 2 to 6 of them, and has a unique id", async () => {
  const { presets } = await import("../src/games/arena/presets.ts");
  const { registry } = await import("../src/server/models.ts");
  const keys = new Set(registry.map((e) => e.key));
  for (const p of presets) {
    expect({ id: p.id, unknown: p.models.filter((m) => !keys.has(m)) }).toEqual({ id: p.id, unknown: [] });
    expect(p.models.length).toBeGreaterThanOrEqual(2);
    expect(p.models.length).toBeLessThanOrEqual(6);
  }
  expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
});

test("the presets mix every field, clock and policy", async () => {
  const { presets } = await import("../src/games/arena/presets.ts");
  const mixes = new Set(presets.map((p) => `${p.field} ${p.clock} ${p.policy}`));
  for (const field of ["ring", "plane"]) {
    for (const clock of ["lockstep", "realtime"]) {
      for (const policy of ["sample", "top"]) expect({ mix: `${field} ${clock} ${policy}`, found: mixes.has(`${field} ${clock} ${policy}`) }).toMatchObject({ found: true });
    }
  }
});
