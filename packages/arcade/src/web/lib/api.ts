// Typed client for the arcade API. Games call the server, never a provider.
import {
  type Answers,
  type AudioPart,
  callToJson,
  type DecideCall,
  type JsonValue,
  type Questions,
  type Usage,
} from "@system-one/ai";

export type Input = "text" | "image" | "audio";
export type ModelInfo = { key: string; label: string; inputs: Input[]; provider: string };
export type Decision<Qs extends Questions> = { answers: Answers<Qs>; usage: Usage; latencyMs: number; model: string };
export type Transcription = { text: string; language: string | undefined; usage: Usage; latencyMs: number };
export type Generation = { text: string; usage: Usage; latencyMs: number };
export type Score = { model: string; metric: string; value: number };
export type RankingRow = { model: string; metric: string; rows: number; mean: number; sum: number };
export type BudgetInfo = {
  dailyUsd?: number;
  providers: Record<string, number>;
  spent: { total: number; byProvider: Record<string, number> };
};

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "http", json?.error?.message ?? res.statusText);
  return json as T;
}

export const api = {
  models: () => request<ModelInfo[]>("/api/models"),

  /** Call this from a click handler, not an effect: dev StrictMode runs effects twice. */
  createRun: async (game: string, config: JsonValue) => (await request<{ id: string }>("/api/runs", { game, config })).id,

  decide: <const Qs extends Questions>(model: string, runId: string, call: DecideCall<Qs>) =>
    request<Decision<Qs>>("/api/decide", { runId, model, call: callToJson(call) }, call.signal),

  transcribe: (runId: string, clip: AudioPart, signal?: AbortSignal) =>
    request<Transcription>("/api/transcribe", { runId, audio: clip.dataUrl }, signal),

  /** Short text from the cheap text model. Use it only where a decision cannot give the answer. */
  generate: (runId: string, input: { system?: string; prompt: string }, signal?: AbortSignal) =>
    request<Generation>("/api/generate", { runId, ...input }, signal),

  addScores: (runId: string, scores: Score[]) => request<{ added: number }>(`/api/runs/${runId}/scores`, { scores }),

  rankings: (game: string) => request<RankingRow[]>(`/api/rankings?game=${encodeURIComponent(game)}`),

  budget: () => request<BudgetInfo>("/api/budget"),
};
