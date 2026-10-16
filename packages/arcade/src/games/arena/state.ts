// What each agent sees and is asked. The geometry is computed here, because the models judge
// well but calculate badly (gut feeling, to test).
import { type Answers, type JsonObject, q } from "@system-one/ai";
import { type Agent, alive, clockwiseDegrees, distance, hitChance, type Match, START_HP, STEP_DEGREES } from "./engine.ts";

const rules = (stalemateTurns: number) =>
  [
    "You control one agent in an arena. Every agent stands on the edge of a circle.",
    `Each turn you can move ${STEP_DEGREES} degrees clockwise or counterclockwise, or stay.`,
    "Moving makes you harder to hit, but it also makes your own shot less accurate.",
    "Shots hit more often at close range. Each hit takes 1 hp.",
    `Everyone starts with ${START_HP} hp. The last agent standing wins.`,
    `If nobody fires for ${stalemateTurns} turns in a row, the match ends in a draw and nobody wins.`,
  ].join(" ");

export function distanceBand(d: number): "close" | "mid" | "far" {
  // The chord runs from 0 to 20: about 0-47 degrees apart is close, 47-106 is mid, the rest is far.
  return d < 8 ? "close" : d < 16 ? "mid" : "far";
}

export function stateFor(match: Match, me: Agent): JsonObject {
  const others = alive(match).filter((a) => a !== me);
  return {
    rules: rules(match.stalemateTurns),
    turn: match.tick + 1,
    maxTurns: match.maxTicks,
    quietTurns: match.quietTurns,
    drawAfterQuietTurns: match.stalemateTurns,
    you: {
      id: me.id,
      hp: me.hp,
      shotAtYouLastTurn: others.filter((a) => a.lastShotAt === me.id).map((a) => a.id),
    },
    others: others.map((other) => {
      const d = distance(me, other);
      const clockwise = clockwiseDegrees(me.angle, other.angle);
      return {
        id: other.id,
        hp: other.hp,
        distance: distanceBand(d),
        degreesAway: Math.round(Math.min(clockwise, 360 - clockwise)),
        // The shorter way around the circle.
        direction: clockwise <= 180 ? "clockwise" : "counterclockwise",
        hitChanceIfBothStay: `${Math.round(hitChance(d, false, false) * 100)}%`,
        lastShotAt: other.lastShotAt,
      };
    }),
  };
}

export function questionsFor(match: Match, me: Agent) {
  const others = alive(match).filter((a) => a !== me);
  const targets: Record<string, string | null> = Object.fromEntries(
    others.map((o) => [o.id, `${o.hp} hp, ${distanceBand(distance(me, o))} range`]),
  );
  return {
    move: q.choice(`Where should ${me.id} move this turn?`, {
      clockwise: `move ${STEP_DEGREES} degrees clockwise`,
      stay: "stay, for a more accurate shot",
      counterclockwise: `move ${STEP_DEGREES} degrees counterclockwise`,
    }),
    // The object form, because the ids change during the match.
    target: q.choice<string>(`Who should ${me.id} aim at?`, { ...targets, nobody: "aim at no one" }),
    fire: q.boolean(`Should ${me.id} fire this turn?`),
  };
}

export type ArenaQuestions = ReturnType<typeof questionsFor>;
export type ArenaAnswers = Answers<ArenaQuestions>;
