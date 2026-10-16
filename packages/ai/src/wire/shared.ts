import { AudioPart } from "../audio.ts";
import { DecisionError } from "../errors.ts";
import type { Answer, Question, RefusalAnswer, State, StatePart } from "../types.ts";

/** What a codec hands back to the provider layer. */
export type Decoded = { answers: Record<string, Answer>; model: string };

// Untyped JSON from a provider. Codecs check each answer's type before they read it.
export type Raw = any;

export function isParts(state: State): state is readonly StatePart[] {
  return Array.isArray(state);
}

/** Throws for audio parts. Only the Cloudflare `images`/`audio` fields carry audio. */
export function rejectAudio(state: readonly StatePart[]): void {
  if (state.some((p) => p instanceof AudioPart)) throw new TypeError("audio input is supported only by Cloudflare Clef-Omni");
}

export function mapValues<T, U>(obj: { readonly [key: string]: T }, fn: (value: T, key: string) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, fn(value, key)]));
}

/** Returns a refusal answer when the raw answer is a refusal. */
export function refusal(raw: Raw): RefusalAnswer | undefined {
  if (raw?.type !== "refusal") return undefined;
  const reason = [raw.reason, raw.refusal, raw.message].find((r) => typeof r === "string");
  return reason === undefined ? { type: "refusal" } : { type: "refusal", reason };
}

/** Returns the raw answer for a question, or throws if it is missing or of the wrong type. */
export function rawAnswer(provider: string, raw: Raw, id: string, question: Question, wireType: string, body: unknown): Raw {
  if (raw?.type !== wireType) {
    throw new DecisionError("bad_response", provider, `no ${question.type} answer for "${id}"`, { questionId: id, body });
  }
  return raw;
}

export function mostLikely<L extends string>(levels: readonly L[], probabilities: readonly number[]): L {
  let best = 0;
  for (let i = 1; i < probabilities.length; i++) if (probabilities[i]! > probabilities[best]!) best = i;
  return levels[best]!;
}
