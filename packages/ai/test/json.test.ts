import { describe, expect, test } from "bun:test";
import { AudioPart, audio, callFromJson, callLimits, callToJson, image, ImagePart, q } from "../src/index.ts";

const png = image(await Bun.file(`${import.meta.dir}/fixtures/red-square.png`).bytes());
const clip = audio("data:audio/wav;base64,AAAA");
const questions = {
  fire: q.boolean("Fire?", { yes: "shoots now" }),
  move: q.choice("Move?", ["left", "stay", "right"]),
  danger: q.score("Danger?", ["low", "high"]),
};

describe("callToJson() and callFromJson()", () => {
  test("a call survives a round trip through JSON text", () => {
    const call = { state: ["Frames:", png, { hp: 3 }, clip], questions };
    const json = JSON.parse(JSON.stringify(callToJson(call)));
    expect(json.state[1]).toEqual({ $image: png.dataUrl });
    expect(json.state[3]).toEqual({ $audio: clip.dataUrl });

    const back = callFromJson(json);
    expect(back.questions).toEqual(questions);
    const state = back.state as unknown[];
    expect(state[0]).toBe("Frames:");
    expect(state[1]).toBeInstanceOf(ImagePart);
    expect((state[1] as ImagePart).dataUrl).toBe(png.dataUrl);
    expect(state[2]).toEqual({ hp: 3 });
    expect(state[3]).toBeInstanceOf(AudioPart);
  });

  test("plain text and JSON state pass through", () => {
    expect(callFromJson(callToJson({ state: "text", questions })).state).toBe("text");
    expect(callFromJson(callToJson({ state: { room: "cellar" }, questions })).state).toEqual({ room: "cellar" });
  });

  test("unknown keys on a question are dropped", () => {
    const { questions: read } = callFromJson({ state: "x", questions: { ok: { type: "boolean", instructions: "ok?", evil: 1 } } });
    expect(read.ok).toEqual({ type: "boolean", instructions: "ok?" });
  });
});

describe("callFromJson() rejects bad input", () => {
  const bad: [string, unknown, string][] = [
    ["not an object", "x", "expected an object"],
    ["no questions", { state: "x", questions: {} }, "1 to 64 questions"],
    ["bad id", { state: "x", questions: { "a b": { type: "boolean", instructions: "?" } } }, "not a valid id"],
    ["unknown type", { state: "x", questions: { a: { type: "box", instructions: "?" } } }, "type must be"],
    ["no instructions", { state: "x", questions: { a: { type: "boolean" } } }, "string instructions"],
    ["one option", { state: "x", questions: { a: { type: "choice", instructions: "?", options: { only: null } } } }, "at least 2 options"],
    ["bad description", { state: "x", questions: { a: { type: "choice", instructions: "?", options: { a: 1, b: null } } } }, "strings or null"],
    ["one level", { state: "x", questions: { a: { type: "score", instructions: "?", levels: ["only"] } } }, "at least 2 string levels"],
    ["bad state", { state: 3, questions }, "expected a string"],
    ["bad image", { state: [{ $image: "https://example.com/a.png" }], questions }, "data URL"],
    ["too much text", { state: "x".repeat(callLimits.textChars), questions }, "characters of text"],
    ["too many images", { state: Array(callLimits.images + 1).fill({ $image: png.dataUrl }), questions }, "images"],
    ["too many clips", { state: Array(callLimits.audio + 1).fill({ $audio: clip.dataUrl }), questions }, "audio clips"],
  ];
  for (const [name, json, message] of bad) {
    test(name, () => {
      expect(() => callFromJson(json)).toThrow(message);
    });
  }
});
