import type { AudioPart } from "./audio.ts";
import type { ImagePart } from "./image.ts";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** What the model looks at: text, JSON, or an ordered mix of text, JSON, images and audio. */
export type State = string | JsonObject | readonly StatePart[];
/** Audio works only on Cloudflare Clef-Omni. */
export type StatePart = string | JsonObject | ImagePart | AudioPart;

export type BooleanQuestion = {
  readonly type: "boolean";
  readonly instructions: string;
  /** What a yes means. */
  readonly yes?: string;
  /** What a no means. */
  readonly no?: string;
};

export type ChoiceQuestion<K extends string = string> = {
  readonly type: "choice";
  readonly instructions: string;
  /** Option id to an optional description. */
  readonly options: { readonly [P in K]: string | null };
};

export type ScoreQuestion<L extends string = string> = {
  readonly type: "score";
  readonly instructions: string;
  /** Ordered levels, lowest first. */
  readonly levels: readonly L[];
};

export type Question = BooleanQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = { readonly [id: string]: Question };

export type BooleanAnswer = {
  type: "boolean";
  /** Probability that the answer is yes. */
  probability: number;
};

export type ChoiceAnswer<K extends string = string> = {
  type: "choice";
  /** The most probable option. */
  choice: K;
  probabilities: Record<K, number>;
  confidence?: number;
};

export type ScoreAnswer<L extends string = string> = {
  type: "score";
  /** Probability-weighted level index. Can land between levels. */
  score: number;
  /** The most probable level. */
  level: L;
  /** One probability per level, in level order. */
  probabilities: number[];
  confidence?: number;
};

/** The model declined to answer this question. The other answers in the call still count. */
export type RefusalAnswer = {
  type: "refusal";
  /** The model's reason, when the provider gives one. */
  reason?: string;
};

export type Answer = BooleanAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer;

/** Check `type` first: any answer can be a refusal. */
export type AnswerFor<Q extends Question> =
  | (Q extends ChoiceQuestion<infer K> ? ChoiceAnswer<K> : Q extends ScoreQuestion<infer L> ? ScoreAnswer<L> : BooleanAnswer)
  | RefusalAnswer;

export type Answers<Qs extends Questions> = { -readonly [Id in keyof Qs]: AnswerFor<Qs[Id]> };

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD for this call. Undefined when the provider reports no cost and the model has no list price. */
  costUsd: number | undefined;
  /**
   * - "provider": the provider reported the cost (OpenRouter, AI Gateway).
   * - "list-price": computed from input tokens and the list price in pricing.ts (OpenAI, Cloudflare, TypeSafe).
   */
  costSource: "provider" | "list-price" | undefined;
};

export type DecideCall<Qs extends Questions> = {
  state: State;
  questions: Qs;
  signal?: AbortSignal;
};

export type DecideResult<Qs extends Questions> = {
  answers: Answers<Qs>;
  /** The model that answered, as reported by the provider. */
  model: string;
  usage: Usage;
  /** The provider's response body, for debugging. */
  raw: unknown;
};

export type DecisionModel = {
  readonly provider: string;
  readonly modelId: string;
  decide<const Qs extends Questions>(call: DecideCall<Qs>): Promise<DecideResult<Qs>>;
};
