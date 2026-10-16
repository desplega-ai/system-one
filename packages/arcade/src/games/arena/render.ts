// Draws the arena on a canvas: the circle, the shots of the last tick and the agents.
import { agentColors } from "../../web/ui/colors.ts";
import type { Match } from "./engine.ts";

/** Draws at `size` CSS pixels, sharp on high-density screens. */
export function drawArena(canvas: HTMLCanvasElement, match: Match, labels: Record<string, string>, size = 480) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const center = size / 2;
  const radius = size * 0.32;
  // Angle 0 is at the top. Clockwise adds degrees, as in the engine.
  const at = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  };
  const byId = new Map(match.agents.map((a) => [a.id, a]));

  ctx.strokeStyle = "#d8d6cf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();

  for (const shot of match.shots) {
    const from = at(byId.get(shot.from)!.angle);
    const to = at(byId.get(shot.to)!.angle);
    ctx.strokeStyle = shot.hit ? agentColors[shot.from]! : "#b5b2aa";
    ctx.lineWidth = shot.hit ? 3 : 1.5;
    ctx.setLineDash(shot.hit ? [] : [6, 6]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const agent of match.agents) {
    const { x, y } = at(agent.angle);
    const out = agent.hp <= 0;
    ctx.fillStyle = out ? "#cfcdc6" : agentColors[agent.id]!;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.fillText(out ? "x" : String(agent.hp), x, y);

    // Below the dot, so long model names stay inside the canvas on every side.
    ctx.fillStyle = out ? "#a9a69e" : "#1c1c1a";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(labels[agent.id] ?? agent.id, x, y + 30);
  }

  ctx.fillStyle = "#77756f";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(`tick ${match.tick} / ${match.maxTicks}`, center, center);
}
