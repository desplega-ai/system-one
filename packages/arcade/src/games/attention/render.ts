// Draws the attention game: the picture with each judge's view and focus, and each judge's
// zoomed view with the heatmap of its last answer.
import { cells, drawView, fullView, GRID, type Source, type View } from "../../web/lib/media.ts";
import { agentColors } from "../../web/ui/colors.ts";
import { cellView, currentView, earlierViews, type InterestLevel, interestLevels, type Judge, type Mode, reactionTints, reactions } from "./engine.ts";

/** A spark around a new reaction, in canvas units of the picture (0 to 1) per second. */
type Spark = { x: number; y: number; vx: number; vy: number; at: number; life: number; color: string };

/**
 * What the screen shows for a judge. It glides toward the judge's real view and focus. A new reaction
 * pops in: it jumps up, grows past its size and settles, with a burst of sparks in its tint.
 */
export type Shown = { view: View; focus: View | null; reaction: { level: InterestLevel; at: number; step: number } | null; sparks: Spark[] };

const POP_MS = 420;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpView = (a: View, b: View, t: number): View => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), size: lerp(a.size, b.size, t) });

/** Where a judge's reaction sits: just outside the top-right corner of its view, inside the picture. */
const reactionSpot = (view: View) => ({ x: Math.min(0.96, view.x + view.size), y: Math.max(0.04, view.y) });

/** One animation step toward the judge's current view and focus. A changed reaction starts a pop. */
export function glide(shown: Shown | undefined, judge: Judge, mode: Mode, rate = 0.2, now = performance.now()): Shown {
  const view = currentView(judge, mode);
  const focus = judge.focus && judge.heat ? cellView(judge.heat.view, judge.focus) : null;
  const level = judge.steps.at(-1)?.reaction ?? null;
  const next: Shown = shown
    ? { ...shown, view: lerpView(shown.view, view, rate), focus: focus && (shown.focus ? lerpView(shown.focus, focus, rate) : focus) }
    : { view, focus, reaction: null, sparks: [] };
  next.sparks = next.sparks.filter((s) => now - s.at < s.life);
  // A new level pops. The same level again stays put, or a live judge would pop twice a second.
  if (level && next.reaction?.level !== level) {
    next.reaction = { level, at: now, step: judge.steps.length };
    const spot = reactionSpot(next.view);
    const strength = interestLevels.indexOf(level) + 1;
    next.sparks = [
      ...next.sparks,
      ...Array.from({ length: 4 + strength * 3 }, () => {
        const a = Math.random() * Math.PI * 2;
        const v = (0.08 + Math.random() * 0.12) * (0.6 + strength * 0.25);
        return { x: spot.x, y: spot.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, at: now, life: 300 + Math.random() * 300, color: reactionTints[level] };
      }),
    ];
  } else if (!level) next.reaction = null;
  return next;
}

/** Sizes the canvas for sharp drawing on high-density screens. Returns a context in CSS pixels. */
function fit(canvas: HTMLCanvasElement, size: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** The whole picture, each judge's current view and focus cell, and in still mode its earlier views (dashed). */
export function drawPicture(canvas: HTMLCanvasElement, src: Source, judges: readonly Judge[], shown: Readonly<Record<string, Shown>>, mode: Mode, size = 480) {
  const ctx = fit(canvas, size);
  if (!ctx) return;
  drawView(ctx, src, fullView, 0, 0, size);
  judges.forEach((judge, i) => {
    const s = shown[judge.id];
    if (!s) return;
    const color = agentColors[judge.id]!;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    if (mode === "still") for (const v of earlierViews(judge)) if (v.size < 1) ctx.strokeRect(v.x * size, v.y * size, v.size * size, v.size * size);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Inset a little per judge, so views on the same spot (like the whole picture) stay visible.
    const inset = 2 + i * 4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    ctx.strokeRect(s.view.x * size + inset, s.view.y * size + inset, s.view.size * size - 2 * inset, s.view.size * size - 2 * inset);
    if (s.focus) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(s.focus.x * size, s.focus.y * size, s.focus.size * size, s.focus.size * size);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.focus.x * size, s.focus.y * size, s.focus.size * size, s.focus.size * size);
    }
    ctx.shadowBlur = 0;
    drawReaction(ctx, s, size, performance.now());
  });
}

/** The judge's last reaction at the corner of its view: a tinted disc with the emoji, bigger for more interest. */
function drawReaction(ctx: CanvasRenderingContext2D, s: Shown, size: number, now: number) {
  for (const spark of s.sparks) {
    const t = (now - spark.at) / spark.life;
    const age = (now - spark.at) / 1000;
    const x = (spark.x + spark.vx * age * (1 - t * 0.5)) * size;
    const y = (spark.y + spark.vy * age * (1 - t * 0.5)) * size;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = spark.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - spark.vx * size * 0.05, y - spark.vy * size * 0.05);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!s.reaction) return;
  const { level, at } = s.reaction;
  const spot = reactionSpot(s.view);
  // The pop: a hop up and an overshoot in size, both easing out.
  const t = Math.min(1, (now - at) / POP_MS);
  const hop = Math.sin(t * Math.PI) * 14 * (1 - t * 0.3);
  const scale = t < 1 ? 0.5 + 0.5 * t + Math.sin(t * Math.PI) * 0.35 : 1;
  const base = 22 + interestLevels.indexOf(level) * 5;
  const radius = (base / 2 + 6) * scale;
  const x = Math.min(size - radius - 2, spot.x * size);
  const y = Math.max(radius + 2, spot.y * size) - hop;
  ctx.fillStyle = `${reactionTints[level]}cc`;
  ctx.shadowColor = reactionTints[level];
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `${Math.round(base * scale)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(reactions[level], x, y + 1);
}

/** The judge's view, as the model sees it, with the heatmap of its last answer and its focus cell. */
export function drawZoom(canvas: HTMLCanvasElement, src: Source, judge: Judge, shown: Shown, size = 288) {
  const ctx = fit(canvas, size);
  if (!ctx) return;
  const { view } = shown;
  drawView(ctx, src, view, 0, 0, size);
  const toCanvas = (r: View) => [((r.x - view.x) / view.size) * size, ((r.y - view.y) / view.size) * size, (r.size / view.size) * size] as const;

  // The grid the model answered on: the view itself in still mode, the whole frame in live mode.
  const grid = judge.heat?.view ?? view;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < GRID; i++) {
    const [x, y] = toCanvas({ x: grid.x + (i * grid.size) / GRID, y: grid.y + (i * grid.size) / GRID, size: 0 });
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
  }
  ctx.stroke();

  const color = agentColors[judge.id]!;
  if (judge.heat) {
    const max = Math.max(...judge.heat.probabilities);
    ctx.fillStyle = color;
    judge.heat.probabilities.forEach((p, i) => {
      if (max <= 0 || p / max < 0.02) return;
      const [x, y, side] = toCanvas(cellView(judge.heat!.view, cells[i]!));
      ctx.globalAlpha = 0.45 * (p / max);
      ctx.fillRect(x, y, side, side);
    });
    ctx.globalAlpha = 1;
  }
  if (shown.focus) {
    const [x, y, side] = toCanvas(shown.focus);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, side, side);
  }
}
