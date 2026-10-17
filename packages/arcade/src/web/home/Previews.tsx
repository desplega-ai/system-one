// Home page previews: the real game renderers, played by fake answers. They make no API calls, so each
// preview carries a "simulated" badge: the logos show who could play, not what they did.
import type { Answer, Questions, Usage } from "@system-one/ai";
import { useEffect, useRef } from "react";
import { createRng } from "../../games/arena/engine.ts";
import { type Field, type FieldMatch, fields } from "../../games/arena/fields.ts";
import { applyTurn, createGame, type Game, interestLevels, type Turn as AttentionTurn } from "../../games/attention/engine.ts";
import market from "../../games/attention/images/market.jpg";
import { drawPicture, drawZoom, glide as glideAttention, type Shown } from "../../games/attention/render.ts";
import { cells } from "../lib/media.ts";
import { useElementWidth, useSquareSide } from "../lib/hooks.ts";
import cloudflareLogo from "../logos/cloudflare.svg";
import openaiLogo from "../logos/openai.svg";
import typesafeLogo from "../logos/typesafe.png";
import { logoImage } from "../ui/brands.ts";

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

/** The preview's players: a logo and a name each, in agent order (red, blue, green, yellow). */
const players = [
  { name: "Jev", logo: typesafeLogo },
  { name: "Clef Flash", logo: cloudflareLogo },
  { name: "GPT-6 Luna", logo: openaiLogo },
  { name: "Clef", logo: cloudflareLogo },
];

/** A made-up answer to each question: one favorite option, and a 20% to 70% chance to fire. The arena asks
 * only choices and yes or no questions. */
function fakeAnswers(questions: Questions, rng: () => number): Record<string, Answer> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      question.type === "choice" ? { type: "choice", ...guess(Object.keys(question.options), rng) } : { type: "boolean", probability: 0.2 + rng() * 0.5 },
    ]),
  );
}

const DRAW_MIN_PX = 320;

/** Four agents on one field at real-time speed: a turn every `tickMs`, and a new match 1.5 s after one ends. */
function FieldPreview({ field, seed, tickMs }: { field: Field; seed: number; tickMs: number }) {
  const [box, side] = useSquareSide<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ match: undefined as FieldMatch | undefined, view: field.view(), next: 0, rng: createRng(seed) });

  useAnimation((now) => {
    const s = state.current;
    s.match ??= field.createMatch(["a", "b", "c", "d"], { maxTicks: 120 });
    if (now >= s.next) {
      if (field.isOver(s.match)) {
        s.match = field.createMatch(["a", "b", "c", "d"], { maxTicks: 120 });
        s.view = field.view();
      } else {
        const match = s.match;
        const turns = Object.fromEntries(field.alive(match).map((agent) => [agent.id, { answers: fakeAnswers(field.questions(match, agent), s.rng), usage, latencyMs: 0 }]));
        s.match = field.playTick(match, turns, "sample", s.rng);
      }
      s.next = now + (field.isOver(s.match) ? 1500 : tickMs);
    }
    if (!canvas.current || side === 0) return;
    const labels = Object.fromEntries(s.match.agents.map((a, i) => [a.id, players[i]!.name]));
    const logos = Object.fromEntries(s.match.agents.map((a, i) => [a.id, logoImage(players[i]!.logo)]));
    // The renderers size text and dots in pixels, so a small field draws at DRAW_MIN_PX and shrinks as a
    // whole, like a screenshot of the game.
    s.view = field.draw(canvas.current, s.match, s.view, labels, logos, now, Math.max(side, DRAW_MIN_PX));
    canvas.current.style.width = canvas.current.style.height = `${side}px`;
  });

  return (
    <div ref={box} className="flex size-full items-center justify-center">
      <canvas ref={canvas} />
    </div>
  );
}

/**
 * The arena on the home page: the ring on the left and the plane on the right, split by a line. `square`
 * shows only the ring, as wide as the box (for the share image).
 */
export function ArenaPreview({ square = false }: { square?: boolean }) {
  if (square) {
    return (
      <div className="relative aspect-square bg-[radial-gradient(circle_at_center,oklch(0.19_0.01_265),transparent_70%)]">
        <FieldPreview field={fields.ring} seed={7} tickMs={250} />
        <Simulated />
      </div>
    );
  }
  return (
    <div className="relative grid aspect-[16/10] grid-cols-2 bg-[radial-gradient(circle_at_center,oklch(0.17_0.01_265),oklch(0.12_0.008_265)_75%)]">
      {[
        { field: fields.ring, seed: 7, tickMs: 250 },
        { field: fields.plane, seed: 11, tickMs: fields.plane.realtimeTickMs },
      ].map((side) => (
        <div key={side.field.id} className="relative min-w-0 px-2 pt-7 pb-3">
          <FieldPreview {...side} />
          <span className="caps absolute top-3 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">{side.field.name}</span>
        </div>
      ))}
      <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />
      <Simulated />
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
    <div ref={box} className="relative flex aspect-[16/10] items-center justify-center gap-2 bg-black/40">
      <Simulated />
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

/** Says that the preview plays fake answers. */
function Simulated() {
  return <span className="caps absolute top-3 left-3 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">simulated</span>;
}
