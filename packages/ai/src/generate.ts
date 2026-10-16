// Text and image generation and transcription through the Vercel AI SDK. Plain string model ids
// go to AI Gateway, which reads AI_GATEWAY_API_KEY. Token counts are on `result.usage`.
export { generateImage, generateText, streamText, transcribe } from "ai";

/** Cheap AI Gateway models, checked 2026-10-16. Prices are USD per 1M tokens (input/output) or per image. */
export const cheapModels = {
  /** Free. Text only. It is a reasoning model, so short answers can still take ~1k output tokens. */
  freeText: "nvidia/nemotron-3.5-lightning-free",
  /** $0.029 / $0.03. Text only. */
  text: "mistral/mistral-nemo",
  /** $0.03 / $0.13. Reads images. */
  vision: "alibaba/qwen3.7-flash",
  /** $0.007 per image. */
  image: "recraft/recraft-v4.1-flash",
  /** $0.000028 per second of audio (about $0.10 per hour). Reads WAV, WebM and MP4. microsoft/mai-transcribe-2 costs the same but reads only WAV. */
  transcription: "spacexai/grok-stt",
} as const;

/**
 * The USD cost that AI Gateway reports for a call, or undefined for other providers.
 * Pass `result.providerMetadata`. For `streamText`, await it first.
 */
export function gatewayCostUsd(providerMetadata: Readonly<Record<string, unknown>> | undefined): number | undefined {
  const cost = (providerMetadata?.gateway as { cost?: unknown } | undefined)?.cost;
  return typeof cost === "string" || typeof cost === "number" ? Number(cost) : undefined;
}
