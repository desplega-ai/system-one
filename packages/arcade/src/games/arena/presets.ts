// Named arena setups that show something worth watching. Link one as #/arena/<id>.
// Models are not fully deterministic, so a preset repeats the setup and the seed, not always the match.
import { type Policy, STALEMATE_TURNS } from "./engine.ts";

export type Clock = "lockstep" | "realtime";

export type Preset = {
  id: string;
  name: string;
  /** What to watch for. "Seen" notes come from real matches. */
  description: string;
  models: string[];
  clock: Clock;
  policy: Policy;
  seed: number;
  stalemateTurns: number;
};

export const presets: Preset[] = [
  {
    id: "standoff",
    name: "The standoff",
    description:
      "Seen: both stay put and never fire, so the match ends in a draw after 10 quiet turns. Jev's P(fire) sits near 50%, so in real-time it sometimes breaks the standoff and wins.",
    models: ["cloudflare:clef", "typesafe:jev-latest"],
    clock: "lockstep",
    policy: "top",
    seed: 1,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "trigger-happy",
    name: "Trigger-happy Luna",
    description:
      "Seen: Clef and Jev stay put all match, and Luna fires from its first answer. OpenAI's first answers are slow (up to 12 s, then about 150 ms), so Luna acts far less often. In our run Jev won.",
    models: ["openai:gpt-6-luna", "cloudflare:clef", "typesafe:jev-latest"],
    clock: "realtime",
    policy: "top",
    seed: 2,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "speed-duel",
    name: "Speed duel",
    description:
      "Clef Flash against Clef in real-time. Seen: Clef Flash answers in about 180 ms against 340 ms, so it acts about 1.8 times as often.",
    models: ["cloudflare:clef-flash", "cloudflare:clef"],
    clock: "realtime",
    policy: "sample",
    seed: 3,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "luna-hosts",
    name: "One Luna, three hosts",
    description:
      "The same model through OpenAI, OpenRouter and AI Gateway, in real-time. Only the host differs. Seen in one match: OpenAI direct (230 ms) won, AI Gateway (250 ms) came second, OpenRouter (300 ms) fell first.",
    models: ["openai:gpt-6-luna", "openrouter:gpt-6-luna", "gateway:gpt-6-luna"],
    clock: "realtime",
    policy: "sample",
    seed: 4,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "mirror",
    name: "Mirror match",
    description: "Jev against Jev, sampling from the probabilities. Same brain, so only the dice decide.",
    models: ["typesafe:jev-latest", "typesafe:jev-latest"],
    clock: "lockstep",
    policy: "sample",
    seed: 5,
    stalemateTurns: STALEMATE_TURNS,
  },
  {
    id: "free-for-all",
    name: "Free for all",
    description: "Six different models, sampling from the probabilities.",
    models: [
      "openai:gpt-6-luna",
      "typesafe:jev-latest",
      "cloudflare:clef",
      "cloudflare:clef-flash",
      "cloudflare:clef-omni",
      "gateway:jev-1.14.0",
    ],
    clock: "lockstep",
    policy: "sample",
    seed: 6,
    stalemateTurns: STALEMATE_TURNS,
  },
];
