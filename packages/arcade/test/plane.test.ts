import { describe, expect, test } from "bun:test";
import {
  alive,
  chooseAction,
  clockOf,
  createMatch,
  createRng,
  directions,
  endReason,
  isOver,
  type Match,
  type Move,
  playTick,
  RADIUS,
  scores,
  SIZE,
  SPEED,
  standings,
  STEP,
  type Turn,
} from "../src/games/plane/engine.ts";
import { type PlaneAnswers, questionsFor, stateFor } from "../src/games/plane/state.ts";

const usage = { inputTokens: 400, outputTokens: 0, totalTokens: 400, costUsd: 0.00002, costSource: "list-price" as const };

/** Answers that pick one option with certainty. */
function sure(move: Move, target: string, fire: boolean): PlaneAnswers {
  return {
    move: {
      type: "choice", choice: move,
      probabilities: { stay: 0, ...Object.fromEntries(directions.map((d) => [d.move, 0])), [move]: 1 } as Record<Move, number>,
    },
    target: { type: "choice", choice: target, probabilities: { [target]: 1 } },
    fire: { type: "boolean", probability: fire ? 1 : 0 },
  };
}
const turn = (answers: PlaneAnswers, latencyMs = 200): Turn => ({ answers, usage, latencyMs });
const fixed = (n: number) => () => n;
const quiet = () => turn(sure("stay", "nobody", false));

/** Place agents explicitly when a test needs a particular path. */
function placed(...positions: [number, number][]): Match {
  const match = createMatch(positions.map((_, i) => `m${i + 1}`));
  return {
    ...match,
    agents: match.agents.map((a, i) => {
      const [x, y] = positions[i]!;
      return { ...a, x, y, from: { x, y } };
    }),
  };
}

describe("setup and geometry", () => {
  test("agents start evenly spaced around the center with 3 hp", () => {
    const match = createMatch(["a", "b", "c", "d"]);
    const positions = [[10, 3], [17, 10], [10, 17], [3, 10]];
    for (const [i, a] of match.agents.entries()) {
      expect(a.x).toBeCloseTo(positions[i]![0]!, 10);
      expect(a.y).toBeCloseTo(positions[i]![1]!, 10);
      expect(a.from).toEqual({ x: a.x, y: a.y });
      expect(a.hp).toBe(3);
    }
    expect(match.agents.map((a) => a.id)).toEqual(["red", "blue", "green", "yellow"]);
    expect(createMatch(["a", "b", "c", "d", "e", "f"]).agents).toHaveLength(6);
    expect(() => createMatch(["solo"])).toThrow(RangeError);
    expect(() => createMatch(Array(7).fill("m"))).toThrow(RangeError);
  });

  test("clock vectors have unit length and clockOf returns the nearest direction", () => {
    expect(directions).toHaveLength(12);
    for (const d of directions) {
      expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 10);
      expect(clockOf(d.dx, d.dy)).toBe(d.clock);
      expect(clockOf(10 * d.dx, 10 * d.dy)).toBe(d.clock);
    }
    expect([clockOf(0, -1), clockOf(1, 0), clockOf(0, 1), clockOf(-1, 0)]).toEqual([12, 3, 6, 9]);
    expect([clockOf(0.1, -1), clockOf(1, -0.1), clockOf(-0.1, -1), clockOf(0, 0)]).toEqual([12, 3, 12, 12]);
  });

  test("seeded matches repeat without mutating their input", () => {
    const match = placed([2, 10], [11, 10]);
    const before = structuredClone(match);
    const turns = { red: turn(sure("3-oclock", "blue", true)) };
    expect(playTick(match, turns, "sample", createRng(42))).toEqual(playTick(match, turns, "sample", createRng(42)));
    expect(match).toEqual(before);
  });
});

describe("chooseAction()", () => {
  test("top uses the most probable answer, sample draws from the probabilities", () => {
    const answers: PlaneAnswers = {
      ...sure("stay", "blue", false),
      move: {
        type: "choice", choice: "stay",
        probabilities: { ...Object.fromEntries(directions.map((d) => [d.move, 0])), "3-oclock": 0.3, stay: 0.6, "9-oclock": 0.1 } as Record<Move, number>,
      },
      target: { type: "choice", choice: "blue", probabilities: { blue: 0.9, nobody: 0.1 } },
      fire: { type: "boolean", probability: 0.4 },
    };
    expect(chooseAction(answers, "top", fixed(0), ["blue"]).action).toEqual({ move: "stay", target: "blue", fire: false });
    expect(chooseAction(answers, "sample", fixed(0.05), ["blue"]).action).toEqual({ move: "3-oclock", target: "blue", fire: true });
    expect(chooseAction(answers, "sample", fixed(0.35), ["blue"]).action).toEqual({ move: "9-oclock", target: "blue", fire: true });
    expect(chooseAction(answers, "sample", fixed(0.95), ["blue"]).action).toEqual({ move: "stay", target: null, fire: false });
  });

  test("refusals fall back independently and are counted", () => {
    const answers: PlaneAnswers = { ...sure("3-oclock", "blue", true), fire: { type: "refusal", reason: "no" } };
    expect(chooseAction(answers, "top", fixed(0), ["blue"])).toEqual({
      action: { move: "3-oclock", target: "blue", fire: false }, refusals: 1,
    });
    const refused: PlaneAnswers = { move: { type: "refusal" }, target: { type: "refusal" }, fire: { type: "refusal" } };
    expect(chooseAction(refused, "sample", fixed(0), ["blue"])).toEqual({
      action: { move: "stay", target: null, fire: false }, refusals: 3,
    });
    const next = playTick(createMatch(["m1", "m2"]), { red: turn(refused) }, "top", fixed(0));
    expect([next.agents[0]!.refusals, next.agents[0]!.stays, next.agents[0]!.actions]).toEqual([3, 1, 1]);
    expect(next.fired).toEqual([]);
  });
});

describe("movement", () => {
  test("moves one step in each clock direction and preserves the previous position", () => {
    for (const d of directions) {
      const next = playTick(placed([10, 10], [2, 2]), { red: turn(sure(d.move, "nobody", false)) }, "top", fixed(0));
      const red = next.agents[0]!;
      expect(red.x).toBeCloseTo(10 + STEP * d.dx, 10);
      expect(red.y).toBeCloseTo(10 + STEP * d.dy, 10);
      expect(red.from).toEqual({ x: 10, y: 10 });
    }
  });

  test("clamps moves at all four walls", () => {
    const cases: [number, number, Move, number, number][] = [
      [0.8, 10, "9-oclock", RADIUS, 10],
      [19.2, 10, "3-oclock", SIZE - RADIUS, 10],
      [10, 0.8, "12-oclock", 10, RADIUS],
      [10, 19.2, "6-oclock", 10, SIZE - RADIUS],
      [0.8, 0.8, "11-oclock", RADIUS, RADIUS],
    ];
    for (const [x, y, move, expectedX, expectedY] of cases) {
      const next = playTick(placed([x, y], [10, 15]), { red: turn(sure(move, "nobody", false)) }, "top", fixed(0));
      expect(next.agents[0]!.x).toBeCloseTo(expectedX, 10);
      expect(next.agents[0]!.y).toBeCloseTo(expectedY, 10);
      expect(next.agents[0]!.blocked).toBe(0);
    }
  });

  test("blocks an overlap but allows circles to touch", () => {
    const turns = { red: turn(sure("3-oclock", "nobody", false)) };
    const blocked = playTick(placed([5, 10], [7, 10]), turns, "top", fixed(0));
    expect([blocked.agents[0]!.x, blocked.agents[0]!.blocked, blocked.agents[0]!.stays]).toEqual([5, 1, 0]);
    expect(blocked.agents[0]!.from).toEqual({ x: 5, y: 10 });
    const touching = playTick(placed([5, 10], [7.4, 10]), turns, "top", fixed(0));
    expect(touching.agents[0]!.x).toBeCloseTo(6.2, 10);
    expect(touching.agents[0]!.blocked).toBe(0);
  });

  test("resolves moves in agent order against earlier and later positions", () => {
    const turns = { red: turn(sure("3-oclock", "nobody", false)), blue: turn(sure("3-oclock", "nobody", false)) };
    const next = playTick(placed([5, 10], [7, 10]), turns, "top", fixed(0));
    expect(next.agents.map((a) => [a.x, a.blocked])).toEqual([[5, 1], [8.2, 0]]);
    const reverse = placed([5, 10], [7, 10]);
    reverse.agents.reverse();
    const other = playTick(reverse, turns, "top", fixed(0));
    expect(other.agents.map((a) => [a.id, a.x, a.blocked])).toEqual([["blue", 8.2, 0], ["red", 6.2, 0]]);
  });

  test("agents that are out do not block movement or act", () => {
    const match = placed([5, 10], [7, 10], [15, 15]);
    match.agents[1]!.hp = 0;
    match.agents[1]!.diedAt = 0;
    const next = playTick(match, { red: turn(sure("3-oclock", "nobody", false)), blue: quiet() }, "top", fixed(0));
    expect(next.agents[0]!.x).toBeCloseTo(6.2, 10);
    expect(next.agents[1]!.actions).toBe(0);
  });
});

describe("projectiles", () => {
  test("spawns after moves, then hits a stationary target 9 units away on the third advance", () => {
    let match = placed([2, 10], [11, 10]);
    match = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    expect(match.projectiles[0]).toEqual({ id: "1-red", from: "red", x: 2, y: 10, dx: SPEED, dy: 0 });
    expect(match.fired).toEqual(match.projectiles);
    expect(match.hits).toEqual([]);
    for (const x of [5, 8]) {
      match = playTick(match, {}, "top", fixed(0));
      expect(match.projectiles[0]!.x).toBe(x);
      expect(match.agents[1]!.hp).toBe(3);
      expect(match.fired).toEqual([]);
    }
    match = playTick(match, {}, "top", fixed(0));
    expect(match.tick).toBe(4);
    expect(match.agents[1]!.hp).toBe(2);
    expect(match.projectiles).toEqual([]);
    expect(match.hits).toHaveLength(1);
    expect(match.hits[0]!.to).toBe("blue");
    expect(match.hits[0]!.x).toBeCloseTo(10.2, 10);
    expect(match.agents[0]!.hits).toBe(1);
  });

  test("aims from and at positions after movement", () => {
    const next = playTick(placed([2, 10], [11, 10]), {
      red: turn(sure("6-oclock", "blue", true)), blue: turn(sure("6-oclock", "red", false)),
    }, "top", fixed(0));
    expect(next.projectiles[0]!.y).toBeCloseTo(11.2, 10);
    expect(next.projectiles[0]!.dx).toBeCloseTo(SPEED, 10);
    expect(next.projectiles[0]!.dy).toBeCloseTo(0, 10);
  });

  test("one projectile in flight suppresses fire without changing shot stats", () => {
    let match = placed([2, 10], [11, 10]);
    const turns = { red: turn(sure("stay", "blue", true)) };
    match = playTick(match, turns, "top", fixed(0));
    match = playTick(match, turns, "top", fixed(0));
    expect(match.projectiles).toHaveLength(1);
    expect(match.projectiles[0]!.id).toBe("1-red");
    expect(match.fired).toEqual([]);
    expect([match.agents[0]!.shots, match.agents[0]!.hits, match.agents[0]!.actions]).toEqual([1, 0, 2]);
    match = playTick(match, turns, "top", fixed(0));
    match = playTick(match, turns, "top", fixed(0));
    expect(match.projectiles).toHaveLength(1);
    expect(match.projectiles[0]!.id).toBe("4-red");
    expect([match.agents[0]!.shots, match.agents[0]!.hits]).toEqual([2, 1]);
  });

  test("a target can dodge and the projectile continues straight until it leaves", () => {
    let match = placed([2, 10], [11, 10]);
    match = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    match = playTick(match, { blue: turn(sure("12-oclock", "nobody", false)) }, "top", fixed(0));
    for (let i = 0; i < 6; i++) match = playTick(match, {}, "top", fixed(0));
    expect(match.projectiles).toEqual([]);
    expect(match.agents[1]!.hp).toBe(3);
    expect([match.agents[0]!.shots, match.agents[0]!.hits]).toEqual([1, 0]);
    expect(match.events[0]).toBe("red missed");
  });

  test("hits the closest agent along the segment, regardless of target or agent order", () => {
    let match = placed([2, 10], [4.8, 10], [3.5, 10]);
    match = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    match = playTick(match, {}, "top", fixed(0));
    expect(match.agents.map((a) => a.hp)).toEqual([3, 3, 2]);
    expect(match.hits[0]!.to).toBe("green");
  });

  test("checks the whole segment and ignores the shooter and agents that are out", () => {
    const match = placed([5, 10], [7, 10], [6, 10]);
    match.agents[2]!.hp = 0;
    match.agents[2]!.diedAt = 0;
    match.projectiles = [{ id: "old", from: "red", x: 5, y: 10, dx: SPEED, dy: 0 }];
    const next = playTick(match, {}, "top", fixed(0));
    expect(next.agents.map((a) => a.hp)).toEqual([3, 2, 0]);
    expect(next.hits[0]!.to).toBe("blue");
    expect(next.projectiles).toEqual([]);
  });

  test("uses the projectile radius for grazing hits and preserves the input projectile", () => {
    for (const [offset, hp] of [[0.79, 2], [0.8, 2], [0.81, 3]] as const) {
      const match = placed([2, 10], [4, 10 + offset]);
      match.projectiles = [{ id: "old", from: "red", x: 2, y: 10, dx: SPEED, dy: 0 }];
      const before = structuredClone(match);
      const next = playTick(match, {}, "top", fixed(0));
      expect(next.agents[1]!.hp).toBe(hp);
      expect(match).toEqual(before);
    }
  });

  test("counts hits from a shooter that is already out", () => {
    const match = placed([2, 10], [5, 10], [15, 15]);
    match.agents[0]!.hp = 0;
    match.agents[0]!.diedAt = 0;
    match.projectiles = [{ id: "old", from: "red", x: 2, y: 10, dx: SPEED, dy: 0 }];
    const next = playTick(match, {}, "top", fixed(0));
    expect([next.agents[0]!.hits, next.agents[1]!.hp]).toEqual([1, 2]);
  });

  test("simultaneous hits can knock both agents out and prevent new shots", () => {
    const match = placed([5, 10], [8, 10]);
    for (const a of match.agents) a.hp = 1;
    match.projectiles = [
      { id: "r", from: "red", x: 5, y: 10, dx: SPEED, dy: 0 },
      { id: "b", from: "blue", x: 8, y: 10, dx: -SPEED, dy: 0 },
    ];
    const next = playTick(match, { red: turn(sure("stay", "blue", true)), blue: turn(sure("stay", "red", true)) }, "top", fixed(0));
    expect(next.agents.map((a) => [a.hp, a.diedAt, a.hits])).toEqual([[0, 1, 1], [0, 1, 1]]);
    expect(next.fired).toEqual([]);
    expect(next.hits).toHaveLength(2);
    expect(isOver(next)).toBe(true);
  });

  test("firing at nobody, yourself or an agent that is out does nothing", () => {
    const match = placed([2, 10], [11, 10], [15, 15]);
    match.agents[2]!.hp = 0;
    match.agents[2]!.diedAt = 0;
    for (const target of ["nobody", "red", "green"]) {
      const next = playTick(match, { red: turn(sure("stay", target, true)) }, "top", fixed(0));
      expect(next.fired).toEqual([]);
      expect(next.agents[0]!.shots).toBe(0);
    }
  });

  test("events are newest first and capped at 40", () => {
    const match = placed([2, 10], [11, 10]);
    match.events = Array.from({ length: 40 }, (_, i) => `old ${i}`);
    const next = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    expect(next.events).toHaveLength(40);
    expect(next.events.slice(0, 2)).toEqual(["red fired at blue", "old 0"]);
    expect(next.events.at(-1)).toBe("old 38");
  });
});

describe("real-time turns and match endings", () => {
  test("errors count as idle actions and absent turns do nothing", () => {
    const next = playTick(createMatch(["m1", "m2", "m3"]), { red: { error: "502" }, blue: quiet() }, "top", fixed(0));
    const [red, blue, green] = next.agents;
    expect([red!.errors, red!.actions, red!.calls, red!.stays]).toEqual([1, 1, 0, 0]);
    expect([blue!.actions, blue!.calls, blue!.latencyMs, blue!.costUsd]).toEqual([1, 1, 200, 0.00002]);
    expect([green!.actions, green!.calls]).toEqual([0, 0]);
    expect(next.turnActed).toEqual(["red", "blue"]);
    expect(next.quietTurns).toBe(0);
  });

  test("folded real-time calls count their total usage and latency", () => {
    const next = playTick(createMatch(["m1", "m2"]), {
      red: { answers: sure("stay", "nobody", false), usage: { ...usage, costUsd: undefined }, latencyMs: 500, calls: 3 },
    }, "top", fixed(0));
    expect([next.agents[0]!.calls, next.agents[0]!.actions, next.agents[0]!.latencyMs, next.agents[0]!.costUsd]).toEqual([3, 1, 500, 0]);
  });

  test("quiet turns wait for all standing agents, including error turns", () => {
    let match = createMatch(["fast", "slow"], { stalemateTurns: 2 });
    for (let i = 0; i < 3; i++) match = playTick(match, { red: quiet() }, "top", fixed(0));
    expect(match.quietTurns).toBe(0);
    match = playTick(match, { blue: { error: "502" } }, "top", fixed(0));
    expect(match.quietTurns).toBe(1);
    expect(match.turnActed).toEqual([]);
    expect(isOver(match)).toBe(false);
    match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0));
    expect(endReason(match)).toBe("stalemate");
    expect(match.events[0]).toBe("stalemate: nobody fired for 2 turns");
    expect(scores(match).filter((r) => r.metric === "win").map((r) => r.value)).toEqual([0, 0]);
    expect(scores(match).filter((r) => r.metric === "stalemate").map((r) => r.value)).toEqual([1, 1]);
  });

  test("a new shot resets quiet turns, suppressed fire does not", () => {
    let match = placed([2, 10], [17, 10]);
    match = playTick(match, { red: quiet(), blue: quiet() }, "top", fixed(0));
    expect(match.quietTurns).toBe(1);
    match = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    expect(match.turnShots).toBe(1);
    match = playTick(match, { blue: quiet() }, "top", fixed(0));
    expect(match.quietTurns).toBe(0);
    match = playTick(match, { red: turn(sure("stay", "blue", true)), blue: quiet() }, "top", fixed(0));
    expect(match.quietTurns).toBe(1);
    expect(match.turnShots).toBe(0);
  });

  test("ends with the last standing agent and records its knockout tick", () => {
    let match = placed([2, 10], [5, 10]);
    match.agents[1]!.hp = 1;
    match = playTick(match, { red: turn(sure("stay", "blue", true)) }, "top", fixed(0));
    match = playTick(match, {}, "top", fixed(0));
    expect(endReason(match)).toBe("last-standing");
    expect(alive(match).map((a) => a.id)).toEqual(["red"]);
    expect(match.agents[1]!.diedAt).toBe(2);
  });

  test("ends at maxTicks even without turns", () => {
    let match = createMatch(["m1", "m2"], { maxTicks: 2 });
    match = playTick(match, {}, "top", fixed(0));
    expect(endReason(match)).toBeNull();
    match = playTick(match, {}, "top", fixed(0));
    expect(endReason(match)).toBe("time");
    expect(isOver(match)).toBe(true);
  });
});

describe("standings and scores", () => {
  test("ranks by standing, then later knockout, then hp, then hits", () => {
    const match = createMatch(["m1", "m2", "m3", "m4"]);
    Object.assign(match.agents[0]!, { hp: 0, diedAt: 5 });
    Object.assign(match.agents[1]!, { hp: 0, diedAt: 9 });
    Object.assign(match.agents[2]!, { hp: 1, hits: 2 });
    Object.assign(match.agents[3]!, { hp: 1, hits: 4 });
    expect(standings(match).map((a) => a.id)).toEqual(["yellow", "green", "blue", "red"]);
    Object.assign(match.agents[2]!, { hp: 2 });
    expect(standings(match)[0]!.id).toBe("green");
  });

  test("scores include arena metrics, accuracy for shooters and blocked moves", () => {
    const match = { ...createMatch(["m1", "m2"]), tick: 100 };
    Object.assign(match.agents[0]!, { shots: 4, hits: 2, actions: 5, stays: 2, blocked: 1, calls: 3, latencyMs: 600, costUsd: 0.1 });
    const rows = scores(match);
    const red = Object.fromEntries(rows.filter((r) => r.model === "m1").map((r) => [r.metric, r.value]));
    expect(red).toEqual({
      win: 1, placement: 1, stalemate: 0, stay_rate: 0.4, survived_ticks: 100, hits: 2, shots: 4,
      actions: 5, refusals: 0, errors: 0, latency_ms: 200, cost_usd: 0.1, accuracy: 0.5, blocked: 1,
    });
    expect(rows.filter((r) => r.model === "m2" && r.metric === "accuracy")).toEqual([]);
    expect(rows.find((r) => r.model === "m2" && r.metric === "latency_ms")!.value).toBe(0);
    const tie = scores({ ...createMatch(["same", "same"]), tick: 100 });
    expect(tie.filter((r) => r.metric === "win").map((r) => r.value)).toEqual([0, 0]);
    match.agents[1]!.hp = 0;
    match.agents[1]!.diedAt = 8;
    expect(scores(match).find((r) => r.model === "m2" && r.metric === "survived_ticks")!.value).toBe(8);
  });
});

describe("state for the model", () => {
  test("lists enemy distance, clock direction, travel time, nearby walls and projectile status", () => {
    const match = placed([2, 10], [11, 10], [15, 15]);
    match.agents[2]!.hp = 0;
    match.agents[2]!.diedAt = 0;
    match.projectiles = [{ id: "r", from: "red", x: 3, y: 10, dx: SPEED, dy: 0 }];
    const state = stateFor(match, match.agents[0]!);
    expect(state.you).toEqual({ id: "red", x: 2, y: 10, hp: 3, projectileInFlight: true, walls: { left: 1.4 } });
    expect(state.others).toEqual([{ id: "blue", hp: 3, distance: 9, direction: 3, projectileTicks: 3 }]);
    expect([state.turn, state.maxTurns, state.quietTurns, state.drawAfterQuietTurns]).toEqual([1, 100, 0, 10]);
    const questions = questionsFor(match, match.agents[0]!);
    expect(Object.keys(questions.target.options)).toEqual(["blue", "nobody"]);
    expect(Object.keys(questions.move.options)).toHaveLength(13);
    expect(questions.move.options["3-oclock"]).toBe("move toward 3 o'clock (right)");
    expect(questions.move.options["12-oclock"]).toBe("move toward 12 o'clock (up)");
    expect(questions.fire.type).toBe("boolean");
  });

  test("lists incoming projectiles with their direction and closest approach time", () => {
    const match = placed([10, 10], [15, 15]);
    match.projectiles = [
      { id: "incoming", from: "blue", x: 16, y: 10, dx: -SPEED, dy: 0 },
      { id: "near", from: "blue", x: 10, y: 1.5, dx: 0, dy: SPEED },
      { id: "far", from: "blue", x: 16, y: 12, dx: -SPEED, dy: 0 },
      { id: "later", from: "blue", x: 10, y: 20, dx: 0, dy: -SPEED },
      { id: "away", from: "blue", x: 16, y: 10, dx: SPEED, dy: 0 },
      { id: "own", from: "red", x: 16, y: 10, dx: -SPEED, dy: 0 },
    ];
    expect(stateFor(match, match.agents[0]!).incoming).toEqual([
      { from: "blue", direction: 3, ticksUntilClosest: 2 },
      { from: "blue", direction: 12, ticksUntilClosest: 2.8 },
      { from: "blue", direction: 6, ticksUntilClosest: 3 },
    ]);
  });

  test("rounds geometry to one decimal and includes each nearby wall", () => {
    const match = placed([1.234, 18.876], [8, 10]);
    const state = stateFor(match, match.agents[0]!) as { you: { x: number; y: number; walls: object } };
    expect([state.you.x, state.you.y]).toEqual([1.2, 18.9]);
    expect(state.you.walls).toEqual({ left: 0.6, bottom: 0.5 });
    match.agents[0]!.x = 18.5;
    match.agents[0]!.y = 2;
    expect((stateFor(match, match.agents[0]!).you as { walls: object }).walls).toEqual({ right: 0.9, top: 1.4 });
  });
});
