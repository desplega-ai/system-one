// The arcade server: the React page and the JSON API. Run it from the repo root so Bun loads .env.
import acme from "../acme/index.html";
import index from "../web/index.html";
import { createApi } from "./api.ts";
import { parseBudget } from "./budget.ts";
import { availableModels } from "./models.ts";
import { openStore } from "./store.ts";

const production = process.env.NODE_ENV === "production";
const models = availableModels();
const budget = parseBudget(process.env.SYSTEM_ONE_BUDGET);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3300),
  // /acme is the mock shop page that the voice game drives through its tools.
  routes: { "/": index, "/acme": acme, ...createApi({ store: openStore(), models, budget }) },
  development: !production && { hmr: true, console: true },
  // Large enough for 8 webcam frames or a 60 s WAV clip, small enough to keep one call cheap.
  maxRequestBodySize: 4 * 1024 * 1024,
  // The default of 10 s cuts off slow provider calls.
  idleTimeout: 60,
});

console.log(`arcade on ${server.url} (${models.length} models, budget ${JSON.stringify(budget)})`);
