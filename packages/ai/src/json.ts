// A JSON form of a decide call, so a browser can send one to a server.
import { AudioPart, audio } from "./audio.ts";
import { ImagePart, image } from "./image.ts";
import type { JsonObject, JsonValue, Question, Questions, State, StatePart } from "./types.ts";
import { isParts } from "./wire/shared.ts";

/** A call as plain JSON. Images and audio in the state become `{ "$image": dataUrl }` and `{ "$audio": dataUrl }`. */
export type JsonCall = { state: JsonValue; questions: Questions };

/** What `callFromJson()` accepts at most. Text counts the state and the questions, without images and audio. */
export const callLimits = { textChars: 32_000, images: 8, audio: 2, questions: 64 } as const;

export function callToJson(call: { state: State; questions: Questions }): JsonCall {
  if (!isParts(call.state)) return { state: call.state, questions: call.questions };
  const state = call.state.map((p): JsonValue => {
    if (p instanceof ImagePart) return { $image: p.dataUrl };
    if (p instanceof AudioPart) return { $audio: p.dataUrl };
    return p;
  });
  return { state, questions: call.questions };
}

/** Reads a call from untrusted JSON. Throws a TypeError that says what is wrong. */
export function callFromJson(json: unknown): { state: State; questions: Questions } {
  if (!isObject(json)) throw new TypeError("call: expected an object with state and questions");
  const questions = readQuestions(json.questions);
  const state = readState(json.state);

  const parts = isParts(state) ? state : [state];
  const isMedia = (p: StatePart) => p instanceof ImagePart || p instanceof AudioPart;
  const images = parts.filter((p) => p instanceof ImagePart).length;
  const clips = parts.filter((p) => p instanceof AudioPart).length;
  if (images > callLimits.images) throw new TypeError(`state: at most ${callLimits.images} images`);
  if (clips > callLimits.audio) throw new TypeError(`state: at most ${callLimits.audio} audio clips`);
  const textChars = parts
    .filter((p) => !isMedia(p))
    .reduce((sum, p) => sum + (typeof p === "string" ? p.length : JSON.stringify(p).length), JSON.stringify(questions).length);
  if (textChars > callLimits.textChars) throw new TypeError(`call: at most ${callLimits.textChars} characters of text`);

  return { state, questions };
}

function readState(value: unknown): State {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readPart);
  if (isObject(value)) return value as JsonObject;
  throw new TypeError("state: expected a string, an object or an array of parts");
}

function readPart(value: unknown): StatePart {
  if (typeof value === "string") return value;
  if (!isObject(value)) throw new TypeError("state: each part must be a string or an object");
  if (typeof value.$image === "string") return image(value.$image);
  if (typeof value.$audio === "string") return audio(value.$audio);
  return value as JsonObject;
}

function readQuestions(value: unknown): Questions {
  if (!isObject(value)) throw new TypeError("questions: expected an object of question id to question");
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > callLimits.questions) {
    throw new TypeError(`questions: expected 1 to ${callLimits.questions} questions`);
  }
  return Object.fromEntries(
    entries.map(([id, q]) => {
      if (!/^[\w.-]{1,100}$/.test(id)) throw new TypeError(`questions: "${id}" is not a valid id (letters, digits, _ . -)`);
      return [id, readQuestion(id, q)];
    }),
  );
}

function readQuestion(id: string, value: unknown): Question {
  if (!isObject(value) || typeof value.instructions !== "string") {
    throw new TypeError(`questions.${id}: expected an object with string instructions`);
  }
  const { instructions } = value;
  switch (value.type) {
    case "boolean": {
      const { yes, no } = value;
      if ((yes !== undefined && typeof yes !== "string") || (no !== undefined && typeof no !== "string")) {
        throw new TypeError(`questions.${id}: yes and no must be strings`);
      }
      return { type: "boolean", instructions, ...(yes !== undefined && { yes }), ...(no !== undefined && { no }) };
    }
    case "choice": {
      const options = value.options;
      if (!isObject(options) || Object.keys(options).length < 2) {
        throw new TypeError(`questions.${id}: a choice needs at least 2 options`);
      }
      if (Object.values(options).some((d) => d !== null && typeof d !== "string")) {
        throw new TypeError(`questions.${id}: option descriptions must be strings or null`);
      }
      return { type: "choice", instructions, options: options as Record<string, string | null> };
    }
    case "score": {
      const levels = value.levels;
      if (!Array.isArray(levels) || levels.length < 2 || levels.some((l) => typeof l !== "string")) {
        throw new TypeError(`questions.${id}: a score needs at least 2 string levels`);
      }
      return { type: "score", instructions, levels: levels as string[] };
    }
    default:
      throw new TypeError(`questions.${id}: type must be boolean, choice or score`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
