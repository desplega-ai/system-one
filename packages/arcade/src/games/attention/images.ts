// The preset images: square scenes with small details to be curious about.
// scripts/attention-images.ts generates the JPEGs from these prompts.

export type AttentionImage = { id: string; name: string; prompt: string };

const style = "Square image, photorealistic, sharp detail everywhere, no text, no watermark.";

export const attentionImages: AttentionImage[] = [
  {
    id: "attic",
    name: "Attic",
    prompt: `A dusty attic full of old objects: trunks, a rocking horse, framed paintings, lamps, boxes of letters. A small gray cat hides in a far corner, half in shadow. ${style}`,
  },
  {
    id: "market",
    name: "Market",
    prompt: `A busy open-air market seen from above: fruit stalls, awnings, crowds of people, carts. One person in the crowd holds a bright red umbrella. ${style}`,
  },
  {
    id: "wizard-desk",
    name: "Wizard's desk",
    prompt: `A cluttered wizard's desk: old maps, potion bottles, candles, quills, a brass telescope, open books. A tiny green dragon sleeps between two books. ${style}`,
  },
  {
    id: "forest-floor",
    name: "Forest floor",
    prompt: `A close view of a forest floor: moss, fallen leaves, mushrooms, pine cones, a beetle on a twig. A lost gold ring lies half under a leaf. ${style}`,
  },
  {
    id: "night-skyline",
    name: "Night skyline",
    prompt: `A city skyline at night with hundreds of lit windows. In one small window, a person in an astronaut suit waters a plant. ${style}`,
  },
  {
    id: "empty-room",
    name: "Empty room",
    prompt: `A large, empty, white room with a wooden floor and soft daylight. In one lower corner there is a very small door, about the size of a mouse. ${style}`,
  },
];
