// The OpenAI Decisions format (OpenAI, Vercel AI Gateway): questions as a named list, state as `input`.
import { ImagePart } from "../image.ts";
import type { ReportedUsage } from "../pricing.ts";
import type { Answer, Question, Questions, State } from "../types.ts";
import { type Decoded, isParts, mapValues, mostLikely, type Raw, rawAnswer, refusal, rejectAudio } from "./shared.ts";

export function encodeOpenAI(state: State, questions: Questions) {
  return {
    input: encodeInput(state),
    questions: Object.entries(questions).map(([name, question]) => encodeQuestion(name, question)),
  };
}

function encodeInput(state: State) {
  if (typeof state === "string") return state;
  if (!isParts(state)) return JSON.stringify(state);
  rejectAudio(state);
  const content = state.map((p) => {
    if (typeof p === "string") return { type: "input_text", text: p };
    if (p instanceof ImagePart) return { type: "input_image", image_url: p.dataUrl };
    return { type: "input_text", text: JSON.stringify(p) };
  });
  return [{ role: "user", content }];
}

function encodeQuestion(name: string, question: Question) {
  switch (question.type) {
    case "boolean": {
      // Predicates take no criteria, so the yes/no meanings go into the instructions.
      const lines = [question.instructions];
      if (question.yes !== undefined) lines.push(`Yes means: ${question.yes}`);
      if (question.no !== undefined) lines.push(`No means: ${question.no}`);
      return { type: "predicate", name, instructions: lines.join("\n") };
    }
    case "choice":
      return {
        type: "choice",
        name,
        instructions: question.instructions,
        choices: Object.entries(question.options).map(([value, description]) =>
          description === null ? { value } : { value, description },
        ),
      };
    case "score":
      return { type: "score", name, instructions: question.instructions, levels: question.levels.map((label) => ({ label })) };
  }
}

export function decodeOpenAI(provider: string, body: Raw, questions: Questions): Decoded {
  const byName = new Map<string, Raw>((Array.isArray(body?.answers) ? body.answers : []).map((a: Raw) => [a?.name, a]));
  const answers = mapValues(questions, (question, id): Answer => {
    const raw = byName.get(id);
    const refused = refusal(raw);
    if (refused) return refused;
    const wireType = question.type === "boolean" ? "predicate" : question.type;
    const a = rawAnswer(provider, raw, id, question, wireType, body);
    switch (question.type) {
      case "boolean":
        return { type: "boolean" as const, probability: a.probability };
      case "choice":
        return {
          type: "choice" as const,
          choice: a.choice,
          probabilities: Object.fromEntries((a.probabilities ?? []).map((p: Raw) => [p.value, p.probability])),
          confidence: a.confidence,
        };
      case "score": {
        const probabilities = question.levels.map(
          (_, i) => (a.probabilities ?? []).find((p: Raw) => p.value === i)?.probability ?? 0,
        );
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

/** AI Gateway adds the cost as a string in `provider_metadata.gateway.cost`. OpenAI reports tokens only. */
export function openAIUsage(body: Raw): ReportedUsage {
  const gatewayCost = body?.provider_metadata?.gateway?.cost;
  return {
    inputTokens: body?.usage?.input_tokens,
    outputTokens: body?.usage?.output_tokens,
    costUsd: gatewayCost === undefined ? undefined : Number(gatewayCost),
  };
}
