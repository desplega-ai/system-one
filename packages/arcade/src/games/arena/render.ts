// Draws the arena on a canvas: the ring, the shots of the last ticks and the agents.
// The page keeps a Shown value per match, so agents glide along the ring and shots fade.
import { agentColors } from "../../web/ui/colors.ts";
import { endReason, isOver, type Match, type Shot, START_HP, STEP_DEGREES, standings } from "./engine.ts";

/** What the screen shows: angles that glide toward the real ones, and recent shots with the time they landed. */
export type Shown = { angles: Record<string, number>; shots: { shot: Shot; at: number }[]; lastShots: Shot[] | null };

const SHOT_MS = 700;
const FLASH_MS = 450;

export const emptyShown = (): Shown => ({ angles: {}, shots: [], lastShots: null });

/** One animation step: angles move along the shorter arc, and new shots are stamped with `now`. */
export function glide(shown: Shown, match: Match, now: number, rate = 0.18): Shown {
  const angles: Record<string, number> = {};
  for (const agent of match.agents) {
    const from = shown.angles[agent.id];
    if (from === undefined) {
      angles[agent.id] = agent.angle;
      continue;
    }
    const delta = ((agent.angle - from + 540) % 360) - 180;
    angles[agent.id] = Math.abs(delta) < 0.05 ? agent.angle : from + delta * rate;
  }
  const fresh = match.shots !== shown.lastShots ? match.shots.map((shot) => ({ shot, at: now })) : [];
  return { angles, shots: [...shown.shots.filter((s) => now - s.at < SHOT_MS), ...fresh], lastShots: match.shots };
}

/** Draws at `size` CSS pixels, sharp on high-density screens. */
/** `logos` holds each agent's model maker logo. An agent without one is a plain colored dot. */
export function drawArena(
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

  const center = size / 2;
  const radius = size * 0.33;
  // Angle 0 is at the top. Clockwise adds degrees, as in the engine.
  const at = (angle: number, r = radius) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: center + r * Math.cos(rad), y: center + r * Math.sin(rad), cos: Math.cos(rad) };
  };
  const angleOf = (id: string) => shown.angles[id] ?? match.agents.find((a) => a.id === id)!.angle;

  // The ring, with a mark on every position an agent can stand on.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = 0; a < 360; a += STEP_DEGREES) {
    const inner = at(a, radius - 5);
    const outer = at(a, radius + 5);
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
  }
  ctx.stroke();

  // Shots fade out. A hit is a bright line in the shooter's color, a miss a dim dashed line.
  for (const { shot, at: firedAt } of shown.shots) {
    const fade = 1 - (now - firedAt) / SHOT_MS;
    if (fade <= 0) continue;
    const from = at(angleOf(shot.from));
    const to = at(angleOf(shot.to));
    ctx.globalAlpha = fade;
    ctx.strokeStyle = shot.hit ? agentColors[shot.from]! : "rgba(255,255,255,0.45)";
    ctx.shadowColor = shot.hit ? agentColors[shot.from]! : "transparent";
    ctx.shadowBlur = shot.hit ? 16 : 0;
    ctx.lineWidth = shot.hit ? 3 : 1.5;
    ctx.setLineDash(shot.hit ? [] : [6, 6]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  for (const agent of match.agents) {
    const angle = angleOf(agent.id);
    const { x, y } = at(angle);
    const out = agent.hp <= 0;
    const color = agentColors[agent.id]!;

    // A hit target flashes: a white ring that grows and fades.
    const hit = shown.shots.find((s) => s.shot.hit && s.shot.to === agent.id && now - s.at < FLASH_MS);
    if (hit) {
      const t = (now - hit.at) / FLASH_MS;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 16 + t * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The dot: the agent's color, or a dark disc with a colored ring around the maker's logo.
    const logo = logos[agent.id];
    const withLogo = logo?.complete && logo.naturalWidth > 0;
    ctx.fillStyle = out ? "rgba(255,255,255,0.12)" : withLogo ? "#101216" : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = out ? 0 : 22;
    ctx.beginPath();
    ctx.arc(x, y, withLogo ? 16 : 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (withLogo) {
      ctx.strokeStyle = out ? "rgba(255,255,255,0.2)" : color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = out ? 0.35 : 1;
      ctx.drawImage(logo, x - 9, y - 9, 18, 18);
      ctx.globalAlpha = 1;
    }

    // Hit points as a row of pips on the inner side of the dot, where only shots pass.
    const inner = at(angle, radius - 28);
    for (let i = 0; i < START_HP; i++) {
      ctx.fillStyle = i < agent.hp ? color : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.arc(inner.x + (i - (START_HP - 1) / 2) * 9, inner.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // The label is centered over the dot in the top half, under it otherwise, so it stays inside the canvas.
    const spot = { x, y: y < center - radius * 0.3 ? y - 30 : y + 31 };
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = out ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)";
    ctx.font = "500 13px 'Geist Variable', system-ui, sans-serif";
    ctx.fillText(out ? `${labels[agent.id] ?? agent.id} (out)` : (labels[agent.id] ?? agent.id), spot.x, spot.y);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "11px 'Geist Mono Variable', ui-monospace, monospace";
  ctx.fillText(`TICK ${match.tick} / ${match.maxTicks}`, center, center - 26);
  if (match.quietTurns > 0 && !isOver(match)) ctx.fillText(`QUIET ${match.quietTurns} / ${match.stalemateTurns}`, center, center + 26);

  // The result, big, in the winner's color.
  if (isOver(match)) {
    const top = standings(match)[0]!;
    const draw = endReason(match) === "stalemate" || top.hp <= 0;
    ctx.fillStyle = draw ? "rgba(255,255,255,0.85)" : agentColors[top.id]!;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = draw ? 0 : 18;
    ctx.font = "600 22px 'Geist Variable', system-ui, sans-serif";
    ctx.fillText(draw ? "Draw" : `${labels[top.id] ?? top.id} wins`, center, center + 2);
    ctx.shadowBlur = 0;
  }
}
