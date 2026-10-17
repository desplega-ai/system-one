import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "../src/web/lib/api.ts";
import { readSetup, type SetupAnswers, type SetupInput, setupCall } from "../src/web/lib/setup.ts";

const model = (key: string, label: string, provider: string): ModelInfo => ({ key, label, provider, inputs: ["text", "image"] });
const models = [
  model("cloudflare:clef-flash", "Clef Flash (Cloudflare)", "cloudflare"),
  model("typesafe:jev-latest", "Jev (TypeSafe)", "typesafe"),
  model("openai:gpt-6-luna", "GPT-6 Luna (OpenAI)", "openai"),
];
const input: SetupInput = {
  text: "all Jevs, real-time",
  models,
  slots: ["cloudflare:clef-flash", "openai:gpt-6-luna"],
  min: 2,
  max: 4,
  choices: { clock: { question: "Which clock?", options: { lockstep: "fair turns", realtime: "speed counts" }, current: "lockstep" } },
};
const sure = (choice: string) => ({ type: "choice" as const, choice, probabilities: { [choice]: 1 } });

describe("setup from a sentence", () => {
  test("the call asks how the models are picked, the count, each player and the game's choices, each with a way out", () => {
    const { state, questions } = setupCall(input);
    expect(Object.keys(questions)).toEqual(["players", "model", "count", "player1", "player2", "player3", "player4", "clock"]);
    expect(Object.keys(questions.count!.options)).toEqual(["2", "3", "4", "not_said"]);
    // Model options are short ids with readable descriptions.
    expect(questions.model!.options).toEqual({
      m0: "Clef Flash, served by Cloudflare",
      m1: "Jev, served by TypeSafe",
      m2: "GPT-6 Luna, served by OpenAI",
      not_said: "the request does not say",
    });
    expect(Object.keys(questions.clock!.options)).toEqual(["lockstep", "realtime", "not_said"]);
    // No current values: they pull the answers.
    expect(state).toEqual({ task: expect.any(String), request: "all Jevs, real-time", hints: expect.any(String) });
  });

  test("all the same model keeps the count when the request gives none", () => {
    const answers = { players: sure("same"), model: sure("m1"), count: sure("not_said"), clock: sure("realtime") } as SetupAnswers;
    expect(readSetup(input, answers)).toEqual({ slots: ["typesafe:jev-latest", "typesafe:jev-latest"], choices: { clock: "realtime" } });
  });

  test("models named one by one, with a count", () => {
    const answers = { players: sure("listed"), model: sure("not_said"), count: sure("3"), player1: sure("m2"), player2: sure("m0"), player3: sure("m0"), clock: sure("not_said") } as SetupAnswers;
    expect(readSetup(input, answers)).toEqual({ slots: ["openai:gpt-6-luna", "cloudflare:clef-flash", "cloudflare:clef-flash"], choices: { clock: "lockstep" } });
  });

  test("not said, refusals and unknown options keep the current values", () => {
    const answers = { players: sure("listed"), model: { type: "refusal" as const }, count: { type: "refusal" as const }, player1: sure("m9"), player2: sure("not_said"), clock: sure("warp") } as SetupAnswers;
    expect(readSetup(input, answers)).toEqual({ slots: ["cloudflare:clef-flash", "openai:gpt-6-luna"], choices: { clock: "lockstep" } });
  });
});
