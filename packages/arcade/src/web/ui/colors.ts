/** One color per player, bright enough for the dark theme. The arena and the attention game use the names as
 * player ids, in this order. The models never see these values. */
export const agentColors: Record<string, string> = {
  red: "#ff5d52",
  blue: "#4f8cff",
  green: "#34d27b",
  yellow: "#ffc53d",
  purple: "#a970ff",
  orange: "#ff8c42",
};

/** The color of player slot `i`, in the same order as the player ids. */
export function slotColor(i: number): string {
  const known = Object.values(agentColors)[i];
  if (known) return known;
  const hue = ((i * 137.508) % 360) / 60;
  const chroma = 0.665;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const rgb = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue)]!;
  return `#${rgb.map((value) => Math.round((value + 0.285) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export const agentColor = (id: string): string => agentColors[id] ?? slotColor(Number(id.slice("player".length)) - 1);
