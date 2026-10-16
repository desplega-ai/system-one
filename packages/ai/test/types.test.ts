// Compile-time checks for answer inference. `bun run typecheck` fails if they break.
import { expect, test } from "bun:test";
import { gatewayCostUsd, type generateImage, type generateText, type streamText } from "../src/generate.ts";
import { type DecideResult, q } from "../src/index.ts";

const questions = {
  open: q.boolean("Is the door open?"),
  mood: q.choice("Tone?", ["tense", "calm"]),
  item: q.choice("Which item?", { key: "opens doors", torch: null }),
  danger: q.score("Danger?", ["safe", "risky", "deadly"]),
};

declare const result: DecideResult<typeof questions>;

function checks() {
  const { open, mood, item, danger } = result.answers;

  // @ts-expect-error any answer can be a refusal, so read it after a type check
  open.probability;
  if (open.type === "refusal" || mood.type === "refusal" || item.type === "refusal" || danger.type === "refusal") {
    const reason: string | undefined = open.type === "refusal" ? open.reason : undefined;
    return [reason];
  }

  const p: number = open.probability;
  const choice: "tense" | "calm" = mood.choice;
  const itemChoice: "key" | "torch" = item.choice;
  const keyChance: number = item.probabilities.key;
  const level: "safe" | "risky" | "deadly" = danger.level;

  // @ts-expect-error not an option
  mood.choice === "funny";
  // @ts-expect-error not a question id
  result.answers.missing;
  // @ts-expect-error choices need at least two options
  q.choice("One?", ["only"]);
  // @ts-expect-error scores need at least two levels
  q.score("One?", ["only"]);

  const tokens: number = result.usage.totalTokens;
  const cost: number | undefined = result.usage.costUsd;

  return [p, choice, itemChoice, keyChance, level, tokens, cost];
}

// gatewayCostUsd() accepts the provider metadata of every AI SDK result it is meant for.
declare const text: Awaited<ReturnType<typeof generateText>>;
declare const stream: ReturnType<typeof streamText>;
declare const picture: Awaited<ReturnType<typeof generateImage>>;
async function generationChecks() {
  return [gatewayCostUsd(text.providerMetadata), gatewayCostUsd(await stream.providerMetadata), gatewayCostUsd(picture.providerMetadata)];
}

test("type checks compile", () => {
  expect([typeof checks, typeof generationChecks]).toEqual(["function", "function"]);
});
