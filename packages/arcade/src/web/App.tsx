import { ScanEye, Swords } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";
import { TooltipProvider } from "@/web/components/ui/tooltip";
import { Arena } from "../games/arena/Arena.tsx";
import { Attention } from "../games/attention/Attention.tsx";
import { Voice } from "../games/voice/Voice.tsx";
import type { FrameInfo } from "./components/GameFrame.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Home } from "./home/Home.tsx";
import { ShareCard } from "./home/ShareCard.tsx";
import { Live } from "./live/Live.tsx";
import { Stats } from "./stats/Stats.tsx";
import { StageContext } from "./lib/stage.ts";

/** `arg` is the rest of the route: "standoff" for #/arena/standoff. */
export type GameInfo = FrameInfo & {
  path: string;
  text: string;
  tags: string[];
  component: ComponentType<{ arg?: string; info: FrameInfo }>;
};

export const games: GameInfo[] = [
  {
    path: "attention",
    title: "Attention",
    tagline: "What catches a model's eye?",
    text: "Models watch your webcam, or a picture. Each picks the spot it is most curious about and zooms in.",
    tags: ["1 to 3 models", "Live webcam", "Your photos and videos"],
    help: "Each turn, every model sees a 9x9 grid over the image and picks the cell it is most curious about. Then it zooms in 3x, steps back, or stays, and rates how interesting the view is. On the webcam, each model looks again about twice a second.",
    icon: ScanEye,
    component: Attention,
  },
  {
    path: "arena",
    title: "Arena",
    tagline: "Last model standing.",
    text: "Up to 6 models on a ring or a plane. Each turn, they choose where to move, who to aim at, and whether to fire.",
    tags: ["2 to 6 models", "Ring or plane", "Turn-based or real-time"],
    help: "Each turn, every model reads the positions as text and answers 3 questions: where to move, who to aim at, and whether to fire. On the ring, shots land at once. On the plane, models step in 12 directions and shots fly for a few ticks, so they can be dodged. Lockstep waits for every model. Real-time lets fast models act more often. The last model with hit points wins.",
    icon: Swords,
    component: Arena,
  },
];

/** Hidden for now: reachable at #/voice, but not listed. */
const hidden: GameInfo[] = [
  {
    path: "voice",
    title: "Voice",
    tagline: "Talk to a shop app you cannot touch.",
    text: "",
    tags: [],
    help: "One model hears your voice, the others read a transcript. Missions score them.",
    icon: ScanEye,
    component: () => (
      <>
        <h1 className="py-5 text-xl font-semibold tracking-tight">Voice</h1>
        <Voice />
      </>
    ),
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

/** Stage mode shows only the game, for screen recordings. F toggles it, except while typing. */
function useStage(enabled: boolean): [boolean, () => void] {
  const [stage, setStage] = useState(false);
  const on = stage && enabled;
  useEffect(() => {
    document.documentElement.classList.toggle("stage", on);
  }, [on]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey || !enabled) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=listbox], [role=combobox]")) return;
      setStage((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
  return [on, () => setStage((s) => !s)];
}

export function App() {
  const [path, ...rest] = useHashRoute().split("/");
  const game = [...games, ...hidden].find((g) => g.path === path);
  const [stage, toggleStage] = useStage(game !== undefined);
  useEffect(() => {
    const page = game?.title ?? { stats: "Stats", live: "Live" }[path ?? ""];
    document.title = page ? `${page} · System One Arcade` : "System One Arcade";
  }, [game, path]);
  // #/share is the link preview image, without the site around it.
  if (path === "share") return <ShareCard />;
  return (
    <TooltipProvider delayDuration={200}>
      <StageContext value={{ stage, toggle: toggleStage }}>
        <TopBar links={games} active={path} />
        <main className="mx-auto max-w-[1360px] px-4 pb-16 sm:px-6">
          {game ? (
            <game.component key={game.path} arg={rest.join("/") || undefined} info={game} />
          ) : path === "stats" ? (
            <Stats arg={rest[0]} />
          ) : path === "live" ? (
            <Live />
          ) : (
            <Home games={games} />
          )}
        </main>
      </StageContext>
    </TooltipProvider>
  );
}
