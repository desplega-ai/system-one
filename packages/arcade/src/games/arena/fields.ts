// The two fields the arena page can play on: the ring (arena engine) and the plane (plane engine).
// The page talks to a Field only, so both share the setup, the loops, the cards and the board.
import type { Answer, JsonObject, Questions, Usage } from "@system-one/ai";
import * as plane from "../plane/engine.ts";
import { drawPlane, emptyShown as emptyPlaneView, glide as glidePlane, type Shown as PlaneView } from "../plane/render.ts";
import { questionsFor as planeQuestions, stateFor as planeState } from "../plane/state.ts";
import * as ring from "./engine.ts";
import { drawArena, emptyShown as emptyRingView, glide as glideRing, type Shown as RingView } from "./render.ts";
import { questionsFor as ringQuestions, stateFor as ringState } from "./state.ts";

/** What the page reads from an agent on either field. */
export type FieldAgent = {
  id: string;
  model: string;
  hp: number;
  lastAnswers: { move: Answer; target: Answer; fire: Answer } | null;
  calls: number;
  errors: number;
  refusals: number;
  shots: number;
  hits: number;
  latencyMs: number;
  costUsd: number;
};

export type FieldMatch = { tick: number; maxTicks: number; quietTurns: number; stalemateTurns: number; agents: FieldAgent[]; events: string[] };
export type FieldTurn = { answers: unknown; usage: Usage; latencyMs: number; calls?: number } | { error: string };
export type FieldId = "ring" | "plane";

// Methods, not function properties: each field takes its own Match type, and method parameters are checked bivariantly.
export interface Field {
  id: FieldId;
  name: string;
  /** The game name for runs and scores, per clock: "arena-lockstep", "plane-realtime". */
  game: string;
  /** Real-time: the engine ticks this often. Projectiles on the plane need slower ticks to be dodgeable. */
  realtimeTickMs: number;
  createMatch(models: readonly string[], options: { maxTicks?: number; stalemateTurns?: number }): FieldMatch;
  playTick(match: FieldMatch, turns: Readonly<Record<string, FieldTurn>>, policy: ring.Policy, rng: ring.Rng): FieldMatch;
  alive(match: FieldMatch): FieldAgent[];
  isOver(match: FieldMatch): boolean;
  endReason(match: FieldMatch): ring.EndReason | null;
  standings(match: FieldMatch): FieldAgent[];
  scores(match: FieldMatch): { model: string; metric: string; value: number }[];
  state(match: FieldMatch, agent: FieldAgent): JsonObject;
  questions(match: FieldMatch, agent: FieldAgent): Questions;
  /** A fresh animation state for a new match. */
  view(): unknown;
  /** One animation frame: glides the view toward the match, draws it, and returns the new view. */
  draw(canvas: HTMLCanvasElement, match: FieldMatch, view: unknown, labels: Record<string, string>, logos: Record<string, HTMLImageElement | undefined>, now: number, size: number): unknown;
}

export const fields: Record<FieldId, Field> = {
  ring: {
    id: "ring",
    name: "Ring",
    game: "arena",
    realtimeTickMs: 100,
    createMatch: ring.createMatch,
    playTick: ring.playTick,
    alive: ring.alive,
    isOver: ring.isOver,
    endReason: ring.endReason,
    standings: ring.standings,
    scores: ring.scores,
    state: ringState,
    questions: ringQuestions,
    view: emptyRingView,
    draw(canvas, match: ring.Match, view: RingView, labels, logos, now, size) {
      const next = glideRing(view, match, now);
      drawArena(canvas, match, labels, next, now, size, logos);
      return next;
    },
  },
  plane: {
    id: "plane",
    name: "Plane",
    game: "plane",
    realtimeTickMs: 300,
    createMatch: plane.createMatch,
    playTick: plane.playTick,
    alive: plane.alive,
    isOver: plane.isOver,
    endReason: plane.endReason,
    standings: plane.standings,
    scores: plane.scores,
    state: planeState,
    questions: planeQuestions,
    view: emptyPlaneView,
    draw(canvas, match: plane.Match, view: PlaneView, labels, logos, now, size) {
      const next = glidePlane(view, match, now);
      drawPlane(canvas, match, labels, next, now, size, logos);
      return next;
    },
  },
};
