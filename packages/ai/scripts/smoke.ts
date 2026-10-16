// Live check: one text and one image decision per model, for every provider with credentials.
// Run with `bun run smoke`. Each call costs a fraction of a cent.
import {
  type Answer,
  cloudflare,
  type DecisionModel,
  gateway,
  image,
  openai,
  openrouter,
  q,
  type RefusalAnswer,
  typesafe,
  type Usage,
} from "../src/index.ts";

const has = (...names: string[]) => names.every((name) => process.env[name]);

const providers: { name: string; ready: boolean; models: () => DecisionModel[] }[] = [
  {
    name: "openrouter",
    ready: has("OPENROUTER_API_KEY"),
    models: () => [openrouter("~typesafe/jev-latest"), openrouter("cloudflare/clef-flash"), openrouter("openai/gpt-6-luna-decisions")],
  },
  { name: "openai", ready: has("OPENAI_API_KEY"), models: () => [openai("gpt-6-luna")] },
  {
    name: "cloudflare",
    ready: has("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"),
    models: () => [cloudflare("@cf/cloudflare/clef-flash")],
  },
  {
    name: "gateway",
    ready: has("AI_GATEWAY_API_KEY"),
    models: () => [gateway("typesafe-ai/jev-1.14.0"), gateway("openai/gpt-6-luna-decisions")],
  },
  { name: "typesafe", ready: has("TYPESAFE_API_KEY"), models: () => [typesafe("jev-latest")] },
];

const sprite = image(await Bun.file(`${import.meta.dir}/../test/fixtures/red-square.png`).bytes());

const textCall = {
  state: "The player holds a rusty key at a locked door. A guard sleeps nearby.",
  questions: {
    triesDoor: q.boolean("Is the player about to try the door?"),
    mood: q.choice("What is the tone?", ["tense", "calm", "funny"]),
    danger: q.score("How dangerous is the situation?", ["safe", "risky", "deadly"]),
  },
};

const imageCall = {
  state: ["Sprite from the level editor:", sprite],
  questions: {
    square: q.boolean("The sprite is a square shape."),
    color: q.choice("What color is the shape?", ["red", "green", "blue"]),
  },
};

const pct = (p: number) => `${Math.round(p * 100)}%`;
/** Prints a refusal instead of failing, so one refused question does not hide the other answers. */
const show = <A extends Answer>(a: A, text: (a: Exclude<A, RefusalAnswer>) => string) =>
  a.type === "refusal" ? `refused${a.reason ? ` (${a.reason})` : ""}` : text(a as Exclude<A, RefusalAnswer>);
const spend = (u: Usage) =>
  `${u.inputTokens} in / ${u.outputTokens} out, ${u.costUsd === undefined ? "cost unknown" : `$${u.costUsd.toFixed(7)} (${u.costSource})`}`;
let failed = false;
let totalUsd = 0;

for (const provider of providers) {
  if (!provider.ready) {
    console.log(`- ${provider.name}: skipped (no credentials)`);
    continue;
  }
  for (const model of provider.models()) {
    const label = `${provider.name} ${model.modelId}`;
    try {
      const t = await model.decide(textCall);
      const i = await model.decide(imageCall);
      const { triesDoor, mood, danger } = t.answers;
      const { square, color } = i.answers;
      totalUsd += (t.usage.costUsd ?? 0) + (i.usage.costUsd ?? 0);
      const text = [
        `triesDoor=${show(triesDoor, (a) => pct(a.probability))}`,
        `mood=${show(mood, (a) => a.choice)}`,
        `danger=${show(danger, (a) => `${a.level} (${a.score.toFixed(2)})`)}`,
      ];
      const pic = [
        `square=${show(square, (a) => pct(a.probability))}`,
        `color=${show(color, (a) => `${a.choice} (${pct(a.probabilities[a.choice])})`)}`,
      ];
      console.log(
        `✓ ${label}\n    text:  ${text.join(" ")}  [${spend(t.usage)}]\n    image: ${pic.join(" ")}  [${spend(i.usage)}]`,
      );
    } catch (error) {
      failed = true;
      console.log(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(`total: $${totalUsd.toFixed(7)}`);
process.exit(failed ? 1 : 0);
