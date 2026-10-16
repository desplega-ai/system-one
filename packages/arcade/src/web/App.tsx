import { type ComponentType, useEffect, useState } from "react";
import { Arena } from "../games/arena/Arena.tsx";
import { Attention } from "../games/attention/Attention.tsx";
import { Voice } from "../games/voice/Voice.tsx";
import { api, type BudgetInfo } from "./lib/api.ts";
import { BudgetLine } from "./ui/Hud.tsx";

/** `arg` is the rest of the route: "standoff" for #/arena/standoff. */
type Game = { path: string; title: string; blurb: string; component: ComponentType<{ arg?: string }> };

const games: Game[] = [
  { path: "arena", title: "Arena", blurb: "Models stand on a circle and shoot at each other. Last one standing wins.", component: Arena },
  {
    path: "attention",
    title: "Attention",
    blurb: "What are the models curious about? Each one looks around your live webcam (or a picture) and zooms in on its own path.",
    component: Attention,
  },
  {
    path: "voice",
    title: "Voice",
    blurb: "Talk to a shop app you cannot touch. One model hears your voice, others read the transcript. Missions score them.",
    component: Voice,
  },
];

/** The part of the URL after "#/", for example "arena" or "arena/standoff". */
function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const [path, ...rest] = useHashRoute().split("/");
  const game = games.find((g) => g.path === path);
  return (
    <main>
      <header className="site-header">
        <a href="#/">System One Arcade</a>
        {game && <span className="muted">/ {game.title}</span>}
      </header>
      {game ? <game.component arg={rest.join("/") || undefined} /> : <Home />}
    </main>
  );
}

function Home() {
  const [budget, setBudget] = useState<BudgetInfo>();
  useEffect(() => {
    api.budget().then(setBudget, () => {});
  }, []);
  return (
    <section>
      <ul className="games">
        {games.map((g) => (
          <li key={g.path}>
            <a href={`#/${g.path}`}>{g.title}</a>
            <p className="muted">{g.blurb}</p>
          </li>
        ))}
      </ul>
      {budget && (
        <p>
          Budget: <BudgetLine budget={budget} />
        </p>
      )}
    </section>
  );
}
