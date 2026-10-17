// A setup from one sentence ("all Jevs", "Luna against two Clefs, real-time"), read by one of our own
// decision models. The model only picks from fixed options: a player count, a model per player, and the
// game's own choices. Pure, so the tests can check the questions and the reading.
import { type Answers, type ChoiceQuestion, type JsonObject, q } from "@system-one/ai";
import { hostByKey } from "../ui/brands.ts";
import { splitLabel } from "../ui/ModelName.tsx";
import type { ModelInfo } from "./api.ts";

/** One of the game's own choices, for example the clock: the question, the options and the current value. */
export type SetupChoice = { question: string; options: Record<string, string>; current: string };

export type SetupInput = {
  text: string;
  /** The models a player can be. */
  models: ModelInfo[];
  slots: string[];
  min: number;
  max: number;
  choices: Record<string, SetupChoice>;
};

/** Model option ids must be short words, so the models get "m0", "m1" in the order of `models`. */
const modelId = (i: number) => `m${i}`;
const describe = (m: ModelInfo) => {
  const { name } = splitLabel(m.label);
  return `${name}, served by ${hostByKey(m.provider)?.name ?? m.provider}`;
};
/** Every question has this way out, so a model never has to guess a value the request does not give. */
const NOT_SAID = "not_said";
const notSaid = { [NOT_SAID]: "the request does not say" };

/**
 * The call. It shows no current values: seen on 2026-10-17, with "keep the current model" and the current
 * models in the state, Jev kept 2 of 3 current models for "all Jevs". An explicit "not said" option works better.
 */
export function setupCall(input: SetupInput) {
  const { models, min, max, choices } = input;
  const modelOptions = Object.fromEntries(models.map((m, i) => [modelId(i), describe(m)]));
  const counts = Object.fromEntries(Array.from({ length: max - min + 1 }, (_, i) => [String(min + i), `${min + i} players`]));
  const questions: Record<string, ChoiceQuestion<string>> = {
    players: q.choice<string>("How does the request pick the models?", {
      same: "every player is the same model, for example \"all Jevs\", \"only Luna\" or \"4 Clef Flash\"",
      listed: "it names the models one by one, for example \"Luna against two Clefs\"",
      [NOT_SAID]: "it does not talk about models",
    }),
    model: q.choice<string>("If every player is the same model: which model?", { ...modelOptions, ...notSaid }),
    count: q.choice<string>("How many players does the request ask for? Count every model it names.", { ...counts, ...notSaid }),
    ...Object.fromEntries(
      Array.from({ length: max }, (_, i) => [`player${i + 1}`, q.choice<string>(`If the request names the models one by one: which model is player ${i + 1}?`, { ...modelOptions, ...notSaid })]),
    ),
    ...Object.fromEntries(Object.entries(choices).map(([key, c]) => [key, q.choice<string>(c.question, { ...c.options, ...notSaid })])),
  };
  const state: JsonObject = {
    task: "Read a request for a game setup, and answer what it asks for. When the request does not say something, answer \"not_said\".",
    request: input.text,
    hints: "Without a host in the request, pick a model on its maker's own host: Jev on TypeSafe, Clef on Cloudflare, GPT-6 Luna on OpenAI.",
  };
  return { state, questions };
}

export type SetupAnswers = Answers<ReturnType<typeof setupCall>["questions"]>;

/** The new slots and choices. "Not said", a refusal or an unknown option keeps the current value. */
export function readSetup(input: SetupInput, answers: SetupAnswers): { slots: string[]; choices: Record<string, string> } {
  const pick = (answer: SetupAnswers[string] | undefined, valid: (v: string) => boolean): string | undefined =>
    answer?.type === "choice" && answer.choice !== NOT_SAID && valid(answer.choice) ? answer.choice : undefined;
  const isModel = (v: string) => /^m\d+$/.test(v) && Number(v.slice(1)) < input.models.length;
  const keyOf = (id: string) => input.models[Number(id.slice(1))]!.key;

  const count = Number(pick(answers.count, (v) => Number(v) >= input.min && Number(v) <= input.max) ?? input.slots.length);
  const current = (i: number) => input.slots[i] ?? input.slots.at(-1) ?? input.models[0]!.key;
  const how = pick(answers.players, (v) => v === "same" || v === "listed");
  const same = how === "same" ? pick(answers.model, isModel) : undefined;
  const slots = Array.from({ length: count }, (_, i) => {
    if (same) return keyOf(same);
    const listed = how === "listed" ? pick(answers[`player${i + 1}`], isModel) : undefined;
    return listed ? keyOf(listed) : current(i);
  });
  const choices = Object.fromEntries(Object.entries(input.choices).map(([key, c]) => [key, pick(answers[key], (v) => v in c.options) ?? c.current]));
  return { slots, choices };
}
