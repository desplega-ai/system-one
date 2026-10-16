// How the voice game talks to the Acme page in its iframe: postMessage, same origin only.
// It mirrors WebMCP: list the tools, call one. The page also posts its state after every change.
import { type AppState, type Lang, type Mood, type Screen, visibleItems } from "./app.ts";
import { type ToolInfo, toolInfo, toolsFor } from "./tools.ts";

export type Snapshot = { screen: Screen; lang: Lang; mood: Mood; visible: string[]; tools: ToolInfo[] };

export type AcmeRequest =
  | { acme: "list"; id: number }
  | { acme: "call"; id: number; name: string; input: Record<string, unknown> }
  | { acme: "reset"; id: number };

export type AcmeMessage =
  | { acme: "reply"; id: number; ok: true; reply: string; snapshot: Snapshot }
  | { acme: "reply"; id: number; ok: false; error: string; snapshot: Snapshot }
  | { acme: "state"; snapshot: Snapshot };

export const snapshotOf = (app: AppState): Snapshot => ({
  screen: app.screen,
  lang: app.lang,
  mood: app.mood,
  visible: visibleItems(app),
  tools: toolsFor(app).map(toolInfo),
});
