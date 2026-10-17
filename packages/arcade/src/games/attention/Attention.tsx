import { type Answer, decisionStream } from "@system-one/ai";
import { Camera, CameraOff, Film, ImageIcon, LoaderCircle, SwitchCamera, Upload } from "lucide-react";
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card } from "@/web/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { type FrameInfo, GameFrame } from "../../web/components/GameFrame.tsx";
import { ApiError, api, type ModelInfo } from "../../web/lib/api.ts";
import { refreshBudget } from "../../web/lib/budget.ts";
import { cameraAllowed, useSquareSide, useWebcam } from "../../web/lib/hooks.ts";
import { cropImage, fullView, gridImage, overviewImage, type Source, squareOf } from "../../web/lib/media.ts";
import { Board } from "../../web/ui/Board.tsx";
import { FullscreenButton } from "../../web/ui/FullscreenButton.tsx";
import { agentColors } from "../../web/ui/colors.ts";
import { addCall, emptyStats, type RunStats, usd } from "../../web/ui/Hud.tsx";
import { ModelName } from "../../web/ui/ModelName.tsx";
import { ModelPicker } from "../../web/ui/ModelPicker.tsx";
import { ProbabilityBars } from "../../web/ui/ProbabilityBars.tsx";
import { FilterChips, useModelFilters } from "../../web/ui/RankingFilters.tsx";
import { ResultCard } from "../../web/ui/ResultCard.tsx";
import { SetupRow } from "../../web/ui/SetupRow.tsx";
import { Tip } from "../../web/ui/Tip.tsx";
import {
  createGame,
  currentView,
  depthOf,
  earlierViews,
  type Game,
  type InterestLevel,
  interestLevels,
  isOver,
  type Judge,
  MAX_ROUNDS,
  type Mode,
  playLive,
  playRound,
  scores,
  reactions,
  reactionTints,
  type Turn,
} from "./engine.ts";
import { attentionImages } from "./images.ts";
import attic from "./images/attic.jpg";
import emptyRoom from "./images/empty-room.jpg";
import forestFloor from "./images/forest-floor.jpg";
import market from "./images/market.jpg";
import nightSkyline from "./images/night-skyline.jpg";
import wizardDesk from "./images/wizard-desk.jpg";
import { drawPicture, drawZoom, glide, type Shown } from "./render.ts";
import { questionsFor, stateFor } from "./state.ts";

const pictureUrls: Record<string, string> = {
  attic,
  market,
  "wizard-desk": wizardDesk,
  "forest-floor": forestFloor,
  "night-skyline": nightSkyline,
  "empty-room": emptyRoom,
};

type Status = "setup" | "running" | "paused" | "over";
/** One game. Stop or a new game aborts its open calls, and late answers are dropped. */
type Run = { runId: string; mode: Mode; abort: AbortController; elapsedMs: number };

/** Still mode waits this long between rounds, so people can follow the paths. */
const ROUND_PAUSE_MS = 600;
/** Live mode: each judge calls at most this often. With 2 images a call, this keeps a session near $0.1. */
const LIVE_EVERY_MS = 500;
const LIVE_SECONDS = 30;
/** The side of each judge's zoomed view on its card, in CSS pixels. Smaller on phones. */
const zoomPx = () => (window.innerWidth < 640 ? 96 : 120);
const preferredJudges = ["cloudflare:clef-flash", "typesafe:jev-latest", "openai:gpt-6-luna"];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudgetError = (e: unknown) => e instanceof ApiError && (e.code === "budget_exceeded" || e.code === "share_exceeded");

/**
 * The call for one judge, built from the current picture or video frame.
 * Still: the grid on the judge's view, and the whole picture as image 2.
 * Live: the grid always on the whole frame, and the zoomed view as image 2.
 */
function callFor(game: Game, judge: Judge, src: Source) {
  const side = squareOf(src).side;
  const view = currentView(judge, game.mode);
  const zoomed = depthOf(judge, game.mode) > 0;
  const images =
    game.mode === "still"
      ? { grid: gridImage(src, view), second: zoomed ? overviewImage(src, view, earlierViews(judge)) : undefined }
      : { grid: gridImage(src, fullView), second: zoomed ? cropImage(src, view) : undefined };
  return { side, call: { state: stateFor(game, judge, images), questions: questionsFor(judge, game.mode, side) } };
}

/** A file the user picked, for this page load only: an object URL, not an upload to the server. */
let uploaded: { url: string; kind: "image" | "video"; name: string } | null = null;

/** `arg` is an image id, "webcam" or "upload", for example #/attention/attic. */
export function Attention({ arg, info }: { arg?: string; info: FrameInfo }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [game, setGame] = useState<Game>();
  const [status, setStatus] = useState<Status>("setup");
  const [notice, setNotice] = useState<string>();
  const [stats, setStats] = useState<RunStats>(emptyStats);
  const [boardKey, setBoardKey] = useState(0);
  const [picture, setPicture] = useState<HTMLImageElement>();
  const [remaining, setRemaining] = useState(LIVE_SECONDS);
  // The ranking tab's own filters. "" means all.
  const [rankMode, setRankMode] = useState("");
  const modelFilters = useModelFilters(models);

  // The webcam is the main input. The pictures are for repeatable comparisons. An uploaded photo plays
  // like a picture, an uploaded video like the webcam (not mirrored).
  const [uploadVersion, setUploadVersion] = useState(0);
  const source = arg === "upload" && uploaded ? "upload" : arg && pictureUrls[arg] ? arg : "webcam";
  const uploadedVideo = source === "upload" && uploaded?.kind === "video";
  const mode: Mode = source === "webcam" || uploadedVideo ? "live" : "still";
  const webcam = useWebcam();
  const fileVideo = useRef<HTMLVideoElement>(null);

  const run = useRef<Run | null>(null);
  const gameRef = useRef<Game | undefined>(undefined);
  const statusRef = useRef<Status>("setup");
  const statsRef = useRef<RunStats>(emptyStats);
  /** The run the still loop is playing, so only one loop plays at a time. */
  const loopRun = useRef<Run | null>(null);
  const mainCanvas = useRef<HTMLCanvasElement>(null);
  const zoomCanvases = useRef<Record<string, HTMLCanvasElement | null>>({});
  const shown = useRef<Record<string, Shown>>({});
  const [pictureBox, pictureWidth] = useSquareSide<HTMLDivElement>();
  const pictureSize = useRef(0);
  pictureSize.current = pictureWidth;
  // The judge cards: the game's judges, or before a game the judges to be.
  const cards = game?.judges ?? (slots.length > 0 ? createGame(slots, mode).judges : []);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  useEffect(() => {
    api.models().then((list) => {
      const usable = list.filter((m) => m.inputs.includes("image"));
      setModels(list);
      const preferred = preferredJudges.filter((key) => usable.some((m) => m.key === key));
      setSlots(preferred.length > 0 ? preferred : usable.slice(0, 3).map((m) => m.key));
    }, (e) => setNotice(message(e)));
  }, []);

  // Open the camera for a preview only when the browser already allows it: the permission prompt waits
  // for a click on "Turn on the camera" (or Start). Else load the picture and turn the camera off. An
  // uploaded video plays in its own <video>.
  useEffect(() => {
    setPicture(undefined);
    if (source === "webcam") {
      let cancelled = false;
      void cameraAllowed().then((allowed) => allowed && !cancelled && webcam.start());
      return () => {
        cancelled = true;
      };
    }
    webcam.stop();
    if (uploadedVideo) return;
    const img = new Image();
    img.onload = () => setPicture(img);
    img.src = source === "upload" ? uploaded!.url : pictureUrls[source]!;
  }, [source, uploadVersion]);

  const sourceEl = (): Source | null => {
    const video = source === "webcam" ? webcam.videoRef.current : uploadedVideo ? fileVideo.current : null;
    if (!video) return picture ?? null;
    return video.videoWidth > 0 ? video : null;
  };

  /** Keeps a picked file for this page load, and shows it. Nothing leaves the browser but the frames for the models. */
  function upload(file: File) {
    if (uploaded) URL.revokeObjectURL(uploaded.url);
    uploaded = { url: URL.createObjectURL(file), kind: file.type.startsWith("video/") ? "video" : "image", name: file.name };
    setUploadVersion((v) => v + 1);
    window.location.hash = "#/attention/upload";
  }

  // Draw on every animation frame: the video moves, and the squares glide. Before a game, the cards show
  // the judges to be, each looking at the whole frame.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      // A video file must keep playing, also after the browser paused it in the background.
      if (fileVideo.current?.paused) void fileVideo.current.play().catch(() => {});
      const src = sourceEl();
      if (!src || !mainCanvas.current) return;
      const g = gameRef.current;
      const judges = g?.judges ?? [];
      for (const judge of judges) shown.current[judge.id] = glide(shown.current[judge.id], judge, g!.mode);
      drawPicture(mainCanvas.current, src, judges, shown.current, g?.mode ?? mode, pictureSize.current || 480);
      for (const judge of g ? judges : cardsRef.current) {
        const canvas = zoomCanvases.current[judge.id];
        if (canvas) drawZoom(canvas, src, judge, shown.current[judge.id] ?? glide(undefined, judge, mode), zoomPx());
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [source, picture, webcam.status, uploadVersion]);

  const label = (key: string) => models.find((m) => m.key === key)?.label ?? key;
  const commit = (next: Game | undefined) => {
    gameRef.current = next;
    setGame(next);
  };
  const changeStatus = (next: Status) => {
    statusRef.current = next;
    setStatus(next);
  };
  const count = (call: Parameters<typeof addCall>[1]) => {
    statsRef.current = addCall(statsRef.current, call);
    setStats(statsRef.current);
  };
  const stopForBudget = (e: unknown) => {
    setNotice(`Paused: ${message(e)}`);
    changeStatus("paused");
  };

  async function finish(current: Run, final: Game) {
    if (run.current !== current || statusRef.current === "over") return;
    changeStatus("over");
    try {
      await api.addScores(current.runId, scores(final));
      setBoardKey((k) => k + 1);
    } catch (e) {
      setNotice(`Could not save scores: ${message(e)}`);
    }
    refreshBudget();
  }

  /** Still mode: every active judge answers, then the round applies. Returns true when the loop should stop. */
  async function stillRound(current: Run): Promise<boolean> {
    const g = gameRef.current!;
    const src = sourceEl();
    if (!src) return true;
    const active = g.judges.filter((j) => !j.done);
    const built = active.map((j) => callFor(g, j, src));
    const settled = await Promise.allSettled(
      active.map((j, i) => api.decide(j.model, current.runId, { ...built[i]!.call, signal: current.abort.signal })),
    );
    // Stopped, or replaced by a new game, while the calls were open.
    if (run.current !== current) return true;
    const overBudget = settled.find((r) => r.status === "rejected" && isBudgetError(r.reason));
    if (overBudget) {
      stopForBudget((overBudget as PromiseRejectedResult).reason);
      return true;
    }
    const turns: Record<string, Turn> = {};
    active.forEach((judge, i) => {
      const result = settled[i]!;
      if (result.status === "fulfilled") {
        turns[judge.id] = result.value;
        count(result.value);
      } else {
        turns[judge.id] = { error: message(result.reason) };
        count("error");
      }
    });
    const next = playRound(g, turns, squareOf(src).side);
    commit(next);
    if (isOver(next)) await finish(current, next);
    return isOver(next);
  }

  async function stillLoop(current: Run) {
    if (loopRun.current === current) return;
    loopRun.current = current;
    try {
      while (statusRef.current === "running" && run.current === current) {
        if (await stillRound(current)) break;
        await new Promise((r) => setTimeout(r, ROUND_PAUSE_MS));
      }
    } finally {
      if (loopRun.current === current) loopRun.current = null;
    }
  }

  // Live mode: one decision stream per judge, each on the current video frame, and a clock.
  useEffect(() => {
    const current = run.current;
    if (status !== "running" || current?.mode !== "live") return;
    const streams = gameRef.current!.judges
      .filter((j) => !j.done)
      .map((judge) => {
        // With one call in flight, the answer always belongs to the last call built.
        let side = 0;
        return decisionStream({
          everyMs: LIVE_EVERY_MS,
          maxInFlight: 1,
          makeCall: () => {
            const g = gameRef.current!;
            const me = g.judges.find((j) => j.id === judge.id)!;
            const src = sourceEl();
            if (me.done || !src) return null;
            const built = callFor(g, me, src);
            side = built.side;
            return built.call;
          },
          decide: (call, signal) => api.decide(judge.model, current.runId, { ...call, signal }),
          onResult: (decision) => {
            count(decision);
            commit(playLive(gameRef.current!, judge.id, decision, side));
          },
          onError: (e) => {
            if (isBudgetError(e)) return stopForBudget(e);
            count("error");
            commit(playLive(gameRef.current!, judge.id, { error: message(e) }, side));
          },
        });
      });
    let last = performance.now();
    const clock = setInterval(() => {
      if (statusRef.current !== "running") return;
      const now = performance.now();
      current.elapsedMs += now - last;
      last = now;
      setRemaining(Math.max(0, Math.ceil(LIVE_SECONDS - current.elapsedMs / 1000)));
      const g = gameRef.current!;
      if (current.elapsedMs >= LIVE_SECONDS * 1000 || isOver(g)) void finish(current, g);
    }, 250);
    return () => {
      clearInterval(clock);
      for (const s of streams) s.stop();
    };
  }, [status]);

  async function start() {
    setNotice(undefined);
    run.current?.abort.abort();
    run.current = null;
    try {
      if (source === "webcam" && webcam.status !== "on" && !(await webcam.start())) return;
      if (mode === "still" && !picture) return setNotice("The picture is still loading.");
      const runId = await api.createRun(`attention-${mode}`, { models: slots, source, mode });
      const current: Run = { runId, mode, abort: new AbortController(), elapsedMs: 0 };
      run.current = current;
      statsRef.current = emptyStats;
      setStats(emptyStats);
      setRemaining(LIVE_SECONDS);
      shown.current = {};
      commit(createGame(slots, mode));
      changeStatus("running");
      if (mode === "still") void stillLoop(current);
    } catch (e) {
      setNotice(message(e));
    }
  }

  function resume() {
    setNotice(undefined);
    changeStatus("running");
    if (run.current?.mode === "still") void stillLoop(run.current);
  }

  /** Ends the game without scores and goes back to the setup. Calls already made stay in the database. */
  function stop() {
    run.current?.abort.abort();
    run.current = null;
    commit(undefined);
    statsRef.current = emptyStats;
    setStats(emptyStats);
    changeStatus("setup");
    setNotice("Stopped. The game was not scored.");
    refreshBudget();
  }

  const sourceName = source === "webcam" ? "Live webcam" : source === "upload" ? (uploaded?.name ?? "Your file") : (attentionImages.find((img) => img.id === source)?.name ?? source);
  const elapsed = LIVE_SECONDS - remaining;
  const progress =
    game?.mode === "live"
      ? { value: elapsed / LIVE_SECONDS, left: `0:${String(elapsed).padStart(2, "0")}`, right: `0:${String(LIVE_SECONDS).padStart(2, "0")}` }
      : game
        ? { value: game.round / MAX_ROUNDS, left: `round ${game.round}`, right: `${MAX_ROUNDS}` }
        : undefined;
  const subtitle = `${sourceName} · ${cards.length} ${cards.length === 1 ? "judge" : "judges"} · ${status === "running" ? (mode === "live" ? "watching" : "exploring") : status}`;

  return (
    <GameFrame
      info={info}
      controls={{
        status,
        startLabel: mode === "live" ? "Start watching" : "Start exploring",
        canStart: slots.length > 0,
        onStart: start,
        onPause: () => changeStatus("paused"),
        onResume: resume,
        onStop: stop,
        onSetup: () => {
          commit(undefined);
          changeStatus("setup");
        },
      }}
      stats={stats}
      players={cards.map((judge) => ({ label: label(judge.model), color: agentColors[judge.id]! }))}
      subtitle={subtitle}
      progress={progress}
      live={mode === "live"}
      board={
        <Board
          game={rankMode ? [`attention-${rankMode}`] : ["attention-live", "attention-still"]}
          include={modelFilters.include}
          toolbar={
            <>
              <FilterChips
                label="Input"
                value={rankMode}
                onChange={setRankMode}
                options={[
                  { value: "", label: "All" },
                  { value: "live", label: "Webcam and videos" },
                  { value: "still", label: "Pictures" },
                ]}
              />
              {modelFilters.controls}
            </>
          }
          models={models}
          refreshKey={boardKey}
          columns={[
            { metric: "max_depth", label: "Max depth", format: (n) => n.toFixed(1) },
            { metric: "mean_depth", label: "Mean depth" },
            { metric: "step_backs", label: "Step-backs", format: (n) => n.toFixed(1) },
            { metric: "mean_interest", label: "Interest (0-3)" },
            ...interestLevels.map((level) => ({ metric: `reaction_${level}`, label: reactions[level], format: (n: number) => `${Math.round(n * 100)}%` })),
            { metric: "decisiveness", label: "Decisive", format: (n) => `${Math.round(n * 100)}%` },
            { metric: "regions", label: "Regions", format: (n) => n.toFixed(1) },
            { metric: "rounds", label: "Turns", format: (n) => n.toFixed(1) },
            { metric: "latency_ms", label: "Latency", format: (n) => `${Math.round(n)} ms` },
            { metric: "cost_usd", label: "Cost", format: usd },
          ]}
        />
      }
    >
      {notice && (
        <Alert data-chrome>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {status === "setup" && (
        <Card data-chrome className="gap-4 px-5 py-4">
          <SetupRow label="Input">
            <InputChooser value={source} onUpload={upload} />
            <p className="text-sm text-muted-foreground">
              {uploadedVideo
                ? "Each judge looks again about twice a second while your video plays."
                : mode === "live"
                ? "Each judge looks again about twice a second. Move, hold things up, and watch the squares follow."
                : `Each judge picks a cell, then zooms in, steps back or stops. Up to ${MAX_ROUNDS} rounds.`}
            </p>
          </SetupRow>
          <SetupRow label="Judges">
            <ModelPicker models={models} value={slots} onChange={setSlots} min={1} max={3} needs={["image"]} slotLabel={(i) => `Judge ${i + 1}`} />
          </SetupRow>
        </Card>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <div
          ref={pictureBox}
          className="relative aspect-square w-full shrink-0 overflow-hidden rounded-2xl border bg-black lg:w-[min(52%,calc(100vh-15.5rem))] lg:[html.stage_&]:w-[min(52%,calc(100vh-11.5rem))] maximized:flex maximized:items-center maximized:justify-center maximized:rounded-none maximized:border-0 maximized:bg-black"
        >
          <canvas ref={mainCanvas} className="block" />
          <FullscreenButton target={pictureBox} />
          {mode === "live" && status === "running" && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 font-mono text-xs backdrop-blur">
              <span className="size-2 animate-pulse rounded-full bg-live" /> LIVE <span className="text-muted-foreground">{remaining}s</span>
            </div>
          )}
          {source === "webcam" && webcam.status !== "on" && <CameraGate status={webcam.status} error={webcam.error} onStart={() => void webcam.start()} />}
          {source === "webcam" && webcam.status === "on" && webcam.canFlip && (
            <Tip text="Switch between the front and the back camera">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Switch camera"
                onClick={() => void webcam.flip()}
                className="absolute top-3 right-13 z-10 bg-black/50 opacity-60 backdrop-blur transition-opacity hover:opacity-100"
              >
                <SwitchCamera />
              </Button>
            </Tip>
          )}
          <video ref={webcam.videoRef} muted playsInline className="pointer-events-none absolute size-px opacity-0" />
          {uploadedVideo && (
            // Full size behind the canvas: Chrome pauses a muted video it thinks nobody sees (a 1 px, transparent one).
            <video
              key={uploadVersion}
              ref={fileVideo}
              src={uploaded!.url}
              muted
              loop
              autoPlay
              playsInline
              onCanPlay={(e) => void e.currentTarget.play().catch(() => {})}
              className="pointer-events-none absolute inset-0 -z-10 size-full object-cover"
            />
          )}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3">
          {status === "over" && game && <AttentionResult game={game} label={label} elapsedMs={run.current?.elapsedMs ?? 0} />}
          {cards.map((judge) => (
            <JudgeCard
              key={judge.id}
              judge={judge}
              mode={game?.mode ?? mode}
              label={label(judge.model)}
              waiting={!game}
              canvasRef={(el) => {
                zoomCanvases.current[judge.id] = el;
              }}
            />
          ))}
        </div>
      </div>
    </GameFrame>
  );
}

/** How the session ended, and where each judge looked. */
function AttentionResult({ game, label, elapsedMs }: { game: Game; label: (key: string) => string; elapsedMs: number }) {
  const detail =
    game.mode === "live"
      ? elapsedMs >= LIVE_SECONDS * 1000
        ? `${LIVE_SECONDS} seconds are up.`
        : "Every judge stopped."
      : game.round >= MAX_ROUNDS
        ? `${MAX_ROUNDS} rounds are done.`
        : "Every judge has seen enough.";
  return (
    <ResultCard
      title="Session over"
      detail={detail}
      rows={game.judges.map((judge) => {
        const steps = judge.steps;
        const counts = new Map<string, number>();
        for (const s of steps) if (s.focus) counts.set(s.focus, (counts.get(s.focus) ?? 0) + 1);
        const favorite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return {
          key: judge.id,
          label: label(judge.model),
          color: agentColors[judge.id]!,
          out: judge.done && judge.errorsInARow > 0,
          stats: [
            `${steps.length} looks`,
            `up to ${3 ** Math.max(0, ...steps.map((s) => s.depth))}x`,
            ...(favorite ? [`mostly ${favorite}`] : []),
            ...interestLevels.flatMap((level) => {
              const n = steps.filter((s) => s.reaction === level).length;
              return n > 0 ? [`${reactions[level]} ${n}`] : [];
            }),
          ],
        };
      })}
    />
  );
}

/** Fills the empty picture square until the camera plays: a button that asks for the camera, a wait while
 * the browser asks, or what went wrong. */
function CameraGate({ status, error, onStart }: { status: "off" | "starting" | "error"; error?: string; onStart: () => void }) {
  const failed = status === "error";
  const Icon = failed ? CameraOff : Camera;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,oklch(0.2_0.01_265),oklch(0.11_0.008_265)_75%)] p-6 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(circle_at_center,black_10%,transparent_60%)]" />
      <span className={cn("relative grid size-14 place-items-center rounded-full border bg-white/[0.04]", status === "starting" && "animate-pulse")}>
        {status === "starting" ? <LoaderCircle className="size-6 animate-spin text-muted-foreground" /> : <Icon className={cn("size-6", failed ? "text-destructive" : "text-foreground")} />}
      </span>
      <div className="relative max-w-72 space-y-1.5">
        <p className="font-medium">{status === "starting" ? "Waiting for the camera" : failed ? "The camera did not open" : "Show the models your world"}</p>
        <p className="text-sm text-muted-foreground">
          {status === "starting"
            ? "Allow the camera in the browser's prompt."
            : failed
              ? `${error ?? "Unknown error"}. Check the camera permission next to the address bar, then try again.`
              : "The judges watch your camera and zoom in on what catches their eye. Only the models see the frames. The arcade keeps no images."}
        </p>
      </div>
      {status !== "starting" && (
        <Button className="relative" onClick={onStart}>
          <Camera /> {failed ? "Try again" : "Turn on the camera"}
        </Button>
      )}
    </div>
  );
}

/** The webcam, then the 6 pictures, as square tiles. The choice lives in the URL. */
function InputChooser({ value, onUpload }: { value: string; onUpload: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const tile = (id: string, name: string, content: ReactNode) => (
    <Tooltip key={id}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={name}
          aria-pressed={value === id}
          onClick={() => (window.location.hash = `#/attention/${id}`)}
          className={cn(
            "flex size-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border bg-white/[0.03] text-muted-foreground transition",
            value === id ? "text-foreground ring-2 ring-foreground ring-offset-2 ring-offset-card" : "opacity-60 hover:opacity-100",
          )}
        >
          {content}
        </button>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className="flex flex-wrap gap-2.5">
      {tile(
        "webcam",
        "Live webcam",
        <>
          <Camera className="size-5" />
          <span className="caps text-[9px]">Live</span>
        </>,
      )}
      {attentionImages.map((img) => tile(img.id, img.name, <img src={pictureUrls[img.id]} alt="" className="size-full object-cover" />))}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Upload a photo or a video"
            aria-pressed={value === "upload"}
            onClick={() => fileInput.current?.click()}
            className={cn(
              "flex size-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-dashed bg-white/[0.03] text-muted-foreground transition",
              value === "upload" ? "text-foreground ring-2 ring-foreground ring-offset-2 ring-offset-card" : "opacity-60 hover:opacity-100",
            )}
          >
            {value === "upload" && uploaded?.kind === "video" ? <Film className="size-5" /> : value === "upload" ? <ImageIcon className="size-5" /> : <Upload className="size-5" />}
            <span className="caps text-[9px]">{value === "upload" ? "Yours" : "Upload"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{value === "upload" && uploaded ? `${uploaded.name}. Click to pick another file.` : "Your own photo or video. It stays in this browser."}</TooltipContent>
      </Tooltip>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** One judge: its zoomed view in its color, then how interested it is and what it does next. */
function JudgeCard({ judge, mode, label, waiting, canvasRef }: { judge: Judge; mode: Mode; label: string; waiting: boolean; canvasRef: (el: HTMLCanvasElement | null) => void }) {
  const color = agentColors[judge.id]!;
  const failed = judge.done && judge.errorsInARow > 0;
  const state = failed ? "failed" : judge.done ? "stopped" : judge.focus ? `focus ${judge.focus}` : waiting ? "ready" : "looking";
  return (
    <Card className={cn("flex-row items-center gap-4 p-3 transition-opacity", failed && "opacity-50")}>
      <div className="relative size-24 shrink-0 overflow-hidden rounded-lg sm:size-[120px]" style={{ boxShadow: `0 0 0 2px ${color}, 0 0 18px ${color}55` }}>
        <canvas ref={canvasRef} className="block" />
        <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px]">{3 ** depthOf(judge, mode)}x</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <ModelName label={label} color={color} />
          <Badge variant="outline" className="ml-auto font-mono text-[10px] text-muted-foreground">
            {state}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-5">
          <InterestMeter answer={judge.lastAnswers?.interest} color={color} />
          <ProbabilityBars title="next" answer={judge.lastAnswers?.move} color={color} minRows={3} />
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">
          {judge.calls} calls · {judge.calls > 0 ? Math.round(judge.latencyMs / judge.calls) : 0} ms · {usd(judge.costUsd)}
          {mode === "still" && judge.trail.length > 0 && ` · ${judge.trail.join(" > ")}`}
          {judge.refusals > 0 && ` · ${judge.refusals} refusals`}
          {judge.errors > 0 && ` · ${judge.errors} errors`}
        </div>
      </div>
    </Card>
  );
}

/** The reaction as a big emoji on a tinted pill that pops when it changes, and four segments lit up to the level. */
function InterestMeter({ answer, color }: { answer: Answer | undefined; color: string }) {
  const level = answer?.type === "score" ? (answer.level as InterestLevel) : undefined;
  const lit = level === undefined ? -1 : interestLevels.indexOf(level);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="caps text-[10px] text-muted-foreground">interest</span>
        {level ? (
          // The key remounts the pill on each new level, so the pop plays again.
          <span
            key={level}
            className="flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-xs font-medium duration-300 animate-in fade-in zoom-in-50"
            style={{ background: `${reactionTints[level]}33`, boxShadow: `inset 0 0 0 1px ${reactionTints[level]}88` }}
          >
            <span className="text-xl leading-none">{reactions[level]}</span>
            {level}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{answer?.type === "refusal" ? "refused" : "waiting"}</span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {interestLevels.map((name, i) => (
          <span key={name} className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <span className="block h-full rounded-full transition-opacity duration-300" style={{ background: color, opacity: i <= lit ? 1 : 0 }} />
          </span>
        ))}
      </div>
    </div>
  );
}
