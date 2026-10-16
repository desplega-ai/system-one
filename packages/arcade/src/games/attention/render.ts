// Draws the attention game: the picture with each judge's view and focus, and each judge's
// zoomed view with the heatmap of its last answer.
import { cells, drawView, fullView, GRID, type Source, type View } from "../../web/lib/media.ts";
import { agentColors } from "../../web/ui/colors.ts";
import { cellView, currentView, earlierViews, type Judge, type Mode } from "./engine.ts";

/** What the screen shows for a judge. It glides toward the judge's real view and focus. */
export type Shown = { view: View; focus: View | null };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpView = (a: View, b: View, t: number): View => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), size: lerp(a.size, b.size, t) });

/** One animation step toward the judge's current view and focus. */
export function glide(shown: Shown | undefined, judge: Judge, mode: Mode, rate = 0.2): Shown {
  const view = currentView(judge, mode);
  const focus = judge.focus && judge.heat ? cellView(judge.heat.view, judge.focus) : null;
  if (!shown) return { view, focus };
  return { view: lerpView(shown.view, view, rate), focus: focus && (shown.focus ? lerpView(shown.focus, focus, rate) : focus) };
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
    const inset = 1.5 + i * 3;
    ctx.lineWidth = 3;
    ctx.strokeRect(s.view.x * size + inset, s.view.y * size + inset, s.view.size * size - 2 * inset, s.view.size * size - 2 * inset);
    if (s.focus) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(s.focus.x * size, s.focus.y * size, s.focus.size * size, s.focus.size * size);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.focus.x * size, s.focus.y * size, s.focus.size * size, s.focus.size * size);
    }
  });
}

/** The judge's view, as the model sees it, with the heatmap of its last answer and its focus cell. */
export function drawZoom(canvas: HTMLCanvasElement, src: Source, judge: Judge, shown: Shown, size = 288) {
  const ctx = fit(canvas, size);
  if (!ctx) return;
  const { view } = shown;
  drawView(ctx, src, view, 0, 0, size);
  const toCanvas = (r: View) => [((r.x - view.x) / view.size) * size, ((r.y - view.y) / view.size) * size, (r.size / view.size) * size] as const;

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < GRID; i++) {
    const p = (i * size) / GRID;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  const color = agentColors[judge.id]!;
  if (judge.heat) {
    const max = Math.max(...judge.heat.probabilities);
    ctx.fillStyle = color;
    judge.heat.probabilities.forEach((p, i) => {
      if (max <= 0 || p / max < 0.02) return;
      const [x, y, side] = toCanvas(cellView(judge.heat!.view, cells[i]!));
      ctx.globalAlpha = 0.6 * (p / max);
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
