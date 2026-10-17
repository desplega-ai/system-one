// Attention rules. Pure, so it runs in tests. Each judge explores on its own path, with one of two mechanics:
// - Pictures ("still"): sub-squares. The grid covers the judge's view. "deeper" zooms 3x into the cell,
//   so the next grid splits that part again. "out" goes back up, "stop" ends.
// - Live webcam: the grid always covers the whole frame, so the judge sees the bigger picture every turn
//   and can look anywhere, also when zoomed. "deeper" and "out" change the zoom around the chosen cell.
//   Seen on 2026-10-16: with sub-squares on a live camera, a zoomed judge saw only its view and kept
//   saying "stay" (GPT-6 Luna 50 times in a row), while things moved outside it.
import type { ChoiceAnswer, RefusalAnswer, Usage } from "@system-one/ai";
import { cells, columns, fullView, GRID, type View } from "../../web/lib/media.ts";
import { agentColors } from "../../web/ui/colors.ts";
import type { AttentionAnswers } from "./state.ts";

/** Still mode ends after this many rounds. */
export const MAX_ROUNDS = 12;
/** How many earlier turns each judge sees. */
export const HISTORY_TURNS = 5;
/** No "deeper" when the next view would be smaller than this, in source pixels. */
export const MIN_VIEW_PX = 64;
/** A judge that fails this many calls in a row stops, so a fast error cannot repeat forever. */
export const MAX_ERRORS_IN_A_ROW = 3;
/** One zoom step keeps 3 of the 9 cells across: a 3x zoom. */
const ZOOM_CELLS = 3;

export type Mode = "still" | "live";
export type Move = "deeper" | "out" | "stop" | "stay";
export const interestLevels = ["boring", "mild", "interesting", "fascinating"] as const;
export type InterestLevel = (typeof interestLevels)[number];
/** One emoji per interest level, for the cards, the picture and the ranking. Four shapes, not four round faces,
 * so they stay apart at 20 px. */
export const reactions: Record<InterestLevel, string> = { boring: "😴", mild: "🤔", interesting: "👀", fascinating: "🤯" };
/** Each level's own tint, for the pills behind the emoji. None of them is an agent color. */
export const reactionTints: Record<InterestLevel, string> = { boring: "#8b929c", mild: "#38bdf8", interesting: "#f59e0b", fascinating: "#ec4899" };

/** One answered turn, as the judge sees it again in its memory. */
export type Step = {
  /** Where the judge looked when it answered, as text for its memory: "C4 > E5", or "C4 at 3x". */
  at: string;
  /** The zoom level when it answered: 0 is the whole picture. */
  depth: number;
  focus: string | null;
  move: Move;
  /** 0 (boring) to 3 (fascinating), probability-weighted. Null when refused. */
  interest: number | null;
  /** The level the judge picked (its top answer): the reaction the page shows. Null when refused. */
  reaction: InterestLevel | null;
  /** The probability of the top cell: how sure the judge was. */
  topProbability: number | null;
};

export type Judge = {
  id: string;
  model: string;
  /** Still mode: the cells that led to the current view. */
  trail: string[];
  /** Live mode: the zoom level around the focus, 0 for the whole frame. */
  zoom: number;
  focus: string | null;
  /** The last cell probabilities, one per cell in `cells` order, and the view the grid covered. */
  heat: { view: View; probabilities: number[] } | null;
  lastAnswers: AttentionAnswers | null;
  done: boolean;
  steps: Step[];
  calls: number;
  errors: number;
  errorsInARow: number;
  refusals: number;
  latencyMs: number;
  costUsd: number;
};

export type Game = { mode: Mode; round: number; judges: Judge[] };

/** One judge's input: the answers, or why there are none. */
export type Turn = { answers: AttentionAnswers; usage: Usage; latencyMs: number } | { error: string };

const judgeIds = Object.keys(agentColors);

export function createGame(models: readonly string[], mode: Mode): Game {
  if (models.length < 1 || models.length > 3) throw new RangeError("the attention game takes 1 to 3 judges");
  const judges = models.map(
    (model, i): Judge => ({
      id: judgeIds[i]!,
      model,
      trail: [],
      zoom: 0,
      focus: null,
      heat: null,
      lastAnswers: null,
      done: false,
      steps: [],
      calls: 0,
      errors: 0,
      errorsInARow: 0,
      refusals: 0,
      latencyMs: 0,
      costUsd: 0,
    }),
  );
  return { mode, round: 0, judges };
}

/** "C4" to [column, row], both from 0. Null for anything that is not a cell. */
export function parseCell(name: string): [number, number] | null {
  const col = columns.indexOf(name.slice(0, 1));
  const row = Number(name.slice(1)) - 1;
  return col >= 0 && Number.isInteger(row) && row >= 0 && row < GRID ? [col, row] : null;
}

/** The part of the picture that one cell of the view covers. */
export function cellView(view: View, cell: string): View {
  const [col, row] = parseCell(cell) ?? [0, 0];
  const size = view.size / GRID;
  return { x: view.x + col * size, y: view.y + row * size, size };
}

/** A square of `size` centered on the cell, moved back inside the picture at the edges. */
function around(view: View, cell: string, size: number): View {
  const target = cellView(view, cell);
  const clamp = (v: number) => Math.min(1 - size, Math.max(0, v));
  return { x: clamp(target.x + target.size / 2 - size / 2), y: clamp(target.y + target.size / 2 - size / 2), size };
}

/** Still mode, "deeper": the 3x3 cells around the cell. */
export const zoomInto = (view: View, cell: string): View => around(view, cell, (view.size * ZOOM_CELLS) / GRID);

export const viewOf = (trail: readonly string[]): View => trail.reduce(zoomInto, fullView);

/** Live mode: the view at a zoom level, centered on a cell of the whole frame. */
export function liveView(focus: string | null, zoom: number): View {
  return zoom === 0 || focus === null ? fullView : around(fullView, focus, (ZOOM_CELLS / GRID) ** zoom);
}

/** What the judge looks at now. */
export const currentView = (judge: Judge, mode: Mode): View => (mode === "still" ? viewOf(judge.trail) : liveView(judge.focus, judge.zoom));
/** The zoom level now: 0 is the whole picture. */
export const depthOf = (judge: Judge, mode: Mode): number => (mode === "still" ? judge.trail.length : judge.zoom);
/** The grid covers the view in still mode, and always the whole frame in live mode. */
export const gridView = (judge: Judge, mode: Mode): View => (mode === "still" ? viewOf(judge.trail) : fullView);

/** Still mode: the views this judge looked at before, without the current one. */
export function earlierViews(judge: Judge): View[] {
  const current = judge.trail.join(" > ");
  const seen = new Set(judge.steps.map((s) => s.at).filter((at) => at !== current && at !== ""));
  const views = [...seen].map((at) => viewOf(at.split(" > ")));
  return judge.steps.some((s) => s.at === "") && current !== "" ? [fullView, ...views] : views;
}

/** The moves a judge can make now. `sourcePx` is the side of the square picture in pixels. */
export function movesFor(judge: Judge, sourcePx: number, mode: Mode): Move[] {
  const nextSize = (currentView(judge, mode).size * ZOOM_CELLS) / GRID;
  const moves: Move[] = [];
  if (nextSize * sourcePx >= MIN_VIEW_PX) moves.push("deeper");
  if (depthOf(judge, mode) > 0) moves.push("out");
  moves.push(mode === "still" ? "stop" : "stay");
  return moves;
}

/** One probability per cell in `cells` order. Missing cells count as 0. Null for a refusal. */
export function cellProbabilities(answer: ChoiceAnswer<string> | RefusalAnswer): number[] | null {
  if (answer.type === "refusal") return null;
  return cells.map((cell) => answer.probabilities[cell] ?? 0);
}

/** The most probable option from `allowed`, so an answer outside the list cannot break the game. */
function topOf<K extends string>(probabilities: Readonly<Record<string, number>>, allowed: readonly K[]): K | null {
  let best: K | null = null;
  for (const option of allowed) if ((probabilities[option] ?? 0) > (best === null ? 0 : (probabilities[best] ?? 0))) best = option;
  return best;
}

const where = (judge: Judge, mode: Mode) => {
  if (mode === "still") return judge.trail.join(" > ");
  return judge.zoom === 0 ? "the whole frame" : `${judge.focus} at ${3 ** judge.zoom}x`;
};

/**
 * Applies one turn to a judge. A refused cell keeps the focus, and a refused move keeps the view.
 * `sourcePx` must be the value the call was built with, so the allowed moves match the question.
 */
export function applyTurn(judge: Judge, turn: Turn, sourcePx: number, mode: Mode): Judge {
  if ("error" in turn) {
    const errorsInARow = judge.errorsInARow + 1;
    return { ...judge, errors: judge.errors + 1, errorsInARow, done: judge.done || errorsInARow >= MAX_ERRORS_IN_A_ROW };
  }
  const { cell, move, interest } = turn.answers;
  const allowed = movesFor(judge, sourcePx, mode);
  let refusals = 0;

  let { focus, heat } = judge;
  let topProbability: number | null = null;
  const probabilities = cellProbabilities(cell);
  if (probabilities === null) refusals++;
  else {
    // The top cell from the probabilities, not `choice`, which a model can return off the list.
    const best = probabilities.indexOf(Math.max(...probabilities));
    if (probabilities[best]! > 0) {
      focus = cells[best]!;
      topProbability = probabilities[best]!;
    }
    heat = { view: gridView(judge, mode), probabilities };
  }

  let chosen: Move = "stay";
  if (move.type === "refusal") refusals++;
  else chosen = (allowed.includes(move.choice as Move) ? (move.choice as Move) : topOf(move.probabilities, allowed)) ?? "stay";
  if (chosen === "deeper" && focus === null) chosen = "stay";

  if (interest.type === "refusal") refusals++;

  const step: Step = {
    at: where(judge, mode),
    depth: depthOf(judge, mode),
    focus,
    move: chosen,
    interest: interest.type === "refusal" ? null : interest.score,
    reaction: interest.type === "refusal" ? null : (interest.level as InterestLevel),
    topProbability,
  };
  const next = { ...judge, focus };
  if (mode === "still") next.trail = chosen === "deeper" ? [...judge.trail, focus!] : chosen === "out" ? judge.trail.slice(0, -1) : judge.trail;
  else next.zoom = judge.zoom + (chosen === "deeper" ? 1 : chosen === "out" ? -1 : 0);
  return {
    ...next,
    heat,
    lastAnswers: turn.answers,
    done: chosen === "stop",
    steps: [...judge.steps, step],
    calls: judge.calls + 1,
    errorsInARow: 0,
    refusals: judge.refusals + refusals,
    latencyMs: judge.latencyMs + turn.latencyMs,
    costUsd: judge.costUsd + (turn.usage.costUsd ?? 0),
  };
}

/** Still mode: every judge with a turn moves, then the round ends. */
export function playRound(game: Game, turns: Readonly<Record<string, Turn>>, sourcePx: number): Game {
  const judges = game.judges.map((j) => {
    const turn = turns[j.id];
    return turn && !j.done ? applyTurn(j, turn, sourcePx, game.mode) : j;
  });
  return { ...game, round: game.round + 1, judges };
}

/** Live mode: one judge's answer lands. */
export function playLive(game: Game, judgeId: string, turn: Turn, sourcePx: number): Game {
  return { ...game, judges: game.judges.map((j) => (j.id === judgeId && !j.done ? applyTurn(j, turn, sourcePx, game.mode) : j)) };
}

/** Still mode ends when every judge stopped or after MAX_ROUNDS. Live mode also ends on its clock. */
export function isOver(game: Game): boolean {
  return game.judges.every((j) => j.done) || (game.mode === "still" && game.round >= MAX_ROUNDS);
}

const levelName = (score: number) => interestLevels[Math.round(score)] ?? "unknown";

/** The judge's memory: one line per turn, oldest first. */
export function history(judge: Judge, turns = HISTORY_TURNS): string[] {
  const first = judge.steps.length - turns;
  return judge.steps.slice(-turns).map((s, i) => {
    const interest = s.interest === null ? "" : `, found it ${levelName(s.interest)}`;
    return `turn ${Math.max(0, first) + i + 1}: looked at ${s.at || "the whole picture"}, focus ${s.focus ?? "none"}, chose ${s.move}${interest}`;
  });
}

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** One row per judge and metric, for POST /api/runs/:id/scores. */
export function scores(game: Game): { model: string; metric: string; value: number }[] {
  return game.judges.flatMap((j) => {
    const depths = j.steps.map((s) => s.depth);
    const interests = j.steps.flatMap((s) => (s.interest === null ? [] : [s.interest]));
    const tops = j.steps.flatMap((s) => (s.topProbability === null ? [] : [s.topProbability]));
    return Object.entries({
      rounds: j.steps.length,
      max_depth: Math.max(0, depthOf(j, game.mode), ...depths),
      mean_depth: mean(depths),
      step_backs: j.steps.filter((s) => s.move === "out").length,
      stopped: j.steps.at(-1)?.move === "stop" ? 1 : 0,
      mean_interest: mean(interests),
      decisiveness: mean(tops),
      // Still: distinct views. Live: distinct focus cells, so how much it looked around.
      regions: new Set(j.steps.map((s) => (game.mode === "still" ? s.at : s.focus))).size,
      latency_ms: j.calls > 0 ? j.latencyMs / j.calls : 0,
      cost_usd: j.costUsd,
      errors: j.errors,
      refusals: j.refusals,
      // The share of looks with each reaction, so sessions of any length compare.
      ...Object.fromEntries(
        interestLevels.map((level) => [`reaction_${level}`, j.steps.length > 0 ? j.steps.filter((s) => s.reaction === level).length / j.steps.length : 0]),
      ),
    }).map(([metric, value]) => ({ model: j.model, metric, value }));
  });
}
