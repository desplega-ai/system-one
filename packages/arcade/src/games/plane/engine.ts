// Plane rules. Pure: the same match, turns and random numbers give the same result.
import type { Usage } from "@system-one/ai";
import { colors, type EndReason, MAX_TICKS, type Policy, type Rng, STALEMATE_TURNS, START_HP } from "../arena/engine.ts";
import type { PlaneAnswers } from "./state.ts";

export { colors, createRng, type EndReason, type Policy, type Rng, STALEMATE_TURNS, START_HP } from "../arena/engine.ts";
export const SIZE = 20;
export const RADIUS = 0.6;
export const STEP = 1.2;
export const SPEED = 3;

const clocks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const descriptions = [
  "up and slightly right", "right and slightly up", "right", "right and slightly down",
  "down and slightly right", "down", "down and slightly left", "left and slightly down",
  "left", "left and slightly up", "up and slightly left", "up",
];
export const directions = clocks.map((clock, i) => ({
  clock,
  move: `${clock}-oclock` as const,
  dx: Math.sin((clock * Math.PI) / 6),
  dy: -Math.cos((clock * Math.PI) / 6),
  description: `move toward ${clock} o'clock (${descriptions[i]})`,
}));
export type Move = "stay" | (typeof directions)[number]["move"];

export type Agent = {
  id: string;
  /** Registry key of the model that plays this agent. */
  model: string;
  x: number;
  y: number;
  /** Position before this tick's move, for drawing. */
  from: { x: number; y: number };
  hp: number;
  diedAt: number | null;
  lastAnswers: PlaneAnswers | null;
  // Stats for the scores.
  actions: number;
  calls: number;
  errors: number;
  refusals: number;
  shots: number;
  hits: number;
  stays: number;
  blocked: number;
  latencyMs: number;
  costUsd: number;
};

/** dx and dy are the displacement per tick. */
export type Projectile = { id: string; from: string; x: number; y: number; dx: number; dy: number };
export type Hit = { from: string; to: string; x: number; y: number };

export type Match = {
  tick: number;
  maxTicks: number;
  /** A turn ends once every standing agent has acted. */
  quietTurns: number;
  stalemateTurns: number;
  turnActed: string[];
  turnShots: number;
  agents: Agent[];
  projectiles: Projectile[];
  /** New shots and hits of the last tick, for drawing. */
  fired: Projectile[];
  hits: Hit[];
  /** Newest first. */
  events: string[];
};

/** In real-time mode, calls, usage and latencyMs can hold the sums of several answers. */
export type Turn = { answers: PlaneAnswers; usage: Usage; latencyMs: number; calls?: number } | { error: string };
export type Action = { move: Move; target: string | null; fire: boolean };
const idle: Action = { move: "stay", target: null, fire: false };

export function createMatch(
  models: readonly string[],
  { maxTicks = MAX_TICKS, stalemateTurns = STALEMATE_TURNS }: { maxTicks?: number; stalemateTurns?: number } = {},
): Match {
  if (models.length < 2 || models.length > colors.length) throw new RangeError(`the plane takes 2 to ${colors.length} agents`);
  const agents = models.map((model, i): Agent => {
    const angle = (i * 2 * Math.PI) / models.length;
    const x = SIZE / 2 + 7 * Math.sin(angle);
    const y = SIZE / 2 - 7 * Math.cos(angle);
    return {
      id: colors[i]!, model, x, y, from: { x, y }, hp: START_HP, diedAt: null, lastAnswers: null,
      actions: 0, calls: 0, errors: 0, refusals: 0, shots: 0, hits: 0, stays: 0, blocked: 0, latencyMs: 0, costUsd: 0,
    };
  });
  return {
    tick: 0, maxTicks, quietTurns: 0, stalemateTurns, turnActed: [], turnShots: 0,
    agents, projectiles: [], fired: [], hits: [], events: [],
  };
}

export const alive = (match: Match) => match.agents.filter((a) => a.hp > 0);

export function endReason(match: Match): EndReason | null {
  if (alive(match).length <= 1) return "last-standing";
  if (match.quietTurns >= match.stalemateTurns) return "stalemate";
  if (match.tick >= match.maxTicks) return "time";
  return null;
}

export const isOver = (match: Match) => endReason(match) !== null;

/** The nearest clock direction. A zero vector defaults to 12 o'clock. */
export function clockOf(dx: number, dy: number): (typeof clocks)[number] {
  if (dx === 0 && dy === 0) return 12;
  return (((Math.round((Math.atan2(dx, -dy) * 6) / Math.PI) + 12) % 12) || 12) as (typeof clocks)[number];
}

/** A refused answer falls back to stay, no target or no fire. The other answers still count. */
export function chooseAction(answers: PlaneAnswers, policy: Policy, rng: Rng, targets: readonly string[]): { action: Action; refusals: number } {
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

/** First contact with the agent's collision circle, as a fraction of this tick's segment. */
function contact(p: Projectile, a: Agent): number | null {
  const x = a.x - p.x;
  const y = a.y - p.y;
  const radius = RADIUS + 0.2;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const speedSquared = p.dx * p.dx + p.dy * p.dy;
  const dot = x * p.dx + y * p.dy;
  const discriminant = dot * dot - speedSquared * c;
  // Allow exact tangency despite floating-point rounding.
  if (speedSquared === 0 || discriminant < -1e-9) return null;
  const t = (dot - Math.sqrt(Math.max(0, discriminant))) / speedSquared;
  return t >= -1e-9 && t <= 1 + 1e-9 ? Math.min(1, Math.max(0, t)) : null;
}

/** Moves resolve in agent order. Existing projectiles advance before new shots spawn. */
export function playTick(match: Match, turns: Readonly<Record<string, Turn>>, policy: Policy, rng: Rng): Match {
  const tick = match.tick + 1;
  const agents = match.agents.map((a) => ({ ...a, from: { x: a.x, y: a.y } }));
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
    const direction = directions.find((d) => d.move === action.move)!;
    const x = Math.min(SIZE - RADIUS, Math.max(RADIUS, agent.x + STEP * direction.dx));
    const y = Math.min(SIZE - RADIUS, Math.max(RADIUS, agent.y + STEP * direction.dy));
    // Allow touching circles despite floating-point rounding.
    if (standing.some((a) => a !== agent && Math.hypot(a.x - x, a.y - y) < 2 * RADIUS - 1e-9)) {
      agent.blocked++;
      continue;
    }
    agent.x = x;
    agent.y = y;
  }

  const projectiles: Projectile[] = [];
  const hits: Hit[] = [];
  const damage = new Map<Agent, number>();
  for (const p of match.projectiles) {
    let target: Agent | undefined;
    let first = Infinity;
    for (const agent of standing) {
      if (agent.id === p.from) continue;
      const t = contact(p, agent);
      if (t !== null && t < first) {
        target = agent;
        first = t;
      }
    }
    if (target) {
      hits.push({ from: p.from, to: target.id, x: p.x + first * p.dx, y: p.y + first * p.dy });
      const shooter = byId.get(p.from);
      if (shooter) shooter.hits++;
      damage.set(target, (damage.get(target) ?? 0) + 1);
      events.push(`${p.from} hit ${target.id}`);
      continue;
    }
    const next = { ...p, x: p.x + p.dx, y: p.y + p.dy };
    if (next.x < 0 || next.x > SIZE || next.y < 0 || next.y > SIZE) events.push(`${p.from} missed`);
    else projectiles.push(next);
  }

  for (const [agent, amount] of damage) {
    agent.hp = Math.max(0, agent.hp - amount);
    if (agent.hp === 0) {
      agent.diedAt = tick;
      events.push(`${agent.id} is out`);
    }
  }

  const fired: Projectile[] = [];
  for (const [agent, action] of actions) {
    const target = action.fire && action.target ? byId.get(action.target) : undefined;
    if (agent.hp <= 0 || !target || target.hp <= 0 || target === agent || projectiles.some((p) => p.from === agent.id)) continue;
    const distance = Math.hypot(target.x - agent.x, target.y - agent.y);
    const p = {
      id: `${tick}-${agent.id}`, from: agent.id, x: agent.x, y: agent.y,
      dx: ((target.x - agent.x) / distance) * SPEED, dy: ((target.y - agent.y) / distance) * SPEED,
    };
    agent.shots++;
    fired.push(p);
    projectiles.push(p);
    events.push(`${agent.id} fired at ${target.id}`);
  }

  // A turn ends once every standing agent has acted. A turn without new shots is quiet.
  let { quietTurns } = match;
  let turnActed = [...new Set([...match.turnActed, ...[...actions.keys()].map((a) => a.id)])];
  let turnShots = match.turnShots + fired.length;
  if (agents.filter((a) => a.hp > 0).every((a) => turnActed.includes(a.id))) {
    quietTurns = turnShots === 0 ? quietTurns + 1 : 0;
    turnActed = [];
    turnShots = 0;
    if (quietTurns === match.stalemateTurns) events.push(`stalemate: nobody fired for ${quietTurns} turns`);
  }

  return {
    ...match, tick, quietTurns, turnActed, turnShots, agents, projectiles, fired, hits,
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

/** A tie for first place or a stalemate is not a win. Accuracy requires at least one shot. */
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
      blocked: agent.blocked,
      ...(agent.shots > 0 ? { accuracy: agent.hits / agent.shots } : {}),
    }).map(([metric, value]) => ({ model: agent.model, metric, value })),
  );
}
