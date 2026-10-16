// The System One format (TypeSafe, OpenRouter, Cloudflare): questions keyed by id, state as JSON.
import { AudioPart } from "../audio.ts";
import { ImagePart } from "../image.ts";
import type { ReportedUsage } from "../pricing.ts";
import type { Answer, Question, Questions, State } from "../types.ts";
import { type Decoded, isParts, mapValues, mostLikely, type Raw, rawAnswer, refusal, rejectAudio } from "./shared.ts";

/**
 * Where images go. Each host differs:
 * - "parts": `image_url` parts inside the state array (OpenRouter)
 * - "field": top-level `images` and `audio` arrays of data URLs (Cloudflare). The only placement with audio.
 * - "assets": a top-level `assets` map, referenced by key from the state (TypeSafe)
 */
export type ImagePlacement = "parts" | "field" | "assets";

export function encodeSystemOne(state: State, questions: Questions, images: ImagePlacement) {
  return { ...encodeState(state, images), questions: mapValues(questions, encodeQuestion) };
}

function encodeState(state: State, images: ImagePlacement) {
  if (!isParts(state)) return { state };
  if (images !== "field") rejectAudio(state);
  switch (images) {
    case "parts":
      return {
        state: state.map((p) => (p instanceof ImagePart ? { type: "image_url", image_url: { url: p.dataUrl } } : p)),
      };
    case "field": {
      const urls = state.filter((p) => p instanceof ImagePart).map((p) => p.dataUrl);
      const clips = state.filter((p) => p instanceof AudioPart).map((p) => p.dataUrl);
      return {
        state: state.filter((p) => !(p instanceof ImagePart || p instanceof AudioPart)),
        ...(urls.length > 0 && { images: urls }),
        ...(clips.length > 0 && { audio: clips }),
      };
    }
    case "assets": {
      const assets: Record<string, { type: "image"; format: string; data_base64: string }> = {};
      const parts = state.map((p) => {
        if (!(p instanceof ImagePart)) return p;
        const ref = `image-${crypto.randomUUID()}`;
        assets[ref] = { type: "image", format: p.mediaType.slice("image/".length), data_base64: p.base64 };
        return ref;
      });
      return { state: parts, ...(Object.keys(assets).length > 0 && { assets }) };
    }
  }
}

function encodeQuestion(question: Question) {
  switch (question.type) {
    case "boolean": {
      const criteria = {
        ...(question.yes !== undefined && { true: question.yes }),
        ...(question.no !== undefined && { false: question.no }),
      };
      return { type: "noul", instructions: question.instructions, ...(Object.keys(criteria).length > 0 && { criteria }) };
    }
    case "choice":
      return { type: "choice", instructions: question.instructions, criteria: question.options };
    case "score":
      return { type: "score", instructions: question.instructions, criteria: question.levels };
  }
}

export function decodeSystemOne(provider: string, body: Raw, questions: Questions): Decoded {
  const answers = mapValues(questions, (question, id): Answer => {
    const raw = body?.answers?.[id];
    const refused = refusal(raw);
    if (refused) return refused;
    const wireType = question.type === "boolean" ? "noul" : question.type;
    const a = rawAnswer(provider, raw, id, question, wireType, body);
    switch (question.type) {
      case "boolean":
        return { type: "boolean" as const, probability: a.noul };
      case "choice":
        return { type: "choice" as const, choice: a.choice, probabilities: a.probabilities, confidence: a.confidence };
      case "score": {
        const probabilities = question.levels.map((_, i) => a.probabilities?.[String(i)] ?? 0);
        return {
          type: "score" as const,
          score: a.score,
          level: mostLikely(question.levels, probabilities),
          probabilities,
          confidence: a.confidence,
        };
      }
    }
  });
  return { answers, model: body?.model };
}

/** OpenRouter adds `usage.cost`. TypeSafe and Cloudflare report tokens only. */
export function systemOneUsage(body: Raw): ReportedUsage {
  return { inputTokens: body?.usage?.input_tokens, outputTokens: body?.usage?.output_tokens, costUsd: body?.usage?.cost };
}
