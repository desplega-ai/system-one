// The tools the Acme page exposes, WebMCP style: a name, a description, a JSON Schema for the
// input, and a function that runs it. Each screen has its own tools, plus navigation everywhere.
// Pure: a tool takes the state and returns the next state and a short reply in the page language.
import type { JsonObject } from "@system-one/ai";
import {
  type AlbumId,
  type AppState,
  albumIds,
  back,
  go,
  type Lang,
  type Mood,
  matchingFaq,
  matchingOrders,
  moods,
  navScreens,
  type OrderId,
  orderIds,
  orderStatus,
  type Screen,
  strings,
} from "./app.ts";

export type ToolResult = { app: AppState; reply: string };
export type Tool = {
  name: string;
  /** Short, in the page language, for people. */
  title: string;
  /** For agents and models, in English. */
  description: string;
  inputSchema: JsonObject;
  run: (app: AppState, input: Record<string, unknown>) => ToolResult;
};
/** A tool as other code sees it: everything but `run`. */
export type ToolInfo = Omit<Tool, "run">;

/** One value of an enum input: `const` is the value, `title` is for people, `description` for models. */
type Choice = { const: string; title: string; description: string };
const pickOne = (name: string, description: string, choices: Choice[]): JsonObject => ({
  type: "object",
  properties: { [name]: { type: "string", description, oneOf: choices } },
  required: [name],
});
const text = (name: string, description: string): JsonObject => ({
  type: "object",
  properties: { [name]: { type: "string", description, maxLength: 200 } },
  required: [name],
});
const none: JsonObject = { type: "object", properties: {} };

/** Reads an enum input, or throws: a tool must not run with a value it did not offer. */
function oneOf<T extends string>(input: Record<string, unknown>, name: string, allowed: readonly T[]): T {
  const value = input[name];
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`${name} must be one of: ${allowed.join(", ")}`);
  return value as T;
}
function words(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim().slice(0, 200);
}

// Value descriptions are whole requests, so a value reads well on its own as an option for a model.
const screenDescriptions: Record<(typeof navScreens)[number], string> = {
  home: "open the home screen",
  orders: "open the list of orders",
  photos: "open the photo albums",
  settings: "open the settings",
  help: "open the help page and FAQ",
};

const replies: Record<Lang, Record<string, (...args: string[]) => string>> = {
  en: {
    go_to: (s) => ({ home: "Going home.", orders: "Here are your orders.", photos: "Here are your photos.", settings: "Here are your settings.", help: "Here is the help page." })[s] ?? "Done.",
    go_back: () => "Going back.",
    open_order: (id) => `Here is order ${id}.`,
    search_orders: (r) => `${r}.`,
    track_order: () => "Your package arrives Tuesday.",
    cancel_order: (id) => `Order ${id} is cancelled.`,
    contact_support: () => "Connecting you to support.",
    open_album: (a) => `Here is the ${a} album.`,
    rename_album: (n) => `The album is now called ${n}.`,
    set_notifications: (s) => `Notifications: ${s}.`,
    search_help: (r) => `${r}.`,
    send_message: () => "Message sent.",
  },
  es: {
    go_to: (s) => ({ home: "Vamos al inicio.", orders: "Aquí tienes tus pedidos.", photos: "Aquí tienes tus fotos.", settings: "Aquí tienes tus ajustes.", help: "Aquí tienes la ayuda." })[s] ?? "Hecho.",
    go_back: () => "Volvemos atrás.",
    open_order: (id) => `Aquí tienes el pedido ${id}.`,
    search_orders: (r) => `${r}.`,
    track_order: () => "Tu paquete llega el martes.",
    cancel_order: (id) => `El pedido ${id} está cancelado.`,
    contact_support: () => "Te paso con soporte.",
    open_album: (a) => `Aquí tienes el álbum ${a}.`,
    rename_album: (n) => `El álbum ahora se llama ${n}.`,
    set_notifications: (s) => `Notificaciones: ${s}.`,
    search_help: (r) => `${r}.`,
    send_message: () => "Mensaje enviado.",
  },
};

const toolTitles: Record<Lang, Record<string, string>> = {
  en: {
    go_to: "Go to",
    go_back: "Go back",
    set_language: "Language",
    set_theme: "Theme",
    open_order: "Open order",
    search_orders: "Search orders",
    track_order: "Track order",
    cancel_order: "Cancel order",
    contact_support: "Contact support",
    open_album: "Open album",
    rename_album: "Rename album",
    set_notifications: "Notifications",
    search_help: "Search help",
    send_message: "Send a message",
  },
  es: {
    go_to: "Ir a",
    go_back: "Volver",
    set_language: "Idioma",
    set_theme: "Tema",
    open_order: "Abrir pedido",
    search_orders: "Buscar pedidos",
    track_order: "Seguir pedido",
    cancel_order: "Cancelar pedido",
    contact_support: "Contactar con soporte",
    open_album: "Abrir álbum",
    rename_album: "Renombrar álbum",
    set_notifications: "Notificaciones",
    search_help: "Buscar ayuda",
    send_message: "Enviar un mensaje",
  },
};

/** The tools that exist right now. They change with the screen, like on a real WebMCP page. */
export function toolsFor(app: AppState): Tool[] {
  const t = strings[app.lang];
  const reply = replies[app.lang];
  const tool = (name: string, description: string, inputSchema: JsonObject, run: Tool["run"]): Tool => ({
    name,
    title: toolTitles[app.lang][name]!,
    description,
    inputSchema,
    run,
  });

  const targets = navScreens.filter((s) => s !== app.screen);
  const tools: Tool[] = [
    tool(
      "go_to",
      "Open another screen of the app.",
      pickOne("screen", "the screen to open", targets.map((s) => ({ const: s, title: t.screens[s], description: screenDescriptions[s] }))),
      (a, input) => {
        const screen = oneOf(input, "screen", targets);
        return { app: go(a, screen), reply: reply.go_to!(screen) };
      },
    ),
  ];
  if (app.history.length > 0) tools.push(tool("go_back", "Go back to the previous screen.", none, (a) => ({ app: back(a), reply: reply.go_back!() })));

  const contactSupport = tool("contact_support", "Start a chat with a person in customer support.", none, (a) => ({
    app: go(a, "support"),
    reply: reply.contact_support!(),
  }));

  switch (app.screen) {
    case "orders":
      tools.push(
        tool(
          "open_order",
          "Open one order to see its details, track it or cancel it.",
          pickOne("order", "the order to open", orderIds.map((id) => ({ const: id, title: `#${id} ${t.products[id]}`, description: `open order ${id} (${strings.en.products[id].toLowerCase()})` }))),
          (a, input) => {
            const order = oneOf(input, "order", orderIds);
            return { app: { ...go(a, "order"), order, tracking: false }, reply: reply.open_order!(order) };
          },
        ),
        tool("search_orders", "Search the orders by product name.", text("query", "the words to look for, for example a product name"), (a, input) => {
          const next = { ...a, orderQuery: words(input, "query") };
          return { app: next, reply: reply.search_orders!(t.results(next.orderQuery!, matchingOrders(next).length)) };
        }),
      );
      break;
    case "order":
      if (orderStatus(app, app.order) !== "cancelled") {
        tools.push(
          tool("track_order", "Show where the package of this order is.", none, (a) => ({ app: { ...a, tracking: true }, reply: reply.track_order!() })),
          tool("cancel_order", "Cancel this order.", none, (a) => ({ app: { ...a, cancelled: [...a.cancelled, a.order] }, reply: reply.cancel_order!(a.order) })),
        );
      }
      tools.push(contactSupport);
      break;
    case "photos":
      tools.push(
        tool(
          "open_album",
          "Open a photo album.",
          pickOne("album", "the album to open", albumIds.map((id) => ({ const: id, title: app.albumNames[id] ?? t.albums[id], description: `open the ${strings.en.albums[id].toLowerCase()} album` }))),
          (a, input) => {
            const album: AlbumId = oneOf(input, "album", albumIds);
            return { app: { ...go(a, "album"), album }, reply: reply.open_album!(a.albumNames[album] ?? t.albums[album]) };
          },
        ),
      );
      break;
    case "album":
      tools.push(
        tool("rename_album", "Give this photo album a new name.", text("name", "the new name of the album"), (a, input) => {
          const name = words(input, "name");
          return { app: { ...a, albumNames: { ...a.albumNames, [a.album]: name } }, reply: reply.rename_album!(name) };
        }),
      );
      break;
    case "settings":
      tools.push(
        tool(
          "set_notifications",
          "Turn notifications on or off.",
          pickOne("state", "on or off", [
            { const: "on", title: t.settings.on, description: "turn notifications on" },
            { const: "off", title: t.settings.off, description: "turn notifications off" },
          ]),
          (a, input) => {
            const state = oneOf(input, "state", ["on", "off"] as const);
            return { app: { ...a, notifications: state === "on" }, reply: reply.set_notifications!(state === "on" ? t.settings.on : t.settings.off) };
          },
        ),
      );
      break;
    case "help":
      tools.push(
        tool("search_help", "Search the help questions.", text("query", "the question or the words to look for"), (a, input) => {
          const next = { ...a, helpQuery: words(input, "query") };
          return { app: next, reply: reply.search_help!(t.results(next.helpQuery!, matchingFaq(next).length)) };
        }),
        contactSupport,
      );
      break;
    case "support":
      tools.push(
        tool("send_message", "Send a message to the support agent in the chat.", text("text", "the message, in the user's words"), (a, input) => ({
          app: { ...a, messages: [...a.messages, words(input, "text")] },
          reply: reply.send_message!(),
        })),
      );
      break;
    case "home":
      break;
  }

  // The look of the app. An assistant sets these from how the user talks, so they reply with nothing.
  tools.push(
    tool(
      "set_language",
      "Change the language of the app.",
      pickOne("language", "the language", (["en", "es"] as const).map((l) => ({ const: l, title: t.languageNames[l], description: `switch the app to ${l === "en" ? "English" : "Spanish"}` }))),
      (a, input) => ({ app: { ...a, lang: oneOf(input, "language", ["en", "es"] as const) }, reply: "" }),
    ),
    tool(
      "set_theme",
      "Adapt the look of the app to the user's mood.",
      pickOne("mood", "the user's mood", moods.map((m) => ({ const: m, title: t.moodNames[m], description: `adapt the app to a ${m} user` }))),
      (a, input) => ({ app: { ...a, mood: oneOf<Mood>(input, "mood", moods) }, reply: "" }),
    ),
  );
  return tools;
}

/** Runs one tool. Throws a TypeError for an unknown tool or a bad input. */
export function callTool(app: AppState, name: string, input: Record<string, unknown> = {}): ToolResult {
  const tool = toolsFor(app).find((t) => t.name === name);
  if (!tool) throw new TypeError(`no tool named ${name} on the ${app.screen} screen`);
  return tool.run(app, input);
}

export const toolInfo = ({ run: _, ...info }: Tool): ToolInfo => info;
