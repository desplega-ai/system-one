// What each agent sees and is asked. Compute geometry here so models do not have to calculate it.
import { type Answers, type JsonObject, q } from "@system-one/ai";
import { type Agent, alive, clockOf, directions, type Match, type Move, RADIUS, SIZE, SPEED, STEP } from "./engine.ts";

const rules = (stalemateTurns: number) =>
  [
    `The ${SIZE} by ${SIZE} plane starts at the top-left, with rightward x, downward y, and steps of ${STEP} units.`,
    `Walls and agents block movement, and projectiles travel ${SPEED} units per tick with one in flight per agent.`,
    `Each hit removes 1 hp, the last agent standing wins, and ${stalemateTurns} turns without shots cause a draw.`,
  ].join(" ");

const rounded = (n: number) => Number(n.toFixed(1));

export function stateFor(match: Match, me: Agent): JsonObject {
  const others = alive(match).filter((a) => a.id !== me.id);
  const walls = { left: me.x - RADIUS, right: SIZE - RADIUS - me.x, top: me.y - RADIUS, bottom: SIZE - RADIUS - me.y };
  return {
    rules: rules(match.stalemateTurns),
    turn: match.tick + 1,
    maxTurns: match.maxTicks,
    quietTurns: match.quietTurns,
    drawAfterQuietTurns: match.stalemateTurns,
    you: {
      id: me.id,
      x: rounded(me.x),
      y: rounded(me.y),
      hp: me.hp,
      projectileInFlight: match.projectiles.some((p) => p.from === me.id),
      walls: Object.fromEntries(Object.entries(walls).filter(([, d]) => d < 3).map(([wall, d]) => [wall, rounded(d)])),
    },
    others: others.map((other) => {
      const d = Math.hypot(other.x - me.x, other.y - me.y);
      return {
        id: other.id,
        hp: other.hp,
        distance: rounded(d),
        direction: clockOf(other.x - me.x, other.y - me.y),
        projectileTicks: Math.ceil(d / SPEED),
      };
    }),
    incoming: match.projectiles.flatMap((p) => {
      if (p.from === me.id) return [];
      const speedSquared = p.dx * p.dx + p.dy * p.dy;
      if (speedSquared === 0) return [];
      const untilWall = Math.min(
        p.dx > 0 ? (SIZE - p.x) / p.dx : p.dx < 0 ? -p.x / p.dx : Infinity,
        p.dy > 0 ? (SIZE - p.y) / p.dy : p.dy < 0 ? -p.y / p.dy : Infinity,
      );
      const ticks = Math.min(3, untilWall, Math.max(0, ((me.x - p.x) * p.dx + (me.y - p.y) * p.dy) / speedSquared));
      const distance = Math.hypot(p.x + ticks * p.dx - me.x, p.y + ticks * p.dy - me.y);
      if (distance > 1.5) return [];
      return [{ from: p.from, direction: clockOf(-p.dx, -p.dy), ticksUntilClosest: rounded(ticks) }];
    }),
  };
}

export function questionsFor(match: Match, me: Agent) {
  const others = alive(match).filter((a) => a.id !== me.id);
  const targets: Record<string, string | null> = Object.fromEntries(others.map((o) => [
    o.id, `${o.hp} hp, ${Math.hypot(o.x - me.x, o.y - me.y).toFixed(1)} units, ${clockOf(o.x - me.x, o.y - me.y)} o'clock`,
  ]));
  return {
    move: q.choice<Move>(`Where should ${me.id} move this turn?`, {
      stay: "stay at your current position",
      ...Object.fromEntries(directions.map((d) => [d.move, d.description])) as Record<Exclude<Move, "stay">, string>,
    }),
    // The object form, because the ids change during the match.
    target: q.choice<string>(`Who should ${me.id} aim at?`, { ...targets, nobody: "aim at no one" }),
    fire: q.boolean(`Should ${me.id} fire this turn?`),
  };
}

export type PlaneQuestions = ReturnType<typeof questionsFor>;
export type PlaneAnswers = Answers<PlaneQuestions>;
