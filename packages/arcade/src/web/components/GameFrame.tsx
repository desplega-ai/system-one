// The frame of a game page: a header with the Game and Ranking tabs, and a player bar fixed at the bottom
// (like a music player), so Start, Stop and Focus stay in reach while the page scrolls. With keyboard shortcuts.
import { cn } from "cn";
import { Info, Keyboard, Maximize2, Minimize2, Pause, Play, RotateCcw, SlidersHorizontal, Square, StepForward } from "lucide-react";
import { type ComponentType, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { budgetSpent } from "../lib/api.ts";
import { refreshBudget, useBudget } from "../lib/budget.ts";
import { StageContext } from "../lib/stage.ts";
import { hostByName, makerOf } from "../ui/brands.ts";
import { Hud, type RunStats } from "../ui/Hud.tsx";
import { splitLabel } from "../ui/ModelName.tsx";
import { Tip } from "../ui/Tip.tsx";

export type Status = "setup" | "running" | "paused" | "over";

/** What the app knows about a game: shown in the header. */
export type FrameInfo = { title: string; tagline: string; help: string; icon: ComponentType<{ className?: string }> };

export type Controls = {
  status: Status;
  startLabel: string;
  canStart: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** Only lockstep games can step one turn while paused. */
  onStep?: () => void;
  /** After a game, opens the setup again. The last game stays on screen until then. */
  onSetup?: () => void;
};

type Props = {
  info: FrameInfo;
  controls: Controls;
  stats: RunStats;
  /** The left of the player bar: the models in play, and one line about the game. */
  players: { label: string; color: string }[];
  subtitle: string;
  /** The line under the play button: how far the game is. */
  progress?: { value: number; left: string; right: string };
  live?: boolean;
  board: ReactNode;
  children: ReactNode;
};

const shortcuts: [string, string][] = [
  ["Space", "Start, pause or resume"],
  ["S", "Stop"],
  ["N", "Next turn, while paused"],
  ["E", "Edit the setup, after a game"],
  ["F", "Focus mode, for recordings"],
  ["G", "Game tab"],
  ["R", "Ranking tab"],
];

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
);

export function GameFrame({ info, controls, stats, players, subtitle, progress, live, board, children }: Props) {
  const [tab, setTab] = useState("game");
  const { stage, toggle } = useContext(StageContext);
  // Out of budget: no new game can start, and the page says why.
  const spentOut = budgetSpent(useBudget());
  if (spentOut && controls.status !== "running" && controls.status !== "paused") controls = { ...controls, canStart: false };
  const latest = useRef(controls);
  latest.current = controls;

  // While a game runs, the spend in the top bar follows it.
  useEffect(() => {
    if (controls.status !== "running") return;
    const timer = setInterval(refreshBudget, 10_000);
    return () => clearInterval(timer);
  }, [controls.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=listbox], [role=combobox], [role=dialog]")) return;
      const c = latest.current;
      const playing = c.status === "running" || c.status === "paused";
      const key = e.key === " " ? "space" : e.key.toLowerCase();
      if (key === "space") {
        e.preventDefault();
        if (c.status === "running") c.onPause();
        else if (c.status === "paused") c.onResume();
        else if (c.canStart) c.onStart();
      } else if (key === "s" && playing) c.onStop();
      else if (key === "n" && c.status === "paused") c.onStep?.();
      else if (key === "e" && c.status === "over") c.onSetup?.();
      else if (key === "g") setTab("game");
      else if (key === "r") setTab("ranking");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pb-32">
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="flex items-center gap-3 py-4 sm:gap-4 sm:py-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card sm:size-11">
            <info.icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{info.title}</h1>
            <p className="truncate text-sm text-muted-foreground">{info.tagline}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <TabsList data-chrome>
              <TabsTrigger value="game" className="px-3">
                Game
                {/* Phones have no keys to show. */}
                <span className="hidden sm:inline">
                  <Kbd>G</Kbd>
                </span>
              </TabsTrigger>
              <TabsTrigger value="ranking" className="px-3">
                Ranking
                {/* Phones have no keys to show. */}
                <span className="hidden sm:inline">
                  <Kbd>R</Kbd>
                </span>
              </TabsTrigger>
            </TabsList>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="How it works">
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm text-sm leading-relaxed">
                {info.help}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {/* Both tabs stay mounted: the game keeps its canvases, its camera and its loops while the ranking shows. */}
        <TabsContent value="game" forceMount className="space-y-4 data-[state=inactive]:hidden">
          {spentOut && (
            <Alert>
              <AlertTitle>No more calls today</AlertTitle>
              <AlertDescription>{spentOut}</AlertDescription>
            </Alert>
          )}
          {children}
        </TabsContent>
        <TabsContent value="ranking" forceMount className="data-[state=inactive]:hidden">
          {board}
        </TabsContent>
      </Tabs>
      <PlayerBar controls={controls} stats={stats} players={players} title={info.title} subtitle={subtitle} progress={progress} live={live} stage={stage} onStage={toggle} />
    </div>
  );
}

function PlayerBar({
  controls: c,
  stats,
  players,
  title,
  subtitle,
  progress,
  live,
  stage,
  onStage,
}: {
  controls: Controls;
  stats: RunStats;
  players: { label: string; color: string }[];
  title: string;
  subtitle: string;
  progress?: { value: number; left: string; right: string };
  live?: boolean;
  stage: boolean;
  onStage: () => void;
}) {
  const playing = c.status === "running" || c.status === "paused";
  const main =
    c.status === "running"
      ? { icon: <Pause />, text: "Pause", run: c.onPause }
      : c.status === "paused"
        ? { icon: <Play />, text: "Resume", run: c.onResume }
        : c.status === "over"
          ? { icon: <RotateCcw />, text: "Play again", run: c.onStart }
          : { icon: <Play />, text: c.startLabel, run: c.onStart };
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur-md">
      <div className="mx-auto grid max-w-[1360px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Now playing: the models, and what the game is doing. */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 -space-x-2">
            {players.map((p, i) => {
              // Like the arena's dots: the host's logo, so the same model on two hosts looks different.
              const { name, provider } = splitLabel(p.label);
              const brand = (provider && hostByName(provider)) || makerOf(name);
              return (
                <span
                  key={`${p.label}-${i}`}
                  className="flex size-8 items-center justify-center rounded-full bg-[#101216]"
                  style={{ boxShadow: `0 0 0 2px ${p.color}, 0 0 10px ${p.color}66` }}
                  title={p.label}
                >
                  {brand ? <img src={brand.logo} alt="" className="size-4" /> : <span className="size-2.5 rounded-full" style={{ background: p.color }} />}
                </span>
              );
            })}
          </div>
          <div className="hidden min-w-0 sm:block">
            <div className="flex items-center gap-2 text-sm font-medium">
              {title}
              {live && c.status === "running" && (
                <span className="flex items-center gap-1 font-mono text-[10px] text-live">
                  <span className="size-1.5 animate-pulse rounded-full bg-live" /> LIVE
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          </div>
        </div>

        {/* Transport: the big button, Stop, Step and Setup, and the progress under them. */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            {c.onSetup && (
              <Tip text={<>Edit the setup <Kbd>E</Kbd></>}>
                <span>
                  <Button variant="ghost" size="icon-sm" aria-label="Setup" onClick={c.onSetup} disabled={c.status !== "over"} className="text-muted-foreground">
                    <SlidersHorizontal />
                  </Button>
                </span>
              </Tip>
            )}
            <Tip text={<>Stop. The run gets no scores. <Kbd>S</Kbd></>}>
              <span>
                <Button variant="ghost" size="icon-sm" aria-label="Stop" onClick={c.onStop} disabled={!playing} className="text-muted-foreground">
                  <Square />
                </Button>
              </span>
            </Tip>
            <Tip text={<>{main.text} <Kbd>Space</Kbd></>}>
              <span>
                <Button
                  aria-label={main.text}
                  onClick={main.run}
                  disabled={!playing && !c.canStart}
                  className={cn("h-10 rounded-full", c.status === "setup" || c.status === "over" ? "px-5" : "w-10 px-0")}
                >
                  {main.icon}
                  {(c.status === "setup" || c.status === "over") && <span>{main.text}</span>}
                </Button>
              </span>
            </Tip>
            {c.onStep && (
              <Tip text={<>Play one turn, then pause <Kbd>N</Kbd></>}>
                <span>
                  <Button variant="ghost" size="icon-sm" aria-label="Next turn" onClick={c.onStep} disabled={c.status !== "paused"} className="text-muted-foreground">
                    <StepForward />
                  </Button>
                </span>
              </Tip>
            )}
          </div>
          {progress && (
            <div className="hidden items-center gap-2 font-mono text-[10px] text-muted-foreground tabular-nums md:flex">
              <span className="w-14 text-right">{progress.left}</span>
              <span className="h-1 w-56 overflow-hidden rounded-full bg-white/10 lg:w-80">
                <span className="block h-full rounded-full bg-foreground/80 transition-[width] duration-300" style={{ width: `${Math.min(1, progress.value) * 100}%` }} />
              </span>
              <span className="w-14">{progress.right}</span>
            </div>
          )}
        </div>

        {/* The run stats, Focus and the shortcuts. */}
        <div className="hidden items-center justify-end gap-3 md:flex">
          <div className="hidden lg:block">
            <Hud stats={stats} short />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" className="text-muted-foreground">
                <Keyboard />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="p-3">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {shortcuts.map(([key, what]) => (
                  <div key={key} className="contents">
                    <span className="text-right">
                      <Kbd>{key}</Kbd>
                    </span>
                    <span>{what}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
          <Tip text={<>{stage ? "Show the whole page again" : "Show only the game, for screen recordings"} <Kbd>F</Kbd></>}>
            <Button variant="outline" size="sm" onClick={onStage} className="hidden lg:inline-flex">
              {stage ? <Minimize2 /> : <Maximize2 />}
              {stage ? "Exit focus" : "Focus"}
            </Button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
