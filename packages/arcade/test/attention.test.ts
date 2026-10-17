import { describe, expect, test } from "bun:test";
import { ImagePart, type Usage } from "@system-one/ai";
import {
  applyTurn,
  cellProbabilities,
  cellView,
  createGame,
  currentView,
  depthOf,
  earlierViews,
  history,
  isOver,
  type Judge,
  liveView,
  MAX_ROUNDS,
  movesFor,
  parseCell,
  playLive,
  playRound,
  scores,
  type Turn,
  viewOf,
  zoomInto,
} from "../src/games/attention/engine.ts";
import { type AttentionAnswers, questionsFor, stateFor } from "../src/games/attention/state.ts";
import { fullView } from "../src/web/lib/media.ts";

const usage: Usage = { inputTokens: 2000, outputTokens: 0, totalTokens: 2000, costUsd: 0.0001, costSource: "list-price" };

function answers({ cell = { E5: 0.8, A1: 0.2 }, move = "deeper", interest = 2 }: { cell?: Record<string, number>; move?: string; interest?: number } = {}): AttentionAnswers {
  const top = Object.entries(cell).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    cell: { type: "choice", choice: top, probabilities: cell },
    move: { type: "choice", choice: move, probabilities: { [move]: 0.9 } },
    interest: { type: "score", score: interest, level: "interesting", probabilities: [0, 0, 1, 0] },
  };
}
const turn = (a: AttentionAnswers = answers()): Turn => ({ answers: a, usage, latencyMs: 300 });
const grid = new ImagePart("image/jpeg", "AAAA");
const overview = new ImagePart("image/jpeg", "BBBB");
const judge = (): Judge => createGame(["typesafe:jev-latest"], "still").judges[0]!;
const close = (actual: { x: number; y: number; size: number }, expected: { x: number; y: number; size: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.size).toBeCloseTo(expected.size, 9);
};

describe("cells and views", () => {
  test("parseCell reads column then row", () => {
    expect(parseCell("A1")).toEqual([0, 0]);
    expect(parseCell("I9")).toEqual([8, 8]);
    expect(parseCell("C4")).toEqual([2, 3]);
    expect(parseCell("J1")).toBeNull();
    expect(parseCell("A10")).toBeNull();
    expect(parseCell("A0")).toBeNull();
  });

  test("cellView is one ninth of the view", () => {
    close(cellView(fullView, "E5"), { x: 4 / 9, y: 4 / 9, size: 1 / 9 });
  });

  test("zoomInto keeps the 3x3 cells around the cell", () => {
    close(zoomInto(fullView, "E5"), { x: 1 / 3, y: 1 / 3, size: 1 / 3 });
    close(zoomInto(fullView, "B2"), { x: 0, y: 0, size: 1 / 3 });
  });

  test("zoomInto moves the view back inside the picture at the edges", () => {
    close(zoomInto(fullView, "A1"), { x: 0, y: 0, size: 1 / 3 });
    close(zoomInto(fullView, "I9"), { x: 2 / 3, y: 2 / 3, size: 1 / 3 });
  });

  test("viewOf follows the trail", () => {
    close(viewOf([]), fullView);
    close(viewOf(["E5", "E5"]), { x: 4 / 9, y: 4 / 9, size: 1 / 9 });
  });
});

describe("movesFor", () => {
  test("no step back at the top", () => {
    expect(movesFor(judge(), 1024, "still")).toEqual(["deeper", "stop"]);
    expect(movesFor(judge(), 1024, "live")).toEqual(["deeper", "stay"]);
  });

  test("no deeper when the next view would be under 64 px", () => {
    const one = { ...judge(), trail: ["E5"] };
    const two = { ...judge(), trail: ["E5", "E5"] };
    // 720 px webcam: 720, 240, 80, then 27 is too small.
    expect(movesFor(one, 720, "still")).toEqual(["deeper", "out", "stop"]);
    expect(movesFor(two, 720, "still")).toEqual(["out", "stop"]);
    // 1024 px image: 1024, 341, 114, then 38 is too small.
    expect(movesFor(two, 1024, "still")).toEqual(["out", "stop"]);
  });
});

describe("cellProbabilities", () => {
  test("missing cells count as 0, and the list follows the cells", () => {
    const p = cellProbabilities({ type: "choice", choice: "A1", probabilities: { A1: 0.6, I9: 0.4 } })!;
    expect(p).toHaveLength(81);
    expect(p[0]).toBe(0.6);
    expect(p[80]).toBe(0.4);
    expect(p.filter((x) => x === 0)).toHaveLength(79);
  });

  test("a refusal has no probabilities", () => {
    expect(cellProbabilities({ type: "refusal" })).toBeNull();
  });
});

describe("applyTurn", () => {
  test("deeper zooms in around the top cell", () => {
    const j = applyTurn(judge(), turn(), 1024, "still");
    expect(j.trail).toEqual(["E5"]);
    expect(j.focus).toBe("E5");
    expect(j.heat?.view).toEqual(fullView);
    expect(j.steps).toEqual([{ at: "", depth: 0, focus: "E5", move: "deeper", interest: 2, reaction: "interesting", topProbability: 0.8 }]);
    expect(j.calls).toBe(1);
    expect(j.latencyMs).toBe(300);
    expect(j.costUsd).toBe(0.0001);
  });

  test("an off-list choice falls back to the most probable real cell", () => {
    const a = answers({ cell: { Z9: 0.7, B2: 0.3 } });
    expect(a.cell.type === "choice" && a.cell.choice).toBe("Z9");
    expect(applyTurn(judge(), turn(a), 1024, "still").focus).toBe("B2");
  });

  test("a move that is not allowed falls back to the most probable allowed move", () => {
    const a = answers();
    a.move = { type: "choice", choice: "out", probabilities: { out: 0.6, stop: 0.3, deeper: 0.1 } };
    const j = applyTurn(judge(), turn(a), 1024, "still");
    expect(j.steps[0]!.move).toBe("stop");
    expect(j.done).toBe(true);
  });

  test("out steps back, and stop ends the judge", () => {
    let j = applyTurn(judge(), turn(), 1024, "still");
    j = applyTurn(j, turn(answers({ move: "out" })), 1024, "still");
    expect(j.trail).toEqual([]);
    expect(j.done).toBe(false);
    j = applyTurn(j, turn(answers({ move: "stop" })), 1024, "still");
    expect(j.done).toBe(true);
  });

  test("refusals keep the focus and the view", () => {
    const first = applyTurn(judge(), turn(), 1024, "still");
    const a = answers();
    a.cell = { type: "refusal" };
    a.move = { type: "refusal", reason: "no" };
    a.interest = { type: "refusal" };
    const j = applyTurn(first, turn(a), 1024, "still");
    expect(j.focus).toBe("E5");
    expect(j.trail).toEqual(["E5"]);
    expect(j.refusals).toBe(3);
    expect(j.steps.at(-1)).toEqual({ at: "E5", depth: 1, focus: "E5", move: "stay", interest: null, reaction: null, topProbability: null });
  });

  test("3 errors in a row stop the judge, and an answer resets the count", () => {
    let j = applyTurn(judge(), { error: "boom" }, 1024, "live");
    j = applyTurn(j, { error: "boom" }, 1024, "live");
    j = applyTurn(j, turn(answers({ move: "stay" })), 1024, "live");
    expect(j.errorsInARow).toBe(0);
    for (let i = 0; i < 3; i++) j = applyTurn(j, { error: "boom" }, 1024, "live");
    expect(j.done).toBe(true);
    expect(j.errors).toBe(5);
  });
});

describe("game", () => {
  test("playRound moves every active judge and counts the round", () => {
    let g = createGame(["a", "b"], "still");
    g = playRound(g, { red: turn(answers({ move: "stop" })), blue: turn() }, 1024);
    expect(g.round).toBe(1);
    expect(g.judges.map((j) => j.done)).toEqual([true, false]);
    // A judge that stopped does not move again.
    g = playRound(g, { red: turn(), blue: turn(answers({ move: "stop" })) }, 1024);
    expect(g.judges[0]!.steps).toHaveLength(1);
    expect(isOver(g)).toBe(true);
  });

  test("still mode ends after MAX_ROUNDS, live mode does not", () => {
    expect(isOver({ ...createGame(["a"], "still"), round: MAX_ROUNDS })).toBe(true);
    expect(isOver({ ...createGame(["a"], "live"), round: MAX_ROUNDS })).toBe(false);
  });

  test("playLive moves one judge", () => {
    const g = playLive(createGame(["a", "b"], "live"), "blue", turn(), 720);
    expect(g.judges.map((j) => [j.zoom, j.focus])).toEqual([
      [0, null],
      [1, "E5"],
    ]);
  });

  test("history shows the last 5 turns, numbered", () => {
    let j = judge();
    for (let i = 0; i < 7; i++) j = applyTurn(j, turn(answers({ move: i % 2 === 0 ? "deeper" : "out" })), 1024, "still");
    const lines = history(j);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("turn 3: looked at the whole picture, focus E5, chose deeper, found it interesting");
    expect(lines[1]).toBe("turn 4: looked at E5, focus E5, chose out, found it interesting");
  });

  test("earlierViews lists the other views once", () => {
    let j = applyTurn(judge(), turn(), 1024, "still");
    j = applyTurn(j, turn(answers({ move: "out" })), 1024, "still");
    j = applyTurn(j, turn(answers({ cell: { A1: 1 } })), 1024, "still");
    // Now at A1. Earlier: the whole picture and E5.
    expect(earlierViews(j)).toEqual([fullView, zoomInto(fullView, "E5")]);
  });

  test("scores sum up each judge", () => {
    let g = createGame(["typesafe:jev-latest"], "still");
    g = playRound(g, { red: turn() }, 1024);
    g = playRound(g, { red: turn(answers({ move: "out", interest: 1 })) }, 1024);
    g = playRound(g, { red: turn(answers({ move: "stop", interest: 3 })) }, 1024);
    const byMetric = Object.fromEntries(scores(g).map((s) => [s.metric, Number(s.value.toFixed(9))]));
    expect(byMetric).toEqual({
      rounds: 3,
      max_depth: 1,
      mean_depth: 0.333333333,
      step_backs: 1,
      stopped: 1,
      mean_interest: 2,
      decisiveness: 0.8,
      regions: 2,
      latency_ms: 300,
      cost_usd: 0.0003,
      errors: 0,
      refusals: 0,
      // The helper always answers the level "interesting".
      reaction_boring: 0,
      reaction_mild: 0,
      reaction_interesting: 1,
      reaction_fascinating: 0,
    });
  });
});

describe("state", () => {

  test("questions offer 81 cells and only the allowed moves", () => {
    const qs = questionsFor(judge(), "still", 1024);
    expect(Object.keys(qs.cell.options)).toHaveLength(81);
    expect(Object.keys(qs.move.options)).toEqual(["deeper", "stop"]);
    expect(qs.interest.levels).toEqual(["boring", "mild", "interesting", "fascinating"]);
  });

  test("the overview comes second and is described only when it is sent", () => {
    const g = createGame(["a"], "still");
    const top = stateFor(g, g.judges[0]!, { grid });
    expect(top).toHaveLength(2);
    expect(JSON.stringify(top[0])).not.toContain("Image 2");
    const deep = stateFor(g, { ...g.judges[0]!, trail: ["E5"] }, { grid, second: overview });
    expect(deep[1]).toBe(grid);
    expect(deep[2]).toBe(overview);
    expect(JSON.stringify(deep[0])).toContain("zoomed in 3x (level 1), at E5");
  });
});

describe("live mode: the grid always covers the whole frame", () => {
  const live = () => createGame(["typesafe:jev-latest"], "live").judges[0]!;

  test("liveView centers a 3x or 9x view on a cell of the whole frame", () => {
    close(liveView("E5", 0), fullView);
    close(liveView("E5", 1), { x: 1 / 3, y: 1 / 3, size: 1 / 3 });
    close(liveView("E5", 2), { x: 4 / 9, y: 4 / 9, size: 1 / 9 });
    close(liveView("A1", 1), { x: 0, y: 0, size: 1 / 3 });
  });

  test("zoomed in, the judge can still look anywhere, and the view follows", () => {
    let j = applyTurn(live(), turn(answers({ cell: { B2: 0.9 }, move: "deeper" })), 720, "live");
    expect(j.zoom).toBe(1);
    expect(j.trail).toEqual([]);
    close(currentView(j, "live"), { x: 0, y: 0, size: 1 / 3 });
    // Something moved to the other corner: the next answer picks it on the whole frame, at the same zoom.
    j = applyTurn(j, turn(answers({ cell: { H8: 0.9 }, move: "stay" })), 720, "live");
    expect(j.focus).toBe("H8");
    expect(j.zoom).toBe(1);
    close(currentView(j, "live"), { x: 2 / 3, y: 2 / 3, size: 1 / 3 });
    // The heat always belongs to the whole frame.
    expect(j.heat?.view).toEqual(fullView);
  });

  test("moves depend on the zoom: no out at 1x, no deeper below 64 px", () => {
    expect(movesFor(live(), 720, "live")).toEqual(["deeper", "stay"]);
    expect(movesFor({ ...live(), zoom: 1, focus: "E5" }, 720, "live")).toEqual(["deeper", "out", "stay"]);
    // 720 px: 720, 240, 80, then 27 is too small.
    expect(movesFor({ ...live(), zoom: 2, focus: "E5" }, 720, "live")).toEqual(["out", "stay"]);
    expect(depthOf({ ...live(), zoom: 2 }, "live")).toBe(2);
  });

  test("memory and regions read the focus and the zoom", () => {
    let j = applyTurn(live(), turn(answers({ cell: { B2: 0.9 }, move: "deeper" })), 720, "live");
    j = applyTurn(j, turn(answers({ cell: { H8: 0.9 }, move: "stay" })), 720, "live");
    expect(history(j)[1]).toBe("turn 2: looked at B2 at 3x, focus H8, chose stay, found it interesting");
    const g = { ...createGame(["m"], "live"), judges: [j] };
    const byMetric = Object.fromEntries(scores(g).map((s) => [s.metric, s.value]));
    expect(byMetric.regions).toBe(2);
    expect(byMetric.max_depth).toBe(1);
  });

  test("the state says image 1 is the whole frame and image 2 the zoomed view, and names no cell", () => {
    const g = createGame(["a"], "live");
    let zoomed = applyTurn(g.judges[0]!, turn(answers({ cell: { C6: 0.9 }, move: "deeper" })), 720, "live");
    zoomed = applyTurn(zoomed, turn(answers({ cell: { C6: 0.9 }, move: "stay" })), 720, "live");
    const state = stateFor(g, zoomed, { grid, second: overview });
    const text = JSON.stringify(state[0]);
    expect(text).toContain("Image 1 is the whole camera frame");
    expect(text).toContain("Image 2 is your current view, zoomed in 3x.");
    // A named cell pulls the next answer to it, so live mode has no cell names and no memory.
    expect(text).not.toContain("C6");
    expect(text).not.toContain("yourLastTurns");
    expect(questionsFor(zoomed, "live", 720).cell.instructions).toContain("whole frame");
  });
});
