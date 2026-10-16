// Acme, the mock shop app. Pure: its state, its data and its strings in English and Spanish.

export type Lang = "en" | "es";
export const moods = ["calm", "happy", "angry", "sad", "confused"] as const;
export type Mood = (typeof moods)[number];
export type Screen = "home" | "orders" | "order" | "photos" | "album" | "settings" | "help" | "support";
/** The screens that `go_to` can open. The others open through a tool (an order, an album, the chat). */
export const navScreens = ["home", "orders", "photos", "settings", "help"] as const;

export const orderIds = ["1042", "1043"] as const;
export type OrderId = (typeof orderIds)[number];
export const albumIds = ["summer", "family"] as const;
export type AlbumId = (typeof albumIds)[number];

export type AppState = {
  screen: Screen;
  /** Earlier screens, for go_back. */
  history: Screen[];
  lang: Lang;
  mood: Mood;
  order: OrderId;
  album: AlbumId;
  cancelled: OrderId[];
  tracking: boolean;
  notifications: boolean;
  orderQuery: string | null;
  helpQuery: string | null;
  albumNames: Partial<Record<AlbumId, string>>;
  messages: string[];
};

export const initialApp: AppState = {
  screen: "home",
  history: [],
  lang: "en",
  mood: "calm",
  order: "1042",
  album: "summer",
  cancelled: [],
  tracking: false,
  notifications: true,
  orderQuery: null,
  helpQuery: null,
  albumNames: {},
  messages: [],
};

export function go(app: AppState, screen: Screen): AppState {
  return screen === app.screen ? app : { ...app, screen, history: [...app.history, app.screen].slice(-20) };
}

export function back(app: AppState): AppState {
  return app.history.length === 0 ? app : { ...app, screen: app.history.at(-1)!, history: app.history.slice(0, -1) };
}

export type Strings = {
  appTitle: string;
  screens: Record<Screen, string>;
  welcome: string;
  products: Record<OrderId, string>;
  orderStatus: { shipped: string; processing: string; cancelled: string };
  tracking: string;
  cancelledNote: string;
  buttons: { track: string; cancel: string; contact: string };
  inputs: { searchOrders: string; searchHelp: string; rename: string; message: string; go: string };
  albums: Record<AlbumId, string>;
  photoCount: (n: number) => string;
  settings: { language: string; notifications: string; on: string; off: string; theme: string };
  faq: string[];
  results: (query: string, count: number) => string;
  supportIntro: string;
  hints: string;
  languageNames: Record<Lang, string>;
  moodNames: Record<Mood, string>;
};

export const strings: Record<Lang, Strings> = {
  en: {
    appTitle: "Acme",
    screens: { home: "Home", orders: "Orders", order: "Order", photos: "Photos", album: "Album", settings: "Settings", help: "Help", support: "Support" },
    welcome: "Welcome back",
    products: { "1042": "Wireless headphones", "1043": "Desk lamp" },
    orderStatus: { shipped: "Shipped", processing: "Processing", cancelled: "Cancelled" },
    tracking: "Arrives Tuesday. Now at the Madrid hub.",
    cancelledNote: "This order is cancelled. The refund takes 3 to 5 days.",
    buttons: { track: "Track order", cancel: "Cancel order", contact: "Contact support" },
    inputs: { searchOrders: "Search orders", searchHelp: "Search help", rename: "New album name", message: "Write a message", go: "Go" },
    albums: { summer: "Summer", family: "Family" },
    photoCount: (n) => `${n} photos`,
    settings: { language: "Language", notifications: "Notifications", on: "On", off: "Off", theme: "Theme" },
    faq: ["Where is my package?", "How do I return an item?", "How do I change my password?"],
    results: (q, n) => `${n} ${n === 1 ? "result" : "results"} for "${q}"`,
    supportIntro: "You are talking to a person. Usual wait: 2 minutes.",
    hints: "You can say: show my orders, track my package, cancel my order, open settings, I need help.",
    languageNames: { en: "English", es: "Español" },
    moodNames: { calm: "Calm", happy: "Happy", angry: "Angry", sad: "Sad", confused: "Confused" },
  },
  es: {
    appTitle: "Acme",
    screens: { home: "Inicio", orders: "Pedidos", order: "Pedido", photos: "Fotos", album: "Álbum", settings: "Ajustes", help: "Ayuda", support: "Soporte" },
    welcome: "Hola de nuevo",
    products: { "1042": "Auriculares inalámbricos", "1043": "Lámpara de escritorio" },
    orderStatus: { shipped: "Enviado", processing: "En preparación", cancelled: "Cancelado" },
    tracking: "Llega el martes. Ahora en el centro de Madrid.",
    cancelledNote: "Este pedido está cancelado. El reembolso tarda de 3 a 5 días.",
    buttons: { track: "Seguir pedido", cancel: "Cancelar pedido", contact: "Contactar con soporte" },
    inputs: { searchOrders: "Buscar pedidos", searchHelp: "Buscar ayuda", rename: "Nuevo nombre del álbum", message: "Escribe un mensaje", go: "Ir" },
    albums: { summer: "Verano", family: "Familia" },
    photoCount: (n) => `${n} fotos`,
    settings: { language: "Idioma", notifications: "Notificaciones", on: "Activadas", off: "Desactivadas", theme: "Tema" },
    faq: ["¿Dónde está mi paquete?", "¿Cómo devuelvo un artículo?", "¿Cómo cambio mi contraseña?"],
    results: (q, n) => `${n} ${n === 1 ? "resultado" : "resultados"} para "${q}"`,
    supportIntro: "Estás hablando con una persona. Espera habitual: 2 minutos.",
    hints: "Puedes decir: mis pedidos, dónde está mi paquete, cancela mi pedido, abre ajustes, necesito ayuda.",
    languageNames: { en: "English", es: "Español" },
    moodNames: { calm: "Tranquilo", happy: "Alegre", angry: "Enfadado", sad: "Triste", confused: "Confuso" },
  },
};

export const photoCounts: Record<AlbumId, number> = { summer: 128, family: 342 };

export const orderStatus = (app: AppState, id: OrderId) =>
  app.cancelled.includes(id) ? "cancelled" : id === "1042" ? "shipped" : "processing";

/** Orders whose product matches the search, in either language. */
export function matchingOrders(app: AppState): OrderId[] {
  const query = app.orderQuery?.toLowerCase();
  if (!query) return [...orderIds];
  return orderIds.filter((id) => id.includes(query) || (["en", "es"] as const).some((l) => query.split(/\s+/).some((w) => w.length > 2 && strings[l].products[id].toLowerCase().includes(w))));
}

/** Help questions that share a word with the search. */
export function matchingFaq(app: AppState): string[] {
  const faq = strings[app.lang].faq;
  const words = app.helpQuery?.toLowerCase().split(/\s+/).filter((w) => w.length > 3) ?? [];
  return words.length === 0 ? faq : faq.filter((item) => words.some((w) => item.toLowerCase().includes(w)));
}

/** What the screen shows, in English, for the models. They decide better when they know the screen. */
export function visibleItems(app: AppState): string[] {
  const t = strings.en;
  switch (app.screen) {
    case "home":
      return ["tiles: Orders, Photos, Settings, Help"];
    case "orders":
      return matchingOrders(app).map((id) => `order #${id}: ${t.products[id]} (${orderStatus(app, id)})`);
    case "order":
      return [`order #${app.order}: ${t.products[app.order]} (${orderStatus(app, app.order)})`];
    case "photos":
      return ["albums: Summer, Family"];
    case "album":
      return [`album ${app.albumNames[app.album] ?? t.albums[app.album]}, ${photoCounts[app.album]} photos`];
    case "settings":
      return [`language ${app.lang}`, `notifications ${app.notifications ? "on" : "off"}`, `theme ${app.mood}`];
    case "help":
      return matchingFaq({ ...app, lang: "en" });
    case "support":
      return ["a chat with a support agent", ...app.messages.map((m) => `sent: ${m}`)];
  }
}
