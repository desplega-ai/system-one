import type { BooleanQuestion, ChoiceQuestion, ScoreQuestion } from "./types.ts";

/** Question builders. Option ids and level names flow into the answer types. */
export const q = {
  /** A yes/no question. The answer is the probability of yes. */
  boolean(instructions: string, criteria: { yes?: string; no?: string } = {}): BooleanQuestion {
    return { type: "boolean", instructions, ...criteria };
  },

  /** Pick one option. Pass ids, or ids mapped to descriptions. */
  choice<const K extends string>(
    instructions: string,
    options: readonly [K, K, ...K[]] | { readonly [P in K]: string | null },
  ): ChoiceQuestion<K> {
    const map = Array.isArray(options)
      ? Object.fromEntries(options.map((id) => [id, null]))
      : (options as ChoiceQuestion<K>["options"]);
    return { type: "choice", instructions, options: map as ChoiceQuestion<K>["options"] };
  },

  /** Rate on ordered levels, lowest first. */
  score<const L extends string>(instructions: string, levels: readonly [L, L, ...L[]]): ScoreQuestion<L> {
    return { type: "score", instructions, levels };
  },
};
