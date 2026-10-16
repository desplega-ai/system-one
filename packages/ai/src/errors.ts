import type { Usage } from "./types.ts";

export type DecisionErrorCode =
  /** The provider returned a non-2xx status. */
  | "http"
  /** No API key or account id was passed or found in the environment. */
  | "missing_credentials"
  /** The response did not have the expected shape. */
  | "bad_response";

export class DecisionError extends Error {
  override readonly name = "DecisionError";

  constructor(
    readonly code: DecisionErrorCode,
    readonly provider: string,
    message: string,
    readonly details: {
      status?: number;
      questionId?: string;
      body?: unknown;
      /** Set when the provider answered (and billed the call) but the answers could not be used. */
      usage?: Usage;
    } = {},
  ) {
    super(`[${provider}] ${message}`);
  }
}
