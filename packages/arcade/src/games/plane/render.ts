// Draws the plane: a square field, the agents with dashed trails of their last moves, and the projectiles
// in flight. The page keeps a Shown value per match, so agents and projectiles glide between ticks.
import { agentColors } from "../../web/ui/colors.ts";
import { endReason, isOver, type Match, SIZE, standings, START_HP } from "./engine.ts";

type Point = { x: number; y: number };

/** A move in progress: the agent dashes from `from` to `to`, fast at first, then easing in. */
type Dash = { from: Point; to: Point; at: number };
/** A spark: a short-lived particle, in plane units and units per second. */
type Spark = { x: number; y: number; vx: number; vy: number; at: number; life: number; color: string };

/** What the screen shows: the dashes, the trails, the projectiles, recent hits and sparks. In plane units. */
export type Shown = {
  tick: number;
  dashes: Record<string, Dash>;
  trails: Record<string, Point[]>;
  projectiles: Record<string, Point>;
  hits: { x: number; y: number; color: string; at: number }[];
  sparks: Spark[];
};

const TRAIL = 6;
const HIT_MS = 600;
const DASH_MS = 260;

export const emptyShown = (): Shown => ({ tick: -1, dashes: {}, trails: {}, projectiles: {}, hits: [], sparks: [] });

const toward = (from: Point | undefined, to: Point, rate: number): Point =>
  from ? { x: from.x + (to.x - from.x) * rate, y: from.y + (to.y - from.y) * rate } : to;

/** Where a dash is at `now`: an ease-out, so the jump starts fast and lands softly. */
function dashAt(dash: Dash, now: number): Point {
  const t = Math.min(1, Math.max(0, (now - dash.at) / DASH_MS));
  const k = 1 - (1 - t) ** 3;
  return { x: dash.from.x + (dash.to.x - dash.from.x) * k, y: dash.from.y + (dash.to.y - dash.from.y) * k };
}

/** A burst of sparks at `at`, flying around `angle` (radians) within `spread`. */
function burst(at: Point, angle: number, spread: number, count: number, speed: number, color: string, now: number): Spark[] {
  return Array.from({ length: count }, () => {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.4 + Math.random() * 0.8);
    return { x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, at: now, life: 250 + Math.random() * 300, color };
  });
}

/** One animation step. A new tick starts a dash for each agent that moved, with sparks kicked back from
 * where it left, adds the move to its trail, and bursts sparks where projectiles hit. */
export function glide(shown: Shown, match: Match, now: number): Shown {
  const newTick = match.tick !== shown.tick;
  const dashes: Record<string, Dash> = {};
  const trails: Record<string, Point[]> = {};
  let sparks = shown.sparks.filter((s) => now - s.at < s.life);
  for (const agent of match.agents) {
    const old = shown.dashes[agent.id];
    const moved = agent.from.x !== agent.x || agent.from.y !== agent.y;
    const trail = shown.trails[agent.id] ?? [];
    if (newTick && moved) {
      // Start from where the screen shows the agent now, so a dash that lands late still looks smooth.
      const start = old ? dashAt(old, now) : agent.from;
      dashes[agent.id] = { from: start, to: { x: agent.x, y: agent.y }, at: now };
      trails[agent.id] = [...(trail.length > 0 ? trail : [agent.from]), { x: agent.x, y: agent.y }].slice(-TRAIL);
      const back = Math.atan2(agent.from.y - agent.y, agent.from.x - agent.x);
      sparks = [...sparks, ...burst(agent.from, back, 1.6, 12, 9, agentColors[agent.id]!, now)];
    } else {
      dashes[agent.id] = old && old.to.x === agent.x && old.to.y === agent.y ? old : { from: { x: agent.x, y: agent.y }, to: { x: agent.x, y: agent.y }, at: 0 };
      trails[agent.id] = trail;
    }
  }
  const projectiles: Record<string, Point> = {};
  // A new projectile starts at its shooter and catches up with the real position.
  for (const p of match.projectiles) projectiles[p.id] = toward(shown.projectiles[p.id] ?? match.agents.find((a) => a.id === p.from), p, 0.35);
  const fresh = newTick ? match.hits.map((h) => ({ x: h.x, y: h.y, color: agentColors[h.from]!, at: now })) : [];
  for (const hit of fresh) sparks = [...sparks, ...burst(hit, 0, Math.PI * 2, 16, 9, hit.color, now), ...burst(hit, 0, Math.PI * 2, 6, 5, "#ffffff", now)];
  return { tick: match.tick, dashes, trails, projectiles, hits: [...shown.hits.filter((h) => now - h.at < HIT_MS), ...fresh], sparks };
}

/** Draws at `size` CSS pixels, sharp on high-density screens. `logos` holds each agent's maker logo. */
export function drawPlane(
  canvas: HTMLCanvasElement,
  match: Match,
  labels: Record<string, string>,
  shown: Shown,
  now: number,
  size: number,
  logos: Record<string, HTMLImageElement | undefined> = {},
) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // The plane fills the canvas, inside a margin for the labels at the walls.
  const margin = 18;
  const scale = (size - 2 * margin) / SIZE;
  const px = (p: Point) => ({ x: margin + p.x * scale, y: margin + p.y * scale });

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    const at = margin + (i * SIZE * scale) / 10;
    ctx.moveTo(at, margin);
    ctx.lineTo(at, size - margin);
    ctx.moveTo(margin, at);
    ctx.lineTo(size - margin, at);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(margin, margin, SIZE * scale, SIZE * scale);

  // Trails: the last moves as dashed lines that fade with age.
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  const posOf = (id: string, fallback: Point) => (shown.dashes[id] ? dashAt(shown.dashes[id], now) : fallback);
  for (const agent of match.agents) {
    const trail = [...(shown.trails[agent.id] ?? []).slice(0, -1), posOf(agent.id, agent)];
    ctx.strokeStyle = agentColors[agent.id]!;
    for (let i = 1; i < trail.length; i++) {
      const a = px(trail[i - 1]!);
      const b = px(trail[i]!);
      ctx.globalAlpha = (agent.hp > 0 ? 0.65 : 0.2) * (i / trail.length);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Projectiles: a glowing dot with a short tail along its direction.
  for (const p of match.projectiles) {
    const at = px(shown.projectiles[p.id] ?? p);
    const length = Math.hypot(p.dx, p.dy) || 1;
    const color = agentColors[p.from]!;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at.x - (p.dx / length) * 14, at.y - (p.dy / length) * 14);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(at.x, at.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Dashes: a bright streak behind the agent while it jumps, that shrinks as it lands.
  for (const agent of match.agents) {
    const dash = shown.dashes[agent.id];
    if (!dash || agent.hp <= 0) continue;
    const t = (now - dash.at) / DASH_MS;
    if (t >= 1) continue;
    const head = px(dashAt(dash, now));
    const tail = px(dashAt(dash, now - DASH_MS * 0.45));
    const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(1, agentColors[agent.id]!);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = gradient;
    ctx.lineCap = "round";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  ctx.globalAlpha = 1;

  // Sparks: short glowing streaks that slow down and fade.
  for (const spark of shown.sparks) {
    const age = (now - spark.at) / 1000;
    const life = (now - spark.at) / spark.life;
    if (life >= 1) continue;
    const drag = 1 - life * 0.6;
    const head = px({ x: spark.x + spark.vx * age * drag, y: spark.y + spark.vy * age * drag });
    ctx.globalAlpha = 1 - life;
    ctx.strokeStyle = spark.color;
    ctx.shadowColor = spark.color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(head.x - spark.vx * scale * 0.04, head.y - spark.vy * scale * 0.04);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Hits: a ring that grows and fades where the projectile struck.
  for (const hit of shown.hits) {
    const t = (now - hit.at) / HIT_MS;
    const at = px(hit);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = hit.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 8 + t * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const radius = Math.max(11, Math.min(16, scale * 0.7));
  for (const agent of match.agents) {
    const { x, y } = px(posOf(agent.id, agent));
    const out = agent.hp <= 0;
    const color = agentColors[agent.id]!;
    const logo = logos[agent.id];
    const withLogo = logo?.complete && logo.naturalWidth > 0;
    ctx.fillStyle = out ? "rgba(255,255,255,0.12)" : withLogo ? "#101216" : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = out ? 0 : 20;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (withLogo) {
      ctx.strokeStyle = out ? "rgba(255,255,255,0.2)" : color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = out ? 0.35 : 1;
      const side = radius * 1.15;
      ctx.drawImage(logo, x - side / 2, y - side / 2, side, side);
      ctx.globalAlpha = 1;
    }
    // Hit points as pips above the dot, the label under it.
    for (let i = 0; i < START_HP; i++) {
      ctx.fillStyle = i < agent.hp ? color : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(x + (i - (START_HP - 1) / 2) * 8, y - radius - 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = out ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)";
    ctx.font = "500 12px 'Geist Variable', system-ui, sans-serif";
    const label = labels[agent.id] ?? agent.id;
    ctx.fillText(out ? `${label} (out)` : label, x, Math.min(size - 8, y + radius + 12));
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "11px 'Geist Mono Variable', ui-monospace, monospace";
  ctx.fillText(`TICK ${match.tick} / ${match.maxTicks}${match.quietTurns > 0 && !isOver(match) ? `   QUIET ${match.quietTurns} / ${match.stalemateTurns}` : ""}`, margin + 8, margin + 14);

  // The result, big, in the winner's color, on a dark pill so it reads over the field.
  if (isOver(match)) {
    const top = standings(match)[0]!;
    const draw = endReason(match) === "stalemate" || top.hp <= 0;
    const text = draw ? "Draw" : `${labels[top.id] ?? top.id} wins`;
    ctx.font = "600 22px 'Geist Variable', system-ui, sans-serif";
    ctx.textAlign = "center";
    const width = ctx.measureText(text).width + 32;
    ctx.fillStyle = "rgba(10,11,14,0.8)";
    ctx.beginPath();
    ctx.roundRect(size / 2 - width / 2, size / 2 - 22, width, 44, 12);
    ctx.fill();
    ctx.fillStyle = draw ? "rgba(255,255,255,0.85)" : agentColors[top.id]!;
    ctx.fillText(text, size / 2, size / 2 + 1);
  }
}
