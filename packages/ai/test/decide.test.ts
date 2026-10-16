import { afterEach, describe, expect, mock, test } from "bun:test";
import { gatewayCostUsd } from "../src/generate.ts";
import { audio, cloudflare, DecisionError, gateway, image, openai, openrouter, q, typesafe } from "../src/index.ts";

const png = image(await Bun.file(`${import.meta.dir}/fixtures/red-square.png`).bytes());

const questions = {
  locked: q.boolean("Is the door locked?", { yes: "it does not open", no: "it opens" }),
  mood: q.choice("What is the tone?", { tense: "high stakes", calm: null }),
  danger: q.score("How dangerous is it?", ["safe", "risky", "deadly"]),
};

type Captured = { url: string; headers: Record<string, string>; body: any };

/** Replaces fetch with one that records the request and returns `reply`. */
function fakeFetch(reply: unknown, status = 200): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const systemOneReply = {
  model: "typesafe/jev-1.14-20261014",
  answers: {
    locked: { type: "noul", noul: 0.9 },
    mood: { type: "choice", choice: "tense", probabilities: { tense: 0.7, calm: 0.3 }, confidence: 0.6 },
    danger: { type: "score", score: 1.2, legend: { 0: "safe", 1: "risky", 2: "deadly" }, probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 }, confidence: 0.5 },
  },
  usage: { input_tokens: 300, output_tokens: 20, cost: 0.00001 },
};

/** Cloudflare and TypeSafe report tokens but no cost. */
const tokensOnlyReply = { ...systemOneReply, usage: { input_tokens: 300, output_tokens: 20 } };

const openAIReply = {
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "locked", probability: 0.9 },
    { type: "choice", name: "mood", choice: "tense", probabilities: [{ value: "tense", probability: 0.7 }, { value: "calm", probability: 0.3 }], confidence: 0.6 },
    { type: "score", name: "danger", score: 1.2, probabilities: [{ value: 0, label: "safe", probability: 0.1 }, { value: 1, label: "risky", probability: 0.6 }, { value: 2, label: "deadly", probability: 0.3 }], confidence: 0.5 },
  ],
  usage: { input_tokens: 385, output_tokens: 0, total_tokens: 385 },
};

const expectedAnswers = {
  locked: { type: "boolean", probability: 0.9 },
  mood: { type: "choice", choice: "tense", probabilities: { tense: 0.7, calm: 0.3 }, confidence: 0.6 },
  danger: { type: "score", score: 1.2, level: "risky", probabilities: [0.1, 0.6, 0.3], confidence: 0.5 },
};

describe("openrouter", () => {
  test("sends System One questions with images as image_url parts", async () => {
    const calls = fakeFetch({ ...systemOneReply, id: "gen-dec-1", provider: "TypeSafe" });
    const result = await openrouter("~typesafe/jev-latest", { apiKey: "k" }).decide({
      state: ["A sprite:", png, { hp: 3 }],
      questions,
    });

    expect(calls[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls[0]!.headers.Authorization).toBe("Bearer k");
    expect(calls[0]!.body).toEqual({
      model: "~typesafe/jev-latest",
      state: ["A sprite:", { type: "image_url", image_url: { url: png.dataUrl } }, { hp: 3 }],
      questions: {
        locked: { type: "noul", instructions: "Is the door locked?", criteria: { true: "it does not open", false: "it opens" } },
        mood: { type: "choice", instructions: "What is the tone?", criteria: { tense: "high stakes", calm: null } },
        danger: { type: "score", instructions: "How dangerous is it?", criteria: ["safe", "risky", "deadly"] },
      },
    });
    expect(result.answers).toEqual(expectedAnswers as typeof result.answers);
    expect(result.model).toBe("typesafe/jev-1.14-20261014");
    expect(result.usage).toEqual({
      inputTokens: 300,
      outputTokens: 20,
      totalTokens: 320,
      costUsd: 0.00001,
      costSource: "provider",
    });
  });

  test("leaves out noul criteria when none are given", async () => {
    const calls = fakeFetch({ model: "m", answers: { ok: { type: "noul", noul: 0.2 } } });
    await openrouter("liquid/d1", { apiKey: "k" }).decide({ state: "text", questions: { ok: q.boolean("ok?") } });
    expect(calls[0]!.body.questions.ok).toEqual({ type: "noul", instructions: "ok?" });
  });
});

describe("openai", () => {
  test("sends a named question list and user message parts", async () => {
    const calls = fakeFetch(openAIReply);
    const result = await openai("gpt-6-luna", { apiKey: "k" }).decide({ state: ["A sprite:", png, { hp: 3 }], questions });

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/decisions");
    expect(calls[0]!.body).toEqual({
      model: "gpt-6-luna",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "A sprite:" },
            { type: "input_image", image_url: png.dataUrl },
            { type: "input_text", text: '{"hp":3}' },
          ],
        },
      ],
      questions: [
        { type: "predicate", name: "locked", instructions: "Is the door locked?\nYes means: it does not open\nNo means: it opens" },
        { type: "choice", name: "mood", instructions: "What is the tone?", choices: [{ value: "tense", description: "high stakes" }, { value: "calm" }] },
        { type: "score", name: "danger", instructions: "How dangerous is it?", levels: [{ label: "safe" }, { label: "risky" }, { label: "deadly" }] },
      ],
    });
    expect(result.answers).toEqual(expectedAnswers as typeof result.answers);
    // OpenAI reports no cost, so it comes from the list price: 385 tokens at $0.10 per 1M.
    expect(result.usage).toMatchObject({ inputTokens: 385, outputTokens: 0, totalTokens: 385, costSource: "list-price" });
    expect(result.usage.costUsd).toBeCloseTo(0.0000385, 12);
  });

  test("sends plain text and JSON state as a string", async () => {
    const calls = fakeFetch({ model: "m", answers: [{ type: "predicate", name: "ok", probability: 1 }] });
    const model = openai("gpt-6-luna", { apiKey: "k" });
    await model.decide({ state: "text", questions: { ok: q.boolean("ok?") } });
    await model.decide({ state: { room: "cellar" }, questions: { ok: q.boolean("ok?") } });
    expect(calls.map((c) => c.body.input)).toEqual(["text", '{"room":"cellar"}']);
  });
});

describe("cloudflare", () => {
  test("puts images in the images field and unwraps result", async () => {
    const calls = fakeFetch({ result: { ...tokensOnlyReply, model: "clef-flash" }, success: true, errors: [] });
    const result = await cloudflare("@cf/cloudflare/clef-flash", { apiKey: "t", accountId: "acc" }).decide({
      state: ["A sprite:", png],
      questions,
    });

    expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef-flash");
    expect(calls[0]!.headers.Authorization).toBe("Bearer t");
    expect(calls[0]!.body.model).toBe("clef-flash");
    expect(calls[0]!.body.state).toEqual(["A sprite:"]);
    expect(calls[0]!.body.images).toEqual([png.dataUrl]);
    expect(result.answers).toEqual(expectedAnswers as typeof result.answers);
    // 300 tokens at the Clef Flash list price of $0.038 per 1M.
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 20, totalTokens: 320, costSource: "list-price" });
    expect(result.usage.costUsd).toBeCloseTo(0.0000114, 12);
  });

  test("a model without a list price has no cost", async () => {
    fakeFetch({ result: tokensOnlyReply, success: true, errors: [] });
    const result = await cloudflare("@cf/acme/new-model", { apiKey: "t", accountId: "acc" }).decide({ state: "x", questions });
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 20, totalTokens: 320, costUsd: undefined, costSource: undefined });
  });
});

describe("gateway", () => {
  test("uses the OpenAI format and reads the gateway cost", async () => {
    const calls = fakeFetch({ ...openAIReply, provider_metadata: { gateway: { cost: "0.0000096" } } });
    const result = await gateway("typesafe-ai/jev", { apiKey: "g" }).decide({ state: "text", questions });

    expect(calls[0]!.url).toBe("https://ai-gateway.vercel.sh/v1/decisions");
    expect(calls[0]!.body.model).toBe("typesafe-ai/jev");
    expect(calls[0]!.body.questions[0].type).toBe("predicate");
    expect(result.usage).toEqual({
      inputTokens: 385,
      outputTokens: 0,
      totalTokens: 385,
      costUsd: 0.0000096,
      costSource: "provider",
    });
  });
});

describe("typesafe", () => {
  test("sends images as referenced assets with the opt-in header", async () => {
    const calls = fakeFetch(tokensOnlyReply);
    const result = await typesafe("jev-latest", { apiKey: "ts" }).decide({ state: ["A sprite:", png], questions });

    const { url, headers, body } = calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(headers["TypeSafe-Danger-Zone-Images"]).toBe("true");
    const ref = body.state[1];
    expect(ref).toStartWith("image-");
    expect(body.assets).toEqual({ [ref]: { type: "image", format: "png", data_base64: png.base64 } });
    // 300 tokens at the Jev list price of $0.042 per 1M.
    expect(result.usage).toMatchObject({ totalTokens: 320, costSource: "list-price" });
    expect(result.usage.costUsd).toBeCloseTo(0.0000126, 12);
  });

  test("leaves the image header off for text-only state", async () => {
    const calls = fakeFetch(systemOneReply);
    await typesafe("jev-latest", { apiKey: "ts" }).decide({ state: "text", questions });
    expect(calls[0]!.headers["TypeSafe-Danger-Zone-Images"]).toBeUndefined();
    expect(calls[0]!.body.assets).toBeUndefined();
  });
});

describe("errors", () => {
  test("non-2xx responses throw an http DecisionError with the provider message", async () => {
    fakeFetch({ error: { message: "Unknown parameter: 'questions[0].criteria'.", code: "unknown_parameter" } }, 400);
    const error = await openai("gpt-6-luna", { apiKey: "k" }).decide({ state: "x", questions }).catch((e) => e);
    expect(error).toBeInstanceOf(DecisionError);
    expect(error.code).toBe("http");
    expect(error.details.status).toBe(400);
    expect(error.message).toBe("[openai] 400 Unknown parameter: 'questions[0].criteria'.");
  });

  test("Cloudflare error lists are read", async () => {
    fakeFetch({ success: false, errors: [{ code: 7003, message: "No route for that URI" }] }, 404);
    const error = await cloudflare("@cf/cloudflare/clef", { apiKey: "t", accountId: "a" })
      .decide({ state: "x", questions })
      .catch((e) => e);
    expect(error.message).toBe("[cloudflare] 404 No route for that URI");
  });

  test("a missing answer throws bad_response and keeps the usage of the billed call", async () => {
    fakeFetch({ model: "m", answers: { locked: systemOneReply.answers.locked }, usage: systemOneReply.usage });
    const error = await openrouter("liquid/d1", { apiKey: "k" }).decide({ state: "x", questions }).catch((e) => e);
    expect(error.code).toBe("bad_response");
    expect(error.details.questionId).toBe("mood");
    expect(error.details.usage).toMatchObject({ inputTokens: 300, costUsd: 0.00001 });
  });

  test("a missing key throws before any request", async () => {
    const calls = fakeFetch(systemOneReply);
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const error = await openrouter("liquid/d1").decide({ state: "x", questions }).catch((e) => e);
      expect(error.code).toBe("missing_credentials");
      expect(error.message).toContain("OPENROUTER_API_KEY");
      expect(calls).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    }
  });
});

describe("refusals", () => {
  test("an OpenAI refusal is an answer, and the other answers stay", async () => {
    fakeFetch({ ...openAIReply, answers: [{ type: "refusal", name: "locked", refusal: "off topic" }, ...openAIReply.answers.slice(1)] });
    const { answers } = await openai("gpt-6-luna", { apiKey: "k" }).decide({ state: "x", questions });
    expect(answers.locked).toEqual({ type: "refusal", reason: "off topic" });
    expect(answers.mood).toEqual(expectedAnswers.mood as typeof answers.mood);
  });

  test("a System One refusal is an answer, with or without a reason", async () => {
    fakeFetch({ ...systemOneReply, answers: { ...systemOneReply.answers, mood: { type: "refusal" } } });
    const { answers } = await openrouter("liquid/d1", { apiKey: "k" }).decide({ state: "x", questions });
    expect(answers.mood).toEqual({ type: "refusal" });
    expect(answers.locked).toEqual({ type: "boolean", probability: 0.9 });
  });
});

describe("audio", () => {
  const clip = audio("data:audio/webm;codecs=opus;base64,AAAA");

  test("Cloudflare sends audio in the audio field", async () => {
    const calls = fakeFetch({ result: tokensOnlyReply, success: true, errors: [] });
    await cloudflare("@cf/cloudflare/clef-omni", { apiKey: "t", accountId: "a" }).decide({ state: ["The user said:", clip, png], questions });
    expect(calls[0]!.body.state).toEqual(["The user said:"]);
    expect(calls[0]!.body.audio).toEqual(["data:audio/webm;base64,AAAA"]);
    expect(calls[0]!.body.images).toEqual([png.dataUrl]);
  });

  test("other providers reject audio before any request", async () => {
    const calls = fakeFetch(systemOneReply);
    for (const model of [openrouter("liquid/d1", { apiKey: "k" }), typesafe("jev-latest", { apiKey: "k" }), openai("gpt-6-luna", { apiKey: "k" })]) {
      await expect(model.decide({ state: [clip], questions })).rejects.toThrow("only by Cloudflare Clef-Omni");
    }
    expect(calls).toHaveLength(0);
  });

  test("audio() takes a data URL or bytes with a media type, and drops media type parameters", () => {
    expect(clip.mediaType).toBe("audio/webm");
    expect(audio(new Uint8Array([1]), "audio/webm; codecs=opus").mediaType).toBe("audio/webm");
    expect(audio(new Uint8Array([1, 2, 3]), "audio/wav").dataUrl).toBe("data:audio/wav;base64,AQID");
    expect(() => audio("data:image/png;base64,AAAA")).toThrow(TypeError);
    expect(() => audio(new Uint8Array([1]), "image/png")).toThrow(TypeError);
  });
});

describe("gatewayCostUsd()", () => {
  test("reads the gateway cost string and ignores other providers", () => {
    expect(gatewayCostUsd({ gateway: { cost: "0.000000586", routing: {} } })).toBe(0.000000586);
    expect(gatewayCostUsd({ openai: {} })).toBeUndefined();
    expect(gatewayCostUsd(undefined)).toBeUndefined();
  });
});

describe("image()", () => {
  test("reads the media type from bytes and round-trips through a data URL", () => {
    expect(png.mediaType).toBe("image/png");
    expect(image(png.dataUrl)).toEqual(png);
  });

  test("rejects data that is not an image", () => {
    expect(() => image(new TextEncoder().encode("hello"))).toThrow(TypeError);
    expect(() => image("https://example.com/a.png")).toThrow(TypeError);
  });
});
