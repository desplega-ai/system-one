import { decisionStream } from "@system-one/ai";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type BudgetInfo, type ModelInfo } from "../../web/lib/api.ts";
import { useWebcam } from "../../web/lib/hooks.ts";
import { cropImage, fullView, gridImage, overviewImage, type Source, squareOf } from "../../web/lib/media.ts";
import { Board } from "../../web/ui/Board.tsx";
import { agentColors } from "../../web/ui/colors.ts";
import { addCall, emptyStats, Hud, type RunStats, usd } from "../../web/ui/Hud.tsx";
import { ModelPicker } from "../../web/ui/ModelPicker.tsx";
import { ProbabilityBars } from "../../web/ui/ProbabilityBars.tsx";
import {
  createGame,
  currentView,
  depthOf,
  earlierViews,
  type Game,
  history,
  interestLevels,
  isOver,
  type Judge,
  MAX_ROUNDS,
  type Mode,
  playLive,
  playRound,
  scores,
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
const LIVE_SECONDS = 60;
const preferredJudges = ["cloudflare:clef-flash", "typesafe:jev-latest", "openai:gpt-6-luna"];
const interestQuestion = { type: "score", instructions: "", levels: interestLevels } as const;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudgetError = (e: unknown) => e instanceof ApiError && e.code === "budget_exceeded";

/**
 * The call for one judge, built from the current picture or video frame.
 * Still: the grid on the judge's view, and the whole picture as image 2.
 * Live: the grid always on the whole frame (with the view as a red box), and the zoomed view as image 2.
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

/** `arg` is an image id or "webcam", for example #/attention/attic. */
export function Attention({ arg }: { arg?: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [game, setGame] = useState<Game>();
  const [status, setStatus] = useState<Status>("setup");
  const [notice, setNotice] = useState<string>();
  const [stats, setStats] = useState<RunStats>(emptyStats);
  const [budget, setBudget] = useState<BudgetInfo>();
  const [boardKey, setBoardKey] = useState(0);
  const [picture, setPicture] = useState<HTMLImageElement>();
  const [remaining, setRemaining] = useState(LIVE_SECONDS);

  // The webcam is the main input. The pictures are for repeatable comparisons.
  const source = arg && pictureUrls[arg] ? arg : "webcam";
  const mode: Mode = source === "webcam" ? "live" : "still";
  const webcam = useWebcam();

  const run = useRef<Run | null>(null);
  const gameRef = useRef<Game | undefined>(undefined);
  const statusRef = useRef<Status>("setup");
  const statsRef = useRef<RunStats>(emptyStats);
  /** The run the still loop is playing, so only one loop plays at a time. */
  const loopRun = useRef<Run | null>(null);
  const mainCanvas = useRef<HTMLCanvasElement>(null);
  const zoomCanvases = useRef<Record<string, HTMLCanvasElement | null>>({});
  const shown = useRef<Record<string, Shown>>({});

  useEffect(() => {
    api.models().then((list) => {
      const usable = list.filter((m) => m.inputs.includes("image"));
      setModels(list);
      const preferred = preferredJudges.filter((key) => usable.some((m) => m.key === key));
      setSlots(preferred.length > 0 ? preferred : usable.slice(0, 3).map((m) => m.key));
    }, (e) => setNotice(message(e)));
    api.budget().then(setBudget, () => {});
  }, []);

  // Open the camera for a preview, or load the picture and turn the camera off.
  useEffect(() => {
    setPicture(undefined);
    if (source === "webcam") {
      void webcam.start();
      return;
    }
    webcam.stop();
    const img = new Image();
    img.onload = () => setPicture(img);
    img.src = pictureUrls[source]!;
  }, [source]);

  const sourceEl = (): Source | null => {
    if (source !== "webcam") return picture ?? null;
    const video = webcam.videoRef.current;
    return video && video.videoWidth > 0 ? video : null;
  };

  // Draw on every animation frame: the video moves, and the squares glide.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const src = sourceEl();
      if (!src || !mainCanvas.current) return;
      const g = gameRef.current;
      const judges = g?.judges ?? [];
      for (const judge of judges) shown.current[judge.id] = glide(shown.current[judge.id], judge, g!.mode);
      drawPicture(mainCanvas.current, src, judges, shown.current, g?.mode ?? mode);
      for (const judge of judges) {
        const canvas = zoomCanvases.current[judge.id];
        if (canvas) drawZoom(canvas, src, judge, shown.current[judge.id]!);
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [source, picture, webcam.status]);

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
    api.budget().then(setBudget, () => {});
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
      if (mode === "live" && webcam.status !== "on" && !(await webcam.start())) return;
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
    api.budget().then(setBudget, () => {});
  }

  const playing = status === "running" || status === "paused";
  const boardGame = `attention-${run.current?.mode ?? mode}`;

  return (
    <section className="attention">
      <div className="game-setup card">
        <div className="row">
          <label>
            Input{" "}
            <select value={source} onChange={(e) => (window.location.hash = `#/attention/${e.target.value}`)} disabled={playing}>
              <option value="webcam">Live webcam ({LIVE_SECONDS} s)</option>
              {attentionImages.map((img) => (
                <option key={img.id} value={img.id}>
                  Picture: {img.name}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">
            {mode === "live"
              ? "Each judge keeps choosing where to look on your live camera, about twice a second. Move, hold things up, and watch the squares follow."
              : `Each judge picks the cell it is most curious about, then zooms in, steps back or stops. Up to ${MAX_ROUNDS} rounds.`}
          </span>
        </div>
        <ModelPicker models={models} value={slots} onChange={setSlots} min={1} max={3} needs={["image"]} slotLabel={(i) => `Judge ${i + 1}`} />
        <div className="row">
          <button type="button" onClick={start} disabled={status === "running" || slots.length < 1}>
            {status === "setup" ? "Start" : "New game"}
          </button>
          {status === "running" && (
            <button type="button" onClick={() => changeStatus("paused")}>
              Pause
            </button>
          )}
          {status === "paused" && (
            <button type="button" onClick={resume}>
              Resume
            </button>
          )}
          {playing && (
            <button type="button" onClick={stop}>
              Stop
            </button>
          )}
          <span className="muted">
            {status}
            {game && playing && (game.mode === "live" ? `, ${remaining} s left` : `, round ${game.round} of ${MAX_ROUNDS}`)}
          </span>
          {webcam.error && <span className="refused">Camera: {webcam.error}</span>}
        </div>
        {notice && <p className="refused">{notice}</p>}
        <Hud stats={stats} budget={budget} />
      </div>

      <div className="attention-play">
        <div>
          <canvas ref={mainCanvas} className="picture" />
          {mode === "live" && webcam.status !== "on" && <p className="muted">{webcam.status === "starting" ? "Opening the camera." : "The camera is off. Start opens it."}</p>}
          <video ref={webcam.videoRef} muted playsInline className="offscreen" />
        </div>
        {game && (
          <div className="agent-cards">
            {game.judges.map((judge) => (
              <div className={judge.done && judge.errorsInARow > 0 ? "card agent out" : "card agent"} key={judge.id}>
                <div className="agent-head">
                  <span className="swatch" style={{ background: agentColors[judge.id] }} />
                  <strong>{judge.id}</strong>
                  <span>{label(judge.model)}</span>
                  <span className="hp">{judge.done ? (judge.errorsInARow > 0 ? "failed" : "stopped") : `zoom ${3 ** depthOf(judge, game.mode)}x`}</span>
                </div>
                <canvas
                  className="zoom"
                  ref={(el) => {
                    zoomCanvases.current[judge.id] = el;
                  }}
                />
                <div className="muted small">
                  focus {judge.focus ?? "none"}
                  {judge.trail.length > 0 && `, at ${judge.trail.join(" > ")}`}
                </div>
                <ProbabilityBars title="move" answer={judge.lastAnswers?.move} />
                <ProbabilityBars title="interest" question={interestQuestion} answer={judge.lastAnswers?.interest} />
                <ol className="memory muted small">
                  {history(judge, 3).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <div className="muted small">
                  {judge.calls} calls, {judge.calls > 0 ? Math.round(judge.latencyMs / judge.calls) : 0} ms, {usd(judge.costUsd)}
                  {judge.refusals > 0 && `, ${judge.refusals} refusals`}
                  {judge.errors > 0 && `, ${judge.errors} errors`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3>Rankings ({boardGame})</h3>
      <Board
        game={boardGame}
        models={models}
        refreshKey={boardKey}
        columns={[
          { metric: "max_depth", label: "Max depth", format: (n) => n.toFixed(1) },
          { metric: "mean_depth", label: "Mean depth" },
          { metric: "step_backs", label: "Step-backs", format: (n) => n.toFixed(1) },
          { metric: "mean_interest", label: "Interest (0-3)" },
          { metric: "decisiveness", label: "Decisive", format: (n) => `${Math.round(n * 100)}%` },
          { metric: "regions", label: "Regions", format: (n) => n.toFixed(1) },
          { metric: "rounds", label: "Turns", format: (n) => n.toFixed(1) },
          { metric: "latency_ms", label: "Latency", format: (n) => `${Math.round(n)} ms` },
          { metric: "cost_usd", label: "Cost", format: usd },
        ]}
      />
    </section>
  );
}
