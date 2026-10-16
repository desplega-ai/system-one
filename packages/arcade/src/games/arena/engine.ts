// Arena rules. Pure: the same match, turns and random numbers give the same result.
import type { Usage } from "@system-one/ai";
import type { ArenaAnswers } from "./state.ts";

export const RADIUS = 10;
export const STEP_DEGREES = 15;
export const START_HP = 3;
export const MAX_TICKS = 100;
/** Quiet turns in a row (nobody fires) before the match ends in a draw. */
export const STALEMATE_TURNS = 10;
export const colors = ["red", "blue", "green", "yellow", "purple", "orange"] as const;

export type Move = "clockwise" | "stay" | "counterclockwise";
export type Policy = "sample" | "top";
export type Rng = () => number;

export type Agent = {
  id: string;
  /** Registry key of the model that plays this agent. */
  model: string;
  /** Degrees on the circle. Clockwise adds degrees. */
  angle: number;
  hp: number;
  /** The tick this agent was knocked out, or null while it stands. */
  diedAt: number | null;
  movedThisTick: boolean;
  lastShotAt: string | null;
  lastAnswers: ArenaAnswers | null;
  // Stats for the scores.
  actions: number;
  calls: number;
  errors: number;
  refusals: number;
  shots: number;
  hits: number;
  /** Actions that stayed put. */
  stays: number;
  latencyMs: number;
  costUsd: number;
};

export type Shot = { from: string; to: string; hit: boolean };

export type Match = {
  tick: number;
  maxTicks: number;
  /**
   * Turns in a row in which nobody fired. A turn ends when every standing agent has acted once:
   * every tick in lockstep, and once the slowest agent has answered in real-time.
   */
  quietTurns: number;
  /** The match ends in a draw after this many quiet turns. */
  stalemateTurns: number;
  /** Agents that acted in the current turn, and the shots fired in it. */
  turnActed: string[];
  turnShots: number;
  agents: Agent[];
  /** Shots of the last tick, for drawing. */
  shots: Shot[];
  /** Newest first. */
  events: string[];
};

/**
 * One agent's input for a tick: the decision, or why there is none. In real-time mode several answers
 * can land in one tick: the newest answers count, and `calls`, `usage` and `latencyMs` hold the sums.
 */
export type Turn = { answers: ArenaAnswers; usage: Usage; latencyMs: number; calls?: number } | { error: string };

export type Action = { move: Move; target: string | null; fire: boolean };
const idle: Action = { move: "stay", target: null, fire: false };

export function createMatch(
  models: readonly string[],
  { maxTicks = MAX_TICKS, stalemateTurns = STALEMATE_TURNS }: { maxTicks?: number; stalemateTurns?: number } = {},
): Match {
  if (models.length < 2 || models.length > colors.length) throw new RangeError(`the arena takes 2 to ${colors.length} agents`);
  const agents = models.map(
    (model, i): Agent => ({
      id: colors[i]!,
      model,
      angle: (i * 360) / models.length,
      hp: START_HP,
      diedAt: null,
      movedThisTick: false,
      lastShotAt: null,
      lastAnswers: null,
      actions: 0,
      calls: 0,
      errors: 0,
      refusals: 0,
      shots: 0,
      hits: 0,
      stays: 0,
      latencyMs: 0,
      costUsd: 0,
    }),
  );
  return { tick: 0, maxTicks, quietTurns: 0, stalemateTurns, turnActed: [], turnShots: 0, agents, shots: [], events: [] };
}

/** mulberry32: a small seeded generator, so a match can be replayed from its seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let r = Math.imul(state ^ (state >>> 15), 1 | state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const alive = (match: Match) => match.agents.filter((a) => a.hp > 0);
export type EndReason = "last-standing" | "stalemate" | "time";

/** Why the match is over, or null while it goes on. */
export function endReason(match: Match): EndReason | null {
  if (alive(match).length <= 1) return "last-standing";
  if (match.quietTurns >= match.stalemateTurns) return "stalemate";
  if (match.tick >= match.maxTicks) return "time";
  return null;
}

export const isOver = (match: Match) => endReason(match) !== null;

/** Degrees from a to b, clockwise, in [0, 360). */
export function clockwiseDegrees(from: number, to: number): number {
  return (((to - from) % 360) + 360) % 360;
}

/** Straight-line distance between two points on the circle, 0 to 2 * RADIUS. */
export function distance(a: Agent, b: Agent): number {
  const delta = clockwiseDegrees(a.angle, b.angle);
  return 2 * RADIUS * Math.sin(((Math.min(delta, 360 - delta) / 2) * Math.PI) / 180);
}

/** A shot hits more often at close range. Moving makes you harder to hit, and makes your own shots worse. */
export function hitChance(distanceToTarget: number, shooterMoved: boolean, targetMoved: boolean): number {
  let p = 0.9 - 0.035 * distanceToTarget;
  if (shooterMoved) p *= 0.6;
  if (targetMoved) p *= 0.6;
  return Math.min(0.95, Math.max(0.05, p));
}

/**
 * Turns answers into an action. With "sample" the action is drawn from the probabilities, with "top"
 * it is the most probable answer. A refused answer falls back to stay, no target or no fire.
 */
export function chooseAction(answers: ArenaAnswers, policy: Policy, rng: Rng, targets: readonly string[]): { action: Action; refusals: number } {
  let refusals = 0;
  const { move, target, fire } = answers;

  let chosenMove: Move = "stay";
  if (move.type === "refusal") refusals++;
  else chosenMove = policy === "top" ? move.choice : draw(move.probabilities, rng);

  let chosenTarget: string | null = null;
  if (target.type === "refusal") refusals++;
  else {
    const pick = policy === "top" ? target.choice : draw(target.probabilities, rng);
    chosenTarget = targets.includes(pick) ? pick : null;
  }

  let chosenFire = false;
  if (fire.type === "refusal") refusals++;
  else chosenFire = policy === "top" ? fire.probability >= 0.5 : rng() < fire.probability;

  return { action: { move: chosenMove, target: chosenTarget, fire: chosenFire }, refusals };
}

function draw<K extends string>(probabilities: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(probabilities) as [K, number][];
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  let r = rng() * total;
  for (const [option, p] of entries) {
    r -= p;
    if (r < 0) return option;
  }
  return entries.at(-1)![0];
}

/**
 * Plays one tick. Agents with a turn act. Agents without one (real-time mode, no new answer) do nothing.
 * All moves happen first, then all shots, then the damage, so two agents can knock each other out.
 */
export function playTick(match: Match, turns: Readonly<Record<string, Turn>>, policy: Policy, rng: Rng): Match {
  const tick = match.tick + 1;
  const agents = match.agents.map((a) => ({ ...a, movedThisTick: false }));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const standing = agents.filter((a) => a.hp > 0);
  const events: string[] = [];

  const actions = new Map<Agent, Action>();
  for (const agent of standing) {
    const turn = turns[agent.id];
    if (!turn) continue;
    agent.actions++;
    if ("error" in turn) {
      agent.errors++;
      actions.set(agent, idle);
      continue;
    }
    agent.calls += turn.calls ?? 1;
    agent.latencyMs += turn.latencyMs;
    agent.costUsd += turn.usage.costUsd ?? 0;
    agent.lastAnswers = turn.answers;
    const targets = standing.filter((a) => a !== agent).map((a) => a.id);
    const { action, refusals } = chooseAction(turn.answers, policy, rng, targets);
    agent.refusals += refusals;
    if (action.move === "stay") agent.stays++;
    actions.set(agent, action);
  }

  for (const [agent, action] of actions) {
    if (action.move === "stay") continue;
    agent.angle = clockwiseDegrees(0, agent.angle + (action.move === "clockwise" ? STEP_DEGREES : -STEP_DEGREES));
    agent.movedThisTick = true;
  }

  const shots: Shot[] = [];
  const damage = new Map<Agent, number>();
  for (const [agent, action] of actions) {
    const target = action.fire && action.target ? byId.get(action.target) : undefined;
    // A target can be out already: in real-time mode the answer can land after the target fell.
    if (!target || target.hp <= 0 || target === agent) {
      agent.lastShotAt = null;
      continue;
    }
    agent.shots++;
    agent.lastShotAt = target.id;
    const hit = rng() < hitChance(distance(agent, target), agent.movedThisTick, target.movedThisTick);
    shots.push({ from: agent.id, to: target.id, hit });
    if (hit) {
      agent.hits++;
      damage.set(target, (damage.get(target) ?? 0) + 1);
    }
    events.push(`${agent.id} ${hit ? "hit" : "missed"} ${target.id}`);
  }

  for (const [agent, amount] of damage) {
    agent.hp = Math.max(0, agent.hp - amount);
    if (agent.hp === 0) {
      agent.diedAt = tick;
      events.push(`${agent.id} is out`);
    }
  }

  // A turn ends once every standing agent has acted. A turn without shots is quiet.
  let { quietTurns } = match;
  let turnActed = [...new Set([...match.turnActed, ...[...actions.keys()].map((a) => a.id)])];
  let turnShots = match.turnShots + shots.length;
  if (agents.filter((a) => a.hp > 0).every((a) => turnActed.includes(a.id))) {
    quietTurns = turnShots === 0 ? quietTurns + 1 : 0;
    turnActed = [];
    turnShots = 0;
    if (quietTurns === match.stalemateTurns) events.push(`stalemate: nobody fired for ${quietTurns} turns`);
  }

  return {
    ...match,
    tick,
    quietTurns,
    turnActed,
    turnShots,
    agents,
    shots,
    events: [...events.reverse(), ...match.events].slice(0, 40),
  };
}

/** Best first: still standing, then knocked out later, then more hp, then more hits. */
function compare(a: Agent, b: Agent): number {
  return (b.diedAt ?? Infinity) - (a.diedAt ?? Infinity) || b.hp - a.hp || b.hits - a.hits;
}

export function standings(match: Match): Agent[] {
  return [...match.agents].sort(compare);
}

/** One row per agent and metric, for POST /api/runs/:id/scores. A tie for first place or a stalemate is not a win. */
export function scores(match: Match): { model: string; metric: string; value: number }[] {
  const ranked = standings(match);
  const stalemate = endReason(match) === "stalemate";
  const clearWinner = !stalemate && (ranked.length < 2 || compare(ranked[0]!, ranked[1]!) !== 0);
  return ranked.flatMap((agent, i) =>
    Object.entries({
      win: i === 0 && clearWinner ? 1 : 0,
      placement: i + 1,
      stalemate: stalemate ? 1 : 0,
      stay_rate: agent.actions > 0 ? agent.stays / agent.actions : 0,
      survived_ticks: agent.diedAt ?? match.tick,
      hits: agent.hits,
      shots: agent.shots,
      actions: agent.actions,
      refusals: agent.refusals,
      errors: agent.errors,
      latency_ms: agent.calls > 0 ? agent.latencyMs / agent.calls : 0,
      cost_usd: agent.costUsd,
    }).map(([metric, value]) => ({ model: agent.model, metric, value })),
  );
}
