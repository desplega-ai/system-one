// Number and name formats shared by the Stats page and its live feed.

const counter = new Intl.NumberFormat("en");
export const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const count = (n: number) => counter.format(n);
/** Small amounts keep more digits: "$1.24", "$0.029", "$0.0035", "<$0.0001". */
export const money = (n: number) =>
  n === 0 || Number.isInteger(n) ? `$${n}` : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : n >= 0.0001 ? `$${n.toFixed(4)}` : "<$0.0001";
/** One call costs a fraction of a cent, so these keep 6 digits: "$0.000061". */
export const smallMoney = (n: number) => (n === 0 ? "$0" : n >= 0.01 ? money(n) : `$${n.toFixed(6)}`);
export const ms = (n: number | null) => (n === null ? "none" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
/** "24%", "2.9%", "<0.1%". */
export function percent(part: number, whole: number): string {
  const value = whole === 0 ? 0 : (part / whole) * 100;
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

/** "arena-realtime" becomes "Arena, ring" and "real-time". */
const gameNames: Record<string, string> = { arena: "Arena, ring", plane: "Arena, plane", attention: "Attention", setup: "Setup in words", voice: "Voice", other: "Other" };
const variantNames: Record<string, string> = { lockstep: "lockstep", realtime: "real-time", live: "webcam", still: "pictures", free: "free talk" };
export function gameLabel(game: string): { name: string; variant: string } {
  const [head = game, ...rest] = game.split("-");
  return { name: gameNames[head] ?? head, variant: rest.map((part) => variantNames[part] ?? part).join(" ") };
}
