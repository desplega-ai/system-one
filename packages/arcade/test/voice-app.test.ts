import { describe, expect, test } from "bun:test";
import { audio, type ChoiceAnswer } from "@system-one/ai";
import { type AppState, initialApp, strings } from "../src/acme/app.ts";
import { snapshotOf } from "../src/acme/protocol.ts";
import { callTool, toolInfo, toolsFor } from "../src/acme/tools.ts";
import { actionsFrom, cleanValue, fillPrompt, NONE, uncertain } from "../src/games/voice/actions.ts";
import { createMission, grade } from "../src/games/voice/missions.ts";
import { questionsFor, stateFor, type VoiceAnswers } from "../src/games/voice/state.ts";

const names = (app: AppState) => toolsFor(app).map((t) => t.name);
const run = (app: AppState, ...calls: [string, Record<string, unknown>?][]) => calls.reduce((a, [name, input]) => callTool(a, name, input).app, app);
const choice = (probabilities: Record<string, number>): ChoiceAnswer<string> => {
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: "choice", choice: top, probabilities };
};

describe("Acme tools", () => {
  test("each screen has its own tools, plus navigation and the look", () => {
    expect(names(initialApp)).toEqual(["go_to", "set_language", "set_theme"]);
    const orders = run(initialApp, ["go_to", { screen: "orders" }]);
    expect(names(orders)).toEqual(["go_to", "go_back", "open_order", "search_orders", "set_language", "set_theme"]);
    const order = run(orders, ["open_order", { order: "1043" }]);
    expect(order).toMatchObject({ screen: "order", order: "1043" });
    expect(names(order)).toContain("cancel_order");
  });

  test("go_to does not offer the current screen", () => {
    const schema = toolsFor(initialApp)[0]!.inputSchema as { properties: { screen: { oneOf: { const: string }[] } } };
    expect(schema.properties.screen.oneOf.map((o) => o.const)).toEqual(["orders", "photos", "settings", "help"]);
  });

  test("a cancelled order has no cancel or track tool", () => {
    const app = run(initialApp, ["go_to", { screen: "orders" }], ["open_order", { order: "1042" }], ["cancel_order"]);
    expect(app.cancelled).toEqual(["1042"]);
    expect(names(app)).not.toContain("cancel_order");
    expect(names(app)).not.toContain("track_order");
  });

  test("text tools keep the words, and the replies follow the page language", () => {
    const orders = run(initialApp, ["go_to", { screen: "orders" }]);
    const found = callTool(orders, "search_orders", { query: "headphones" });
    expect(found.app.orderQuery).toBe("headphones");
    expect(found.reply).toBe('1 result for "headphones".');
    const es = run(orders, ["set_language", { language: "es" }]);
    expect(callTool(es, "search_orders", { query: "lámpara" }).reply).toBe('1 resultado para "lámpara".');
  });

  test("bad calls throw instead of guessing", () => {
    expect(() => callTool(initialApp, "cancel_order")).toThrow(TypeError);
    expect(() => callTool(initialApp, "go_to", { screen: "home" })).toThrow(TypeError);
    const orders = run(initialApp, ["go_to", { screen: "orders" }]);
    expect(() => callTool(orders, "search_orders", { query: "  " })).toThrow(TypeError);
  });

  test("go_back returns through the history", () => {
    const app = run(initialApp, ["go_to", { screen: "help" }], ["contact_support"], ["go_back"]);
    expect(app.screen).toBe("help");
    expect(run(app, ["go_back"]).screen).toBe("home");
  });

  test("every string exists in both languages", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v).map((s) => `${k}.${s}`) : [k]));
    expect(keys(strings.es)).toEqual(keys(strings.en));
  });
});

describe("actions", () => {
  const orders = run(initialApp, ["go_to", { screen: "orders" }]);
  const actions = actionsFrom(toolsFor(orders).map(toolInfo));

  test("an enum input gives one action per value, a text input one action, and the look none", () => {
    expect(actions.map((a) => a.id)).toEqual([
      "go_to.home",
      "go_to.photos",
      "go_to.settings",
      "go_to.help",
      "go_back",
      "open_order.1042",
      "open_order.1043",
      "search_orders",
    ]);
    expect(actions.find((a) => a.id === "open_order.1042")).toMatchObject({ tool: "open_order", input: { order: "1042" }, request: "open order 1042 (wireless headphones)" });
    expect(actions.find((a) => a.id === "search_orders")?.text?.name).toBe("query");
  });

  test("the question lists every action plus none, with valid option ids", () => {
    const options = Object.keys(questionsFor(actions).action.options);
    expect(options).toEqual([...actions.map((a) => a.id), NONE]);
    for (const id of options) expect(id).toMatch(/^[\w.-]{1,100}$/);
  });

  test("uncertain asks between the top two, never for none", () => {
    expect(uncertain(choice({ "go_to.help": 0.9, go_back: 0.05 }))).toBeNull();
    expect(uncertain(choice({ "go_to.help": 0.5, go_back: 0.3 }))).toEqual(["go_to.help", "go_back"]);
    expect(uncertain(choice({ "go_to.help": 0.62, go_back: 0.5 }))).toEqual(["go_to.help", "go_back"]);
    expect(uncertain(choice({ none: 0.4, go_back: 0.35 }))).toBeNull();
    expect(uncertain({ type: "refusal" })).toBeNull();
  });

  test("fillPrompt names the input, and cleanValue trims the model's text", () => {
    const search = actions.find((a) => a.id === "search_orders")!;
    expect(fillPrompt(search, "find my headphones").prompt).toContain('The user said: "find my headphones"');
    expect(cleanValue('"headphones".\nbecause the user said so')).toBe("headphones");
    expect(cleanValue("  «auriculares»  ")).toBe("auriculares");
  });
});

describe("missions", () => {
  const actions = actionsFrom(toolsFor(run(initialApp, ["go_to", { screen: "orders" }])).map(toolInfo));

  test("come from the current actions, never go_back", () => {
    for (let i = 0; i < 100; i++) {
      const m = createMission(actions);
      expect(actions).toContain(m.action);
      expect(m.action.tool).not.toBe("go_back");
      expect(m.text).toMatch(/^Ask the app to .+\. Speak (English|Spanish)\. Sound \w+\.$/);
    }
  });

  test("a text action asks the player to choose the words", () => {
    const search = actions.find((a) => a.id === "search_orders")!;
    expect(createMission([search], () => 0).text).toBe("Ask the app to search the orders by product name (you choose the words). Speak English. Sound calm.");
  });

  test("grade checks each part, and a refusal is wrong", () => {
    const mission = createMission([actions[0]!], () => 0.99);
    const answers = {
      action: { type: "choice", choice: actions[0]!.id, probabilities: {} },
      language: { type: "choice", choice: "english", probabilities: {} },
      mood: { type: "refusal" },
    } as unknown as VoiceAnswers;
    expect(grade(mission, answers)).toEqual({ action: true, language: false, mood: false });
  });
});

test("transcript listeners get the words, audio listeners get the clip", () => {
  const view = snapshotOf(initialApp);
  const clip = audio("data:audio/wav;base64,AAAA");
  const withAudio = stateFor(view, { audio: clip });
  expect(withAudio[1]).toBe(clip);
  const withText = stateFor(view, { transcript: "show my orders" });
  expect(withText).toHaveLength(1);
  expect(withText[0]).toMatchObject({ screen: "home", userSaid: "show my orders" });
  expect(JSON.stringify(withText)).not.toContain("language");
});
