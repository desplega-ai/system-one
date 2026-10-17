// Named arena setups that show something worth watching. Link one as #/arena/<id>.
// Models are not fully deterministic, so a preset repeats the setup and the seed, not always the match.
import { type Policy, STALEMATE_TURNS } from "./engine.ts";
import type { FieldId } from "./fields.ts";

export type Clock = "lockstep" | "realtime";

export type Preset = {
  id: string;
  emoji: string;
  name: string;
  /** What to watch for. "Seen" notes come from real matches. */
  description: string;
  models: string[];
  field: FieldId;
  clock: Clock;
  policy: Policy;
  seed: number;
  stalemateTurns: number;
};

/** Together they cover both fields, both clocks and both policies. */
export const presets: Preset[] = [
  {
    id: "standoff",
    emoji: "🤠",
    name: "The standoff",
    description:
      "Seen: both stay put and never fire, so the match ends in a draw after 10 quiet turns. Jev's P(fire) sits near 50%, so in real-time it sometimes breaks the standoff and wins.",
    models: ["cloudflare:clef", "typesafe:jev-latest"],
    field: "ring",
    clock: "lockstep",
    policy: "top",
    seed: 1,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "speed-duel",
    emoji: "⚡",
    name: "Speed duel",
    description:
      "Clef Flash against Clef in real-time. Seen: Clef Flash answers in about 180 ms against 340 ms, so it acts about 1.8 times as often.",
    models: ["cloudflare:clef-flash", "cloudflare:clef"],
    field: "ring",
    clock: "realtime",
    policy: "sample",
    seed: 3,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "trigger-happy",
    emoji: "🔫",
    name: "Trigger-happy Luna",
    description:
      "Seen: Clef and Jev stay put all match, and Luna fires from its first answer. OpenAI's first answers are slow (up to 12 s, then about 150 ms), so Luna acts far less often. In our run Jev won.",
    models: ["openai:gpt-6-luna", "cloudflare:clef", "typesafe:jev-latest"],
    field: "ring",
    clock: "realtime",
    policy: "top",
    seed: 2,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "luna-hosts",
    emoji: "🛰️",
    name: "One Luna, three hosts",
    description:
      "The same model through OpenAI, OpenRouter and AI Gateway, in real-time. Only the host differs. Seen in one match: OpenAI direct (230 ms) won, AI Gateway (250 ms) came second, OpenRouter (300 ms) fell first.",
    models: ["openai:gpt-6-luna", "openrouter:gpt-6-luna", "gateway:gpt-6-luna"],
    field: "ring",
    clock: "realtime",
    policy: "sample",
    seed: 4,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "free-for-all",
    emoji: "🎉",
    name: "Free for all",
    description: "Six different models on the ring, sampling from the probabilities.",
    models: [
      "openai:gpt-6-luna",
      "typesafe:jev-latest",
      "cloudflare:clef",
      "cloudflare:clef-flash",
      "cloudflare:clef-omni",
      "gateway:jev-1.14.0",
    ],
    field: "ring",
    clock: "lockstep",
    policy: "sample",
    seed: 6,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "mirror",
    emoji: "🪞",
    name: "Mirror match",
    description: "Jev against Jev on the plane, sampling from the probabilities. Same brain, so only the dice decide.",
    models: ["typesafe:jev-latest", "typesafe:jev-latest"],
    field: "plane",
    clock: "lockstep",
    policy: "sample",
    seed: 5,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "sniper-duel",
    emoji: "🎯",
    name: "Sniper duel",
    description:
      "Jev against GPT-6 Luna on the plane, each always doing its most likely action. Shots take a few ticks to fly: watch whether a model steps out of the way of a shot.",
    models: ["typesafe:jev-latest", "openai:gpt-6-luna"],
    field: "plane",
    clock: "lockstep",
    policy: "top",
    seed: 8,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "dodgeball",
    emoji: "🏐",
    name: "Dodgeball",
    description: "Four fast models on the plane in real-time. A fast model can dash away from a shot before it lands.",
    models: ["cloudflare:clef-flash", "typesafe:jev-latest", "openai:gpt-6-luna", "cloudflare:clef-omni"],
    field: "plane",
    clock: "realtime",
    policy: "sample",
    seed: 9,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "jev-swarm",
    emoji: "🐝",
    name: "Jev swarm",
    description: "Four Jevs on the plane in real-time: Jev direct twice, Jev through OpenRouter, and the older Jev 1.14 through AI Gateway.",
    models: ["typesafe:jev-latest", "typesafe:jev-latest", "openrouter:jev-latest", "gateway:jev-1.14.0"],
    field: "plane",
    clock: "realtime",
    policy: "sample",
    seed: 10,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "plane-brawl",
    emoji: "🌪️",
    name: "Plane brawl",
    description: "Six models on the plane in real-time, each always doing its most likely action. Crowded, so walls and other agents block many dashes.",
    models: [
      "openai:gpt-6-luna",
      "typesafe:jev-latest",
      "cloudflare:clef",
      "cloudflare:clef-flash",
      "cloudflare:clef-omni",
      "openrouter:jev-latest",
    ],
    field: "plane",
    clock: "realtime",
    policy: "top",
    seed: 12,
    stalemateTurns: STALEMATE_TURNS,
  },
];
