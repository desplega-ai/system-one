import { decisionStream } from "@system-one/ai";
import { cn } from "cn";
import { CircleDashed, Crosshair, Dices, Footprints, Grid3x3, Hash, Hourglass, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Card } from "@/web/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { type FrameInfo, GameFrame } from "../../web/components/GameFrame.tsx";
import { ApiError, api, type ModelInfo } from "../../web/lib/api.ts";
import { refreshBudget } from "../../web/lib/budget.ts";
import { useSquareSide } from "../../web/lib/hooks.ts";
import { Board } from "../../web/ui/Board.tsx";
import { FullscreenButton } from "../../web/ui/FullscreenButton.tsx";
import { logoImage, makerOf } from "../../web/ui/brands.ts";
import { agentColors } from "../../web/ui/colors.ts";
import { addCall, emptyStats, type RunStats, usd } from "../../web/ui/Hud.tsx";
import { ModelName, splitLabel } from "../../web/ui/ModelName.tsx";
import { ModelPicker } from "../../web/ui/ModelPicker.tsx";
import { ProbabilityBars } from "../../web/ui/ProbabilityBars.tsx";
import { ResultCard } from "../../web/ui/ResultCard.tsx";
import { SetupPrompt } from "../../web/ui/SetupPrompt.tsx";
import { FilterChips, useModelFilters } from "../../web/ui/RankingFilters.tsx";
import { SetupRow } from "../../web/ui/SetupRow.tsx";
import { Tip } from "../../web/ui/Tip.tsx";
import { createRng, MAX_TICKS, type Policy, type Rng, START_HP, STALEMATE_TURNS } from "./engine.ts";
import { type Field, type FieldAgent, type FieldId, type FieldMatch, type FieldTurn, fields } from "./fields.ts";
import { type Clock, presets } from "./presets.ts";

type Status = "setup" | "running" | "paused" | "over";
/** One match. Stop or a new match aborts its open calls, and late answers are dropped. */
type Run = { runId: string; field: Field; rng: Rng; policy: Policy; clock: Clock; abort: AbortController };

/** Lockstep waits this long between ticks, so people can follow the match. */
const LOCKSTEP_PAUSE_MS = 400;
/** Real-time: a match lasts at most this long. Each field sets how often its engine ticks. */
const REALTIME_SECONDS = 60;
const realtimeMaxTicks = (field: Field) => Math.round((REALTIME_SECONDS * 1000) / field.realtimeTickMs);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudgetError = (e: unknown) => e instanceof ApiError && (e.code === "budget_exceeded" || e.code === "share_exceeded");

/** `arg` is a preset id from the URL, for example #/arena/standoff. */
export function Arena({ arg, info }: { arg?: string; info: FrameInfo }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Policy>("sample");
  const [clock, setClock] = useState<Clock>("lockstep");
  const [fieldId, setFieldId] = useState<FieldId>("ring");
  const field = fields[fieldId];
  // The ranking tab has its own filters. "" means all.
  const [rankField, setRankField] = useState<FieldId>("ring");
  const [rankClock, setRankClock] = useState("");
  const [rankPolicy, setRankPolicy] = useState("");
  const modelFilters = useModelFilters(models);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [stalemateTurns, setStalemateTurns] = useState(STALEMATE_TURNS);
  const [match, setMatch] = useState<FieldMatch>();
  const [status, setStatus] = useState<Status>("setup");
  const [notice, setNotice] = useState<string>();
  const [stats, setStats] = useState<RunStats>(emptyStats);
  const [boardKey, setBoardKey] = useState(0);

  const run = useRef<Run | null>(null);
  const matchRef = useRef<FieldMatch | undefined>(undefined);
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

  /** Before a match, the field shows the players to be. */
  const previewMatch = () =>
    slots.length >= 2 && slots.length <= 6 ? field.createMatch(slots, { stalemateTurns, maxTicks: clock === "realtime" ? realtimeMaxTicks(field) : MAX_TICKS }) : undefined;
  // Draw on every animation frame: agents glide, shots fade. The view belongs to the field that made it.
  const [arenaBox, arenaWidth] = useSquareSide<HTMLDivElement>();
  const arenaSize = useRef(0);
  arenaSize.current = arenaWidth;
  const labels = useRef<Record<string, string>>({});
  const logos = useRef<Record<string, HTMLImageElement | undefined>>({});
  const onRing = match?.agents ?? previewMatch()?.agents ?? [];
  labels.current = Object.fromEntries(onRing.map((a) => [a.id, splitLabel(label(a.model)).name]));
  logos.current = Object.fromEntries(
    onRing.map((a) => {
      const maker = makerOf(splitLabel(label(a.model)).name);
      return [a.id, maker && logoImage(maker.logo)];
    }),
  );
  const view = useRef<{ field: Field; state: unknown } | null>(null);
  const preview = useRef<{ field: Field; match: FieldMatch | undefined }>({ field, match: undefined });
  preview.current = { field, match: match ? undefined : previewMatch() };
  useEffect(() => {
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const m = matchRef.current ?? preview.current.match;
      const f = matchRef.current && run.current ? run.current.field : preview.current.field;
      if (!m || !canvas.current || arenaSize.current === 0) return;
      if (view.current?.field !== f) view.current = { field: f, state: f.view() };
      view.current.state = f.draw(canvas.current, m, view.current.state, labels.current, logos.current, now, arenaSize.current);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = (next: FieldMatch | undefined) => {
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

  async function finish(current: Run, final: FieldMatch) {
    changeStatus("over");
    try {
      await api.addScores(current.runId, current.field.scores(final));
      setBoardKey((k) => k + 1);
    } catch (e) {
      setNotice(`Could not save scores: ${message(e)}`);
    }
    refreshBudget();
  }

  /** Lockstep: every standing agent decides, then the tick resolves. Returns true when the loop should stop. */
  async function lockstepTick(current: Run): Promise<boolean> {
    const m = matchRef.current!;
    const { field: f } = current;
    const standing = f.alive(m);
    const settled = await Promise.allSettled(
      standing.map((agent) =>
        api.decide(agent.model, current.runId, { state: f.state(m, agent), questions: f.questions(m, agent), signal: current.abort.signal }),
      ),
    );
    // Stopped, or replaced by a new match, while the calls were open.
    if (run.current !== current) return true;
    const overBudget = settled.find((r) => r.status === "rejected" && isBudgetError(r.reason));
    if (overBudget) {
      stopForBudget((overBudget as PromiseRejectedResult).reason);
      return true;
    }
    const turns: Record<string, FieldTurn> = {};
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
    const next = f.playTick(m, turns, current.policy, current.rng);
    commit(next);
    if (f.isOver(next)) await finish(current, next);
    return f.isOver(next);
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

  // Real-time: one decision stream per agent, and an engine tick every field.realtimeTickMs.
  useEffect(() => {
    const current = run.current;
    if (status !== "running" || current?.clock !== "realtime") return;
    const { field: f } = current;
    const pending: Record<string, FieldTurn> = {};
    const streams = f.alive(matchRef.current!).map((agent) =>
      decisionStream({
        // With one call in flight, the next call starts within 20 ms of the last answer.
        everyMs: 20,
        maxInFlight: 1,
        makeCall: () => {
          const m = matchRef.current!;
          const me = m.agents.find((a) => a.id === agent.id)!;
          if (me.hp <= 0 || f.isOver(m)) return null;
          // Built at call time, so a slow model acts on an older state.
          return { state: f.state(m, me), questions: f.questions(m, me) };
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
      const next = f.playTick(matchRef.current!, turns, current.policy, current.rng);
      commit(next);
      if (f.isOver(next)) void finish(current, next);
    }, f.realtimeTickMs);
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
      const game = `${field.game}-${clock}`;
      const maxTicks = clock === "realtime" ? realtimeMaxTicks(field) : MAX_TICKS;
      const runId = await api.createRun(game, { models: slots, field: fieldId, seed, policy, clock, maxTicks, stalemateTurns, preset: preset?.id ?? null });
      const current: Run = { runId, field, rng: createRng(seed), policy, clock, abort: new AbortController() };
      run.current = current;
      statsRef.current = emptyStats;
      setStats(emptyStats);
      view.current = null;
      commit(field.createMatch(slots, { maxTicks, stalemateTurns }));
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
    refreshBudget();
  }

  const agents = match?.agents ?? previewMatch()?.agents ?? [];
  // The tooltip trigger replaces the item's data-state, so the selected style keys on aria-checked.
  const onChip = "aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:hover:bg-primary/90 aria-checked:hover:text-primary-foreground";
  const numberInput = "h-8 w-20 rounded-md border border-input bg-input/30 px-2 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  const playField = run.current?.field ?? field;
  const rankGames = (rankClock === "" ? ["lockstep", "realtime"] : [rankClock]).map((c) => `${fields[rankField].game}-${c}`);
  const playClock = run.current?.clock ?? clock;
  const subtitle = `${playField.name} · ${playClock === "lockstep" ? "Lockstep" : "Real-time"} · ${agents.length} players · ${status === "running" ? "playing" : status === "over" ? "match over" : status}`;

  return (
    <GameFrame
      info={info}
      controls={{
        status,
        startLabel: "Start match",
        canStart: slots.length >= 2,
        onStart: start,
        onPause: () => changeStatus("paused"),
        onResume: resume,
        onStop: stop,
        onSetup: () => {
          commit(undefined);
          changeStatus("setup");
        },
        onStep: playClock === "lockstep" ? step : undefined,
      }}
      stats={stats}
      players={agents.map((agent) => ({ label: label(agent.model), color: agentColors[agent.id]! }))}
      subtitle={subtitle}
      progress={match ? { value: match.tick / match.maxTicks, left: `tick ${match.tick}`, right: `${match.maxTicks}` } : undefined}
      board={
        <Board
          game={rankGames}
          config={rankPolicy ? { policy: rankPolicy } : {}}
          include={modelFilters.include}
          toolbar={
            <>
              <FilterChips label="Field" value={rankField} onChange={(v) => setRankField((v || "ring") as FieldId)} options={[{ value: "ring", label: "Ring" }, { value: "plane", label: "Plane" }]} />
              <FilterChips label="Clock" value={rankClock} onChange={setRankClock} options={[{ value: "", label: "All" }, { value: "lockstep", label: "Lockstep" }, { value: "realtime", label: "Real-time" }]} />
              <FilterChips label="Policy" value={rankPolicy} onChange={setRankPolicy} options={[{ value: "", label: "All" }, { value: "sample", label: "Sample" }, { value: "top", label: "Top answer" }]} />
              {modelFilters.controls}
            </>
          }
          models={models}
          refreshKey={boardKey}
          columns={[
            { metric: "win", label: "Win rate", format: (n) => `${Math.round(n * 100)}%` },
            { metric: "placement", label: "Mean place" },
            { metric: "stalemate", label: "Draws", format: (n) => `${Math.round(n * 100)}%` },
            { metric: "stay_rate", label: "Stays", format: (n) => `${Math.round(n * 100)}%` },
            { metric: "survived_ticks", label: "Ticks alive", format: (n) => n.toFixed(0) },
            { metric: "hits", label: "Hits", format: (n) => n.toFixed(1) },
            ...(rankField === "plane" ? [{ metric: "accuracy", label: "Accuracy", format: (n: number) => `${Math.round(n * 100)}%` }] : []),
            { metric: "actions", label: "Actions", format: (n) => n.toFixed(0) },
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
          <SetupRow label="Describe">
            <SetupPrompt
              game="arena"
              models={models}
              usable={models.filter((m) => m.inputs.includes("text"))}
              slots={slots}
              min={2}
              max={6}
              placeholder="Try: all Jevs on a plane, or Luna against two Clefs in real-time"
              choices={{
                field: { question: "Which field?", options: { ring: "a ring: agents stand on a circle", plane: "a plane: a square field where shots fly" }, current: fieldId },
                clock: {
                  question: "Which clock?",
                  options: { lockstep: "lockstep: fair turns, everyone waits", realtime: "real-time: fast models act more often" },
                  current: clock,
                },
                policy: { question: "How do models act?", options: { sample: "sample from the probabilities", top: "always the most likely action" }, current: policy },
              }}
              onApply={(setup) => {
                if (preset) window.location.hash = "#/arena";
                setSlots(setup.slots);
                setFieldId(setup.choices.field as FieldId);
                setClock(setup.choices.clock as Clock);
                setPolicy(setup.choices.policy as Policy);
              }}
            />
          </SetupRow>
          <SetupRow label="Preset">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={2}
              className="flex-wrap"
              value={preset?.id ?? ""}
              onValueChange={(id) => (window.location.hash = id ? `#/arena/${id}` : "#/arena")}
            >
              {presets.map((p) => (
                <Tip key={p.id} text={models.length > 0 && !hasModels(p.models) ? "Needs a model without a key here" : p.models.map(label).join(" vs ")}>
                  <ToggleGroupItem value={p.id} className={onChip} disabled={models.length > 0 && !hasModels(p.models)}>
                    {p.name}
                  </ToggleGroupItem>
                </Tip>
              ))}
            </ToggleGroup>
            {preset && <p className="max-w-3xl text-sm text-muted-foreground">{preset.description}</p>}
          </SetupRow>
          <SetupRow label="Players">
            <ModelPicker models={models} value={slots} onChange={setSlots} min={2} max={6} needs={["text"]} />
          </SetupRow>
          <SetupRow label="Rules">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <ToggleGroup type="single" variant="outline" size="sm" value={fieldId} onValueChange={(v) => v && setFieldId(v as FieldId)}>
                <Tip text="Agents stand on a ring and step along it. Shots hit at once, with a chance that drops with distance.">
                  <ToggleGroupItem value="ring" className={onChip}>
                    <CircleDashed /> Ring
                  </ToggleGroupItem>
                </Tip>
                <Tip text="A square field. Agents step in 12 directions, walls and other agents block them, and shots fly for a few ticks, so they can be dodged.">
                  <ToggleGroupItem value="plane" className={onChip}>
                    <Grid3x3 /> Plane
                  </ToggleGroupItem>
                </Tip>
              </ToggleGroup>
              <ToggleGroup type="single" variant="outline" size="sm" value={clock} onValueChange={(v) => v && setClock(v as Clock)}>
                <Tip text="The server waits for every model, then the turn resolves. Fair turns.">
                  <ToggleGroupItem value="lockstep" className={onChip}>
                    <Footprints /> Lockstep
                  </ToggleGroupItem>
                </Tip>
                <Tip text="Each model acts when its answer lands. Speed counts.">
                  <ToggleGroupItem value="realtime" className={onChip}>
                    <Zap /> Real-time
                  </ToggleGroupItem>
                </Tip>
              </ToggleGroup>
              <ToggleGroup type="single" variant="outline" size="sm" value={policy} onValueChange={(v) => v && setPolicy(v as Policy)}>
                <Tip text="Draw each action from the model's probabilities.">
                  <ToggleGroupItem value="sample" className={onChip}>
                    <Dices /> Sample
                  </ToggleGroupItem>
                </Tip>
                <Tip text="Always take the most likely action.">
                  <ToggleGroupItem value="top" className={onChip}>
                    <Crosshair /> Top answer
                  </ToggleGroupItem>
                </Tip>
              </ToggleGroup>
              <Tip text="The seed for the random draws: who starts where, which shots hit, and the sampled actions.">
                <label className="flex items-center gap-2">
                  <Hash className="size-4" /> Seed
                  <input type="number" className={numberInput} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
                </label>
              </Tip>
              <Tip text="The match ends in a draw when nobody fires for this many turns in a row. The models know the rule.">
                <label className="flex items-center gap-2">
                  <Hourglass className="size-4" /> Draw after
                  <input
                    type="number"
                    min={1}
                    className={cn(numberInput, "w-14")}
                    value={stalemateTurns}
                    onChange={(e) => setStalemateTurns(Math.max(1, Number(e.target.value)))}
                  />
                  quiet turns
                </label>
              </Tip>
            </div>
            <p className="text-sm text-muted-foreground">
              {fieldId === "ring" ? "On a ring: agents step along it, and shots land at once." : "On a plane: agents step in 12 directions, and shots take a few ticks to fly."}{" "}
              {clock === "lockstep" ? "Lockstep: every model answers, then the turn resolves." : "Real-time: each model acts when its answer lands, so fast models act more often."}{" "}
              {policy === "sample" ? "Actions are drawn from the probabilities." : "Each model does its most likely action."}
            </p>
          </SetupRow>
        </Card>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <div
          ref={arenaBox}
          className="relative aspect-square w-full shrink-0 overflow-hidden rounded-2xl border bg-[radial-gradient(circle_at_center,oklch(0.19_0.01_265),oklch(0.12_0.008_265)_70%)] lg:w-[min(48%,calc(100vh-15.5rem))] lg:[html.stage_&]:w-[min(48%,calc(100vh-11.5rem))] [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:justify-center [&:fullscreen]:rounded-none [&:fullscreen]:border-0"
        >
          <canvas ref={canvas} className="block" />
          <FullscreenButton target={arenaBox} />
          {match && match.events.length > 0 && (
            <ol className="pointer-events-none absolute bottom-3 left-4 space-y-0.5 font-mono text-[11px]">
              {match.events.slice(0, 3).map((event, i) => (
                <li key={`${match.tick}-${i}`} style={{ opacity: 1 - i * 0.3 }}>
                  <EventText text={event} />
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3">
          {status === "over" && match && <ArenaResult field={run.current?.field ?? field} match={match} label={label} />}
          {agents.map((agent) => (
            <PlayerCard key={agent.id} agent={agent} label={label(agent.model)} waiting={!match} />
          ))}
        </div>
      </div>
    </GameFrame>
  );
}

/** How the match ended, and the final standings. */
function ArenaResult({ field, match, label }: { field: Field; match: FieldMatch; label: (key: string) => string }) {
  const reason = field.endReason(match);
  const ranked = field.standings(match);
  const top = ranked[0]!;
  const name = splitLabel(label(top.model)).name;
  const draw = reason === "stalemate" || top.hp <= 0;
  const title = draw ? "Draw" : reason === "time" ? `${name} leads` : `${name} wins`;
  const detail =
    reason === "stalemate"
      ? `Nobody fired for ${match.stalemateTurns} turns in a row.`
      : top.hp <= 0
        ? "Everyone is out."
        : reason === "time"
          ? `Time is up after ${match.tick} ticks. ${name} has the most hit points left.`
          : `Last model standing after ${match.tick} ticks.`;
  return (
    <ResultCard
      title={title}
      detail={detail}
      color={draw ? undefined : agentColors[top.id]}
      rows={ranked.map((agent, i) => ({
        key: agent.id,
        label: label(agent.model),
        color: agentColors[agent.id]!,
        place: i + 1,
        out: agent.hp <= 0,
        stats: [
          agent.hp > 0 ? `${agent.hp} hp` : "out",
          `${agent.hits}/${agent.shots} hits`,
          `${agent.calls > 0 ? Math.round(agent.latencyMs / agent.calls) : 0} ms`,
          usd(agent.costUsd),
        ],
      }))}
    />
  );
}

/** An event line, with each agent name in its color. */
function EventText({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span key={i} style={agentColors[word] ? { color: agentColors[word], fontWeight: 600 } : { color: "rgba(255,255,255,0.75)" }}>
          {i > 0 && " "}
          {word}
        </span>
      ))}
    </>
  );
}

/** One player: its color, its hit points, and what it wants to do. */
function PlayerCard({ agent, label, waiting }: { agent: FieldAgent; label: string; waiting: boolean }) {
  const color = agentColors[agent.id]!;
  const out = agent.hp <= 0;
  return (
    <Card className={cn("relative gap-3 overflow-hidden py-3 pr-4 pl-5 transition-opacity", out && "opacity-45")}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
      <div className="flex items-center gap-3">
        <ModelName label={label} />
        <span className="ml-auto flex items-center gap-1">
          {out ? (
            <span className="caps text-muted-foreground">out</span>
          ) : (
            Array.from({ length: START_HP }, (_, i) => (
              <span key={i} className="size-2 rounded-full" style={{ background: i < agent.hp ? color : "rgba(255,255,255,0.15)" }} />
            ))
          )}
        </span>
      </div>
      {!waiting && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-5">
            <ProbabilityBars title="move" answer={agent.lastAnswers?.move} color={color} limit={3} minRows={3} />
            <ProbabilityBars title="aim at" answer={agent.lastAnswers?.target} color={color} limit={3} minRows={3} />
            <ProbabilityBars title="fire" answer={agent.lastAnswers?.fire} color={color} minRows={3} />
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">
            {agent.calls} calls · {agent.calls > 0 ? Math.round(agent.latencyMs / agent.calls) : 0} ms · {usd(agent.costUsd)} · {agent.hits}/{agent.shots} hits
            {agent.refusals > 0 && ` · ${agent.refusals} refusals`}
            {agent.errors > 0 && ` · ${agent.errors} errors`}
          </div>
        </>
      )}
    </Card>
  );
}
