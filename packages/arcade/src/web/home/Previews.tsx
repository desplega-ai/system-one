// Home page previews: the real game renderers, played by fake answers. They make no API calls and
// show color names, not model names, because no model plays here.
import type { Usage } from "@system-one/ai";
import { useEffect, useRef } from "react";
import { createMatch, createRng, isOver, type Match, playTick, type Turn as ArenaTurn } from "../../games/arena/engine.ts";
import { drawArena, emptyShown, glide as glideArena } from "../../games/arena/render.ts";
import { applyTurn, createGame, type Game, interestLevels, type Turn as AttentionTurn } from "../../games/attention/engine.ts";
import market from "../../games/attention/images/market.jpg";
import { drawPicture, drawZoom, glide as glideAttention, type Shown } from "../../games/attention/render.ts";
import { cells } from "../lib/media.ts";
import { useElementWidth } from "../lib/hooks.ts";

const usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costSource: "list-price" };

/** Calls `frame` on every animation frame once the fonts are ready. With reduced motion, it draws once. */
function useAnimation(frame: (now: number) => void) {
  const latest = useRef(frame);
  latest.current = frame;
  useEffect(() => {
    let id = 0;
    let stopped = false;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (now: number) => {
      if (stopped) return;
      latest.current(now);
      if (!still) id = requestAnimationFrame(tick);
    };
    void document.fonts.ready.then(() => {
      id = requestAnimationFrame(tick);
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(id);
    };
  }, []);
}

/** A random distribution over `options`, with one clear favorite. */
function guess<T extends string>(options: readonly T[], rng: () => number): { choice: T; probabilities: Record<string, number> } {
  const weights = options.map(() => rng() ** 3);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const probabilities = Object.fromEntries(options.map((o, i) => [o, weights[i]! / sum]));
  const choice = options[weights.indexOf(Math.max(...weights))]!;
  return { choice, probabilities };
}

/** Four agents on the ring. A turn every 700 ms, and a new match 2 s after one ends. */
export function ArenaPreview() {
  const [box, width] = useElementWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ match: undefined as Match | undefined, shown: emptyShown(), next: 0, rng: createRng(7) });

  useAnimation((now) => {
    const s = state.current;
    if (!s.match) s.match = createMatch(["a", "b", "c", "d"], { maxTicks: 60 });
    if (now >= s.next) {
      if (isOver(s.match)) {
        s.match = createMatch(["a", "b", "c", "d"], { maxTicks: 60 });
        s.shown = emptyShown();
      } else {
        const standing = s.match.agents.filter((a) => a.hp > 0);
        const turns: Record<string, ArenaTurn> = {};
        for (const agent of standing) {
          const others = standing.filter((a) => a.id !== agent.id).map((a) => a.id);
          turns[agent.id] = {
            answers: {
              move: { type: "choice", ...guess(["clockwise", "stay", "counterclockwise"] as const, s.rng) },
              target: { type: "choice", ...guess([...others, "nobody"], s.rng) },
              fire: { type: "boolean", probability: 0.2 + s.rng() * 0.5 },
            },
            usage,
            latencyMs: 0,
          };
        }
        s.match = playTick(s.match, turns, "sample", s.rng);
      }
      s.next = now + (isOver(s.match) ? 2000 : 700);
    }
    const size = Math.round((width * 10) / 16);
    if (!canvas.current || size === 0) return;
    s.shown = glideArena(s.shown, s.match, now);
    drawArena(canvas.current, s.match, {}, s.shown, now, size);
  });

  return (
    <div ref={box} className="flex aspect-[16/10] items-center justify-center bg-[radial-gradient(circle_at_center,oklch(0.19_0.01_265),oklch(0.12_0.008_265)_70%)]">
      <canvas ref={canvas} />
    </div>
  );
}

/** Three judges look around the market picture: each turn picks a cell near the last one, and zooms in or out. */
export function AttentionPreview() {
  const [box, width] = useElementWidth<HTMLDivElement>();
  const main = useRef<HTMLCanvasElement>(null);
  const crops = useRef<(HTMLCanvasElement | null)[]>([]);
  const state = useRef({ game: createGame(["a", "b", "c"], "live"), shown: {} as Record<string, Shown>, next: 0, rng: createRng(3), img: null as HTMLImageElement | null });

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      state.current.img = img;
    };
    img.src = market;
  }, []);

  useAnimation((now) => {
    const s = state.current;
    if (now >= s.next) {
      s.game = {
        ...s.game,
        judges: s.game.judges.map((judge) => {
          // A cell up to 2 steps from the last focus, or anywhere at first.
          const [col, row] = judge.focus ? [judge.focus.charCodeAt(0) - 65, Number(judge.focus.slice(1)) - 1] : [4, 4];
          const near = cells.filter((c) => Math.abs(c.charCodeAt(0) - 65 - col) <= 2 && Math.abs(Number(c.slice(1)) - 1 - row) <= 2);
          const cell = guess(judge.focus ? near : cells, s.rng);
          const moves = judge.zoom === 0 ? (["deeper", "stay"] as const) : judge.zoom >= 2 ? (["out", "stay"] as const) : (["deeper", "out", "stay"] as const);
          const level = Math.floor(s.rng() * 4);
          const turn: AttentionTurn = {
            answers: {
              cell: { type: "choice", ...cell },
              move: { type: "choice", ...guess(moves, s.rng) },
              interest: { type: "score", score: level, level: interestLevels[level]!, probabilities: [0, 1, 2, 3].map((i) => (i === level ? 1 : 0)) },
            },
            usage,
            latencyMs: 0,
          };
          return applyTurn(judge, turn, 1024, "live");
        }),
      };
      s.next = now + 900 + s.rng() * 300;
    }
    // The picture is a square as tall as the box. The 3 crops stack beside it.
    const side = Math.round((width * 10) / 16) - 24;
    if (!s.img || !main.current || side <= 0) return;
    const game: Game = s.game;
    for (const judge of game.judges) s.shown[judge.id] = glideAttention(s.shown[judge.id], judge, "live");
    drawPicture(main.current, s.img, game.judges, s.shown, "live", side);
    game.judges.forEach((judge, i) => {
      const crop = crops.current[i];
      if (crop) drawZoom(crop, s.img!, judge, s.shown[judge.id]!, Math.round((side - 16) / 3));
    });
  });

  const colors = ["#ff5d52", "#4f8cff", "#34d27b"];
  return (
    <div ref={box} className="flex aspect-[16/10] items-center justify-center gap-2 bg-black/40">
      <canvas ref={main} className="rounded-lg" />
      <div className="flex flex-col gap-2">
        {colors.map((color, i) => (
          <canvas
            key={color}
            ref={(el) => {
              crops.current[i] = el;
            }}
            className="rounded-md"
            style={{ boxShadow: `0 0 0 2px ${color}, 0 0 14px ${color}55` }}
          />
        ))}
      </div>
    </div>
  );
}
