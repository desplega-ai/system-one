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
export const slotColor = (i: number) => Object.values(agentColors)[i % 6]!;
