import { decisionStream } from "@system-one/ai";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type BudgetInfo, type ModelInfo } from "../../web/lib/api.ts";
import { Board } from "../../web/ui/Board.tsx";
import { agentColors } from "../../web/ui/colors.ts";
import { addCall, emptyStats, Hud, type RunStats, usd } from "../../web/ui/Hud.tsx";
import { ModelPicker } from "../../web/ui/ModelPicker.tsx";
import { ProbabilityBars } from "../../web/ui/ProbabilityBars.tsx";
import {
  alive,
  createMatch,
  createRng,
  endReason,
  isOver,
  type Match,
  MAX_TICKS,
  type Policy,
  playTick,
  type Rng,
  STALEMATE_TURNS,
  scores,
  standings,
  type Turn,
} from "./engine.ts";
import { type Clock, presets } from "./presets.ts";
import { drawArena } from "./render.ts";
import { questionsFor, stateFor } from "./state.ts";

type Status = "setup" | "running" | "paused" | "over";
/** One match. Stop or a new match aborts its open calls, and late answers are dropped. */
type Run = { runId: string; rng: Rng; policy: Policy; clock: Clock; abort: AbortController };

/** Lockstep waits this long between ticks, so people can follow the match. */
const LOCKSTEP_PAUSE_MS = 400;
/** Real-time: the engine ticks this often, and agents act when they have a new answer. 600 ticks = 60 s. */
const REALTIME_TICK_MS = 100;
const REALTIME_MAX_TICKS = 600;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudgetError = (e: unknown) => e instanceof ApiError && e.code === "budget_exceeded";

/** `arg` is a preset id from the URL, for example #/arena/standoff. */
export function Arena({ arg }: { arg?: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Policy>("sample");
  const [clock, setClock] = useState<Clock>("lockstep");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [stalemateTurns, setStalemateTurns] = useState(STALEMATE_TURNS);
  const [match, setMatch] = useState<Match>();
  const [status, setStatus] = useState<Status>("setup");
  const [notice, setNotice] = useState<string>();
  const [stats, setStats] = useState<RunStats>(emptyStats);
  const [budget, setBudget] = useState<BudgetInfo>();
  const [boardKey, setBoardKey] = useState(0);

  const run = useRef<Run | null>(null);
  const matchRef = useRef<Match | undefined>(undefined);
  const statusRef = useRef<Status>("setup");
  const statsRef = useRef<RunStats>(emptyStats);
  /** The run the lockstep loop (or a Step) is playing, so only one plays at a time. */
  const loopRun = useRef<Run | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    api.models().then((list) => {
      setModels(list);
      setSlots(list.slice(0, 3).map((m) => m.key));
    }, (e) => setNotice(message(e)));
    api.budget().then(setBudget, () => {});
  }, []);

  const label = (key: string) => models.find((m) => m.key === key)?.label ?? key;
  const preset = presets.find((p) => p.id === arg);
  const hasModels = (keys: string[]) => keys.every((key) => models.some((m) => m.key === key));
  useEffect(() => {
    if (!preset || models.length === 0 || !hasModels(preset.models) || statusRef.current === "running") return;
    setSlots(preset.models);
    setClock(preset.clock);
    setPolicy(preset.policy);
    setSeed(preset.seed);
    setStalemateTurns(preset.stalemateTurns);
  }, [preset, models]);

  const labels = Object.fromEntries((match?.agents ?? []).map((a) => [a.id, label(a.model)]));
  useEffect(() => {
    if (canvas.current && match) drawArena(canvas.current, match, labels);
  });

  const commit = (next: Match | undefined) => {
    matchRef.current = next;
    setMatch(next);
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

  async function finish(current: Run, final: Match) {
    changeStatus("over");
    try {
      await api.addScores(current.runId, scores(final));
      setBoardKey((k) => k + 1);
    } catch (e) {
      setNotice(`Could not save scores: ${message(e)}`);
    }
    api.budget().then(setBudget, () => {});
  }

  /** Lockstep: every standing agent decides, then the tick resolves. Returns true when the loop should stop. */
  async function lockstepTick(current: Run): Promise<boolean> {
    const m = matchRef.current!;
    const standing = alive(m);
    const settled = await Promise.allSettled(
      standing.map((agent) =>
        api.decide(agent.model, current.runId, { state: stateFor(m, agent), questions: questionsFor(m, agent), signal: current.abort.signal }),
      ),
    );
    // Stopped, or replaced by a new match, while the calls were open.
    if (run.current !== current) return true;
    const overBudget = settled.find((r) => r.status === "rejected" && isBudgetError(r.reason));
    if (overBudget) {
      stopForBudget((overBudget as PromiseRejectedResult).reason);
      return true;
    }
    const turns: Record<string, Turn> = {};
    standing.forEach((agent, i) => {
      const result = settled[i]!;
      if (result.status === "fulfilled") {
        turns[agent.id] = result.value;
        count(result.value);
      } else {
        turns[agent.id] = { error: message(result.reason) };
        count("error");
      }
    });
    const next = playTick(m, turns, current.policy, current.rng);
    commit(next);
    if (isOver(next)) await finish(current, next);
    return isOver(next);
  }

  async function lockstepLoop(current: Run) {
    if (loopRun.current === current) return;
    loopRun.current = current;
    try {
      while (statusRef.current === "running" && run.current === current) {
        if (await lockstepTick(current)) break;
        await new Promise((r) => setTimeout(r, LOCKSTEP_PAUSE_MS));
      }
    } finally {
      if (loopRun.current === current) loopRun.current = null;
    }
  }

  // Real-time: one decision stream per agent, and an engine tick every REALTIME_TICK_MS.
  useEffect(() => {
    const current = run.current;
    if (status !== "running" || current?.clock !== "realtime") return;
    const pending: Record<string, Turn> = {};
    const streams = alive(matchRef.current!).map((agent) =>
      decisionStream({
        // With one call in flight, the next call starts within 20 ms of the last answer.
        everyMs: 20,
        maxInFlight: 1,
        makeCall: () => {
          const m = matchRef.current!;
          const me = m.agents.find((a) => a.id === agent.id)!;
          if (me.hp <= 0 || isOver(m)) return null;
          // Built at call time, so a slow model acts on an older state.
          return { state: stateFor(m, me), questions: questionsFor(m, me) };
        },
        decide: (call, signal) => api.decide(agent.model, current.runId, { ...call, signal }),
        onResult: (decision) => {
          // Two answers in one tick: act on the newest, but keep the cost and latency of both.
          const before = pending[agent.id];
          pending[agent.id] =
            before && !("error" in before)
              ? {
                  ...decision,
                  calls: (before.calls ?? 1) + 1,
                  latencyMs: before.latencyMs + decision.latencyMs,
                  usage: { ...decision.usage, costUsd: (before.usage.costUsd ?? 0) + (decision.usage.costUsd ?? 0) },
                }
              : decision;
          count(decision);
        },
        onError: (e) => {
          if (isBudgetError(e)) return stopForBudget(e);
          pending[agent.id] = { error: message(e) };
          count("error");
        },
      }),
    );
    const timer = setInterval(() => {
      // The match can end (or pause for the budget) before React runs this effect's cleanup.
      if (statusRef.current !== "running") return;
      const turns = { ...pending };
      for (const id of Object.keys(pending)) delete pending[id];
      const next = playTick(matchRef.current!, turns, current.policy, current.rng);
      commit(next);
      if (isOver(next)) void finish(current, next);
    }, REALTIME_TICK_MS);
    return () => {
      clearInterval(timer);
      for (const s of streams) s.stop();
    };
  }, [status]);

  async function start() {
    setNotice(undefined);
    run.current?.abort.abort();
    run.current = null;
    try {
      const game = `arena-${clock}`;
      const maxTicks = clock === "realtime" ? REALTIME_MAX_TICKS : MAX_TICKS;
      const runId = await api.createRun(game, { models: slots, seed, policy, clock, maxTicks, stalemateTurns, preset: preset?.id ?? null });
      const current: Run = { runId, rng: createRng(seed), policy, clock, abort: new AbortController() };
      run.current = current;
      statsRef.current = emptyStats;
      setStats(emptyStats);
      commit(createMatch(slots, { maxTicks, stalemateTurns }));
      changeStatus("running");
      if (clock === "lockstep") void lockstepLoop(current);
    } catch (e) {
      setNotice(message(e));
    }
  }

  function resume() {
    setNotice(undefined);
    changeStatus("running");
    if (run.current?.clock === "lockstep") void lockstepLoop(run.current);
  }

  async function step() {
    const current = run.current;
    if (!current || statusRef.current !== "paused" || current.clock !== "lockstep" || loopRun.current) return;
    loopRun.current = current;
    try {
      await lockstepTick(current);
    } finally {
      if (loopRun.current === current) loopRun.current = null;
    }
  }

  /** Ends the match without scores and goes back to the setup. Calls already made stay in the database. */
  function stop() {
    run.current?.abort.abort();
    run.current = null;
    commit(undefined);
    statsRef.current = emptyStats;
    setStats(emptyStats);
    changeStatus("setup");
    setNotice("Stopped. The match was not scored.");
    api.budget().then(setBudget, () => {});
  }

  const playing = status === "running" || status === "paused";
  const game = `arena-${run.current?.clock ?? clock}`;

  return (
    <section className="arena">
      <div className="arena-setup card">
        <div className="row">
          <label>
            Preset{" "}
            <select
              value={preset?.id ?? ""}
              onChange={(e) => (window.location.hash = e.target.value ? `#/arena/${e.target.value}` : "#/arena")}
              disabled={playing}
            >
              <option value="">custom</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} disabled={models.length > 0 && !hasModels(p.models)}>
                  {p.name}: {p.models.length > 3 ? `${p.models.length} models` : p.models.map(label).join(" vs ")}
                  {models.length > 0 && !hasModels(p.models) ? " (missing keys)" : ""}
                </option>
              ))}
            </select>
          </label>
          {preset && (
            <span className="muted">
              {preset.clock === "realtime" ? "Real-time" : "Lockstep"}, {preset.policy === "top" ? "top answers" : "sampling"}. {preset.description}
            </span>
          )}
        </div>
        <ModelPicker models={models} value={slots} onChange={setSlots} min={2} max={6} needs={["text"]} />
        <div className="row">
          <label>
            Clock{" "}
            <select value={clock} onChange={(e) => setClock(e.target.value as Clock)} disabled={playing}>
              <option value="lockstep">lockstep (fair turns)</option>
              <option value="realtime">real-time (speed counts)</option>
            </select>
          </label>
          <label>
            Policy{" "}
            <select value={policy} onChange={(e) => setPolicy(e.target.value as Policy)} disabled={playing}>
              <option value="sample">sample from probabilities</option>
              <option value="top">top answer</option>
            </select>
          </label>
          <label>
            Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={playing} style={{ width: 100 }} />
          </label>
          <label title="The match ends in a draw when nobody fires for this many turns in a row. The models know the rule.">
            Draw after{" "}
            <input
              type="number"
              min={1}
              value={stalemateTurns}
              onChange={(e) => setStalemateTurns(Math.max(1, Number(e.target.value)))}
              disabled={playing}
              style={{ width: 60 }}
            />{" "}
            quiet turns
          </label>
        </div>
        <div className="row">
          <button type="button" onClick={start} disabled={status === "running" || slots.length < 2}>
            {status === "setup" ? "Start" : "New match"}
          </button>
          {status === "running" && (
            <button type="button" onClick={() => changeStatus("paused")}>
              Pause
            </button>
          )}
          {status === "paused" && (
            <>
              <button type="button" onClick={resume}>
                Resume
              </button>
              {run.current?.clock === "lockstep" && (
                <button type="button" onClick={step}>
                  Step
                </button>
              )}
            </>
          )}
          {playing && (
            <button type="button" onClick={stop}>
              Stop
            </button>
          )}
          <span className="muted">{match && status === "over" ? outcome(match) : status}</span>
          {match && status !== "setup" && status !== "over" && match.quietTurns > 0 && (
            <span className="muted">
              quiet for {match.quietTurns} of {match.stalemateTurns} turns
            </span>
          )}
        </div>
        {notice && <p className="refused">{notice}</p>}
        <Hud stats={stats} budget={budget} />
      </div>

      {match && (
        <div className="arena-play">
          <div>
            <canvas ref={canvas} />
            <ol className="events muted">
              {match.events.slice(0, 8).map((e, i) => (
                <li key={`${match.tick}-${i}`}>{e}</li>
              ))}
            </ol>
          </div>
          <div className="agent-cards">
            {match.agents.map((agent) => (
              <div className={agent.hp > 0 ? "card agent" : "card agent out"} key={agent.id}>
                <div className="agent-head">
                  <span className="swatch" style={{ background: agentColors[agent.id] }} />
                  <strong>{agent.id}</strong>
                  <span>{labels[agent.id]}</span>
                  <span className="hp">{agent.hp > 0 ? "♥".repeat(agent.hp) : "out"}</span>
                </div>
                <ProbabilityBars title="move" answer={agent.lastAnswers?.move} />
                <ProbabilityBars title="target" answer={agent.lastAnswers?.target} />
                <ProbabilityBars title="fire" answer={agent.lastAnswers?.fire} />
                <div className="muted small">
                  {agent.calls} calls, {agent.calls > 0 ? Math.round(agent.latencyMs / agent.calls) : 0} ms, {usd(agent.costUsd)}, {agent.hits}/{agent.shots} hits
                  {agent.refusals > 0 && `, ${agent.refusals} refusals`}
                  {agent.errors > 0 && `, ${agent.errors} errors`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>Rankings ({game})</h3>
      <Board
        game={game}
        models={models}
        refreshKey={boardKey}
        columns={[
          { metric: "win", label: "Win rate", format: (n) => `${Math.round(n * 100)}%` },
          { metric: "placement", label: "Mean place" },
          { metric: "stalemate", label: "Draws", format: (n) => `${Math.round(n * 100)}%` },
          { metric: "stay_rate", label: "Stays", format: (n) => `${Math.round(n * 100)}%` },
          { metric: "survived_ticks", label: "Ticks alive", format: (n) => n.toFixed(0) },
          { metric: "hits", label: "Hits", format: (n) => n.toFixed(1) },
          { metric: "actions", label: "Actions", format: (n) => n.toFixed(0) },
          { metric: "latency_ms", label: "Latency", format: (n) => `${Math.round(n)} ms` },
          { metric: "cost_usd", label: "Cost", format: usd },
        ]}
      />
    </section>
  );
}

function outcome(match: Match): string {
  const reason = endReason(match);
  if (reason === "stalemate") return `over: draw, nobody fired for ${match.stalemateTurns} turns`;
  const top = standings(match)[0]!;
  if (top.hp <= 0) return "over: everyone is out";
  return `over: ${top.id} ${reason === "time" ? "leads at the time limit" : "wins"}`;
}
