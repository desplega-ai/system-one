import type { AudioPart } from "@system-one/ai";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../acme/app.ts";
import type { Snapshot } from "../../acme/protocol.ts";
import { ApiError, api, type BudgetInfo, type ModelInfo, type Transcription } from "../../web/lib/api.ts";
import { useVoiceClips } from "../../web/lib/hooks.ts";
import { speak, stopSpeaking } from "../../web/lib/voice.ts";
import { Board } from "../../web/ui/Board.tsx";
import { addCall, emptyStats, Hud, type RunStats, usd } from "../../web/ui/Hud.tsx";
import { type Action, actionsFrom, cleanValue, fillPrompt, NONE, uncertain } from "./actions.ts";
import { createMission, type Grade, grade, type Mission } from "./missions.ts";
import { type Heard, pickQuestion, questionsFor, stateFor, type VoiceAnswers } from "./state.ts";
import { useAcme } from "./useAcme.ts";

type Via = "audio" | "transcript";
type Listener = { model: string; via: Via };
type Mode = "missions" | "free";
type Status = "setup" | "running" | "over";
type Phase = "listening" | "thinking" | "speaking";

/** One listener's answer to one clip. Latency runs from the clip handoff, so it includes the transcription. */
type Answer = { answers: VoiceAnswers; latencyMs: number; costUsd: number };
type Row = { listener: Listener; result?: Answer; error?: string; grade?: Grade };
type ClipView = { id: number; mission: Mission | null; transcript: string | null; performed: string | null; rows: Row[] };
type Tally = { attempts: number; action: number; language: number; mood: number; answered: number; latencyMs: number; costUsd: number; errors: number };

/** One run. Stop aborts its open calls, and late answers are dropped. */
type Run = { runId: string; mode: Mode; listeners: Listener[]; abort: AbortController; missions: Mission[]; tallies: Tally[] };

const MISSIONS = 8;
/** A clip whose answers take longer than this is abandoned. */
const CLIP_TIMEOUT_MS = 15_000;
const defaults: Listener[] = [
  { model: "cloudflare:clef-omni", via: "audio" },
  { model: "typesafe:jev-latest", via: "transcript" },
  { model: "cloudflare:clef-flash", via: "transcript" },
];
const emptyTally: Tally = { attempts: 0, action: 0, language: 0, mood: 0, answered: 0, latencyMs: 0, costUsd: 0, errors: 0 };

/** What the assistant says. The page has its own replies for its tools. */
const talk: Record<Lang, { greeting: string; none: string; sorry: string; sayAgain: string; didYouMean: (a: string, b: string) => string }> = {
  en: {
    greeting: "Hi. What can I do for you?",
    none: "Sorry, I can't do that here.",
    sorry: "Sorry, something went wrong. Please say that again.",
    sayAgain: "Okay. Please say it again.",
    didYouMean: (a, b) => `Did you mean ${a}, or ${b}?`,
  },
  es: {
    greeting: "Hola. ¿Qué puedo hacer por ti?",
    none: "Perdona, eso no lo puedo hacer aquí.",
    sorry: "Perdona, algo ha fallado. Repítelo, por favor.",
    sayAgain: "Vale. Dilo otra vez, por favor.",
    didYouMean: (a, b) => `¿Querías decir ${a}, o ${b}?`,
  },
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudgetError = (e: unknown) => e instanceof ApiError && e.code === "budget_exceeded";
/** The model name in the scores. The same model can listen on both paths in one run. */
const scoreKey = (l: Listener) => (l.via === "audio" ? l.model : `${l.model} (transcript)`);
const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;

export function Voice() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [listeners, setListeners] = useState<Listener[]>([]);
  const [mode, setMode] = useState<Mode>("missions");
  const [status, setStatus] = useState<Status>("setup");
  const [phase, setPhase] = useState<Phase | null>(null);
  const [question, setQuestion] = useState<[Action, Action] | null>(null);
  const [mission, setMission] = useState<{ index: number; mission: Mission } | null>(null);
  const [clips, setClips] = useState<ClipView[]>([]);
  const [notice, setNotice] = useState<string>();
  const [stats, setStats] = useState<RunStats>(emptyStats);
  const [budget, setBudget] = useState<BudgetInfo>();
  const [boardKey, setBoardKey] = useState(0);

  const acme = useAcme();
  const run = useRef<Run | null>(null);
  const phaseRef = useRef<Phase | null>(null);
  const questionRef = useRef<[Action, Action] | null>(null);
  const statsRef = useRef<RunStats>(emptyStats);
  const clipId = useRef(0);

  const mic = useVoiceClips({
    paused: status !== "running" || phase !== "listening",
    onClip: (clip) => void handleClip(clip),
  });

  useEffect(() => {
    api.models().then((list) => {
      setModels(list);
      const usable = defaults.filter((l) => list.some((m) => m.key === l.model && (l.via === "transcript" || m.inputs.includes("audio"))));
      setListeners(usable.length > 0 ? usable : list.slice(0, 2).map((m) => ({ model: m.key, via: "transcript" })));
    }, (e) => setNotice(message(e)));
    api.budget().then(setBudget, () => {});
    return () => {
      stopSpeaking();
      run.current?.abort.abort();
      run.current = null;
    };
  }, []);

  const audioModels = models.filter((m) => m.inputs.includes("audio"));
  const label = (key: string) => models.find((m) => m.key === key)?.label ?? key;
  const listenerLabel = (l: Listener) => `${label(l.model)}, ${l.via}`;
  /** The page state. It exists once the iframe has loaded. */
  const view = (): Snapshot => {
    if (!acme.latest.current) throw new Error("the Acme page is not loaded");
    return acme.latest.current;
  };

  const changePhase = (next: Phase | null) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const ask = (pair: [Action, Action] | null) => {
    questionRef.current = pair;
    setQuestion(pair);
  };
  const count = (call: Parameters<typeof addCall>[1]) => {
    statsRef.current = addCall(statsRef.current, call);
    setStats(statsRef.current);
  };
  /** Says the text with the mic deaf, then goes back to thinking. */
  async function say(current: Run, text: string, lang: Lang = view().lang) {
    if (run.current !== current || !text) return;
    changePhase("speaking");
    await speak(text, lang);
    if (run.current === current) changePhase("thinking");
  }

  async function nextMission(current: Run) {
    const next = createMission(actionsFrom(view().tools));
    current.missions.push(next);
    setMission({ index: current.missions.length - 1, mission: next });
    await say(current, `Mission ${current.missions.length} of ${MISSIONS}. ${next.text}`, "en");
  }

  /** Runs the action on the page. A text input comes from the cheap model, in the user's words. */
  async function perform(current: Run, action: Action, transcript: Promise<Transcription>, signal: AbortSignal): Promise<string> {
    const input: Record<string, string> = { ...action.input };
    if (action.text) {
      const said = (await transcript).text;
      const generated = await api.generate(current.runId, fillPrompt(action, said), signal);
      count(generated);
      input[action.text.name] = cleanValue(generated.text) || said;
    }
    const reply = await acme.call(action.tool, input);
    await say(current, reply);
    const args = Object.entries(input).map(([k, v]) => `${k}: "${v}"`);
    return `${action.tool}(${args.join(", ")})`;
  }

  /** The driver's answer adapts the page, then runs the action. In free mode, an unsure driver asks first. */
  async function drive(current: Run, answers: VoiceAnswers, actions: Action[], transcript: Promise<Transcription>, signal: AbortSignal): Promise<string | null> {
    const { action, language, mood } = answers;
    const before = view();
    const lang = language.type === "choice" && language.choice !== "other" ? (language.choice === "english" ? "en" : "es") : null;
    if (lang && lang !== before.lang) await acme.call("set_language", { language: lang });
    if (mood.type === "choice" && mood.choice !== before.mood) await acme.call("set_theme", { mood: mood.choice });
    const t = talk[view().lang];

    if (action.type === "refusal") {
      await say(current, t.sorry);
      return null;
    }
    const chosen = actions.find((a) => a.id === action.choice);
    if (!chosen || action.choice === NONE) {
      await say(current, t.none);
      return null;
    }
    const pair = current.mode === "free" ? uncertain(action) : null;
    const candidates = pair?.map((id) => actions.find((a) => a.id === id)).filter((a): a is Action => a !== undefined);
    if (candidates?.length === 2) {
      ask([candidates[0]!, candidates[1]!]);
      await say(current, t.didYouMean(candidates[0]!.title, candidates[1]!.title));
      return null;
    }
    return perform(current, chosen, transcript, signal);
  }

  /** The answer to "Did you mean X or Y?". Only the driver hears it. */
  async function answerQuestion(current: Run, clip: AudioPart, [first, second]: [Action, Action], signal: AbortSignal) {
    ask(null);
    const driver = current.listeners[0]!;
    const transcript = api.transcribe(current.runId, clip, signal);
    transcript.then(count, () => {});
    try {
      const heard: Heard = driver.via === "audio" ? { audio: clip } : { transcript: (await transcript).text };
      const decision = await api.decide(driver.model, current.runId, { state: stateFor(view(), heard), questions: pickQuestion(first, second), signal });
      count(decision);
      if (run.current !== current) return;
      const pick = decision.answers.pick;
      const chosen = pick.type === "choice" ? (pick.choice === "first" ? first : pick.choice === "second" ? second : null) : null;
      if (!chosen) return say(current, talk[view().lang].sayAgain);
      await perform(current, chosen, transcript, signal);
    } catch {
      count("error");
      if (run.current === current) await say(current, talk[view().lang].sorry);
    }
  }

  async function handleClip(clip: AudioPart) {
    const current = run.current;
    if (!current || phaseRef.current !== "listening") return;
    changePhase("thinking");
    const t0 = performance.now();
    const signal = AbortSignal.any([current.abort.signal, AbortSignal.timeout(CLIP_TIMEOUT_MS)]);
    const pending = questionRef.current;
    if (pending) {
      await answerQuestion(current, clip, pending, signal);
      if (run.current === current) changePhase("listening");
      return;
    }

    const page = view();
    const actions = actionsFrom(page.tools);
    const questions = questionsFor(actions);
    // One transcription per clip: transcript listeners read it, text inputs come from it, and the panel shows it.
    const transcript = api.transcribe(current.runId, clip, signal);
    transcript.then(count, () => count("error"));
    const results = current.listeners.map(async (l): Promise<Answer> => {
      let heard: Heard = { audio: clip };
      let transcriptCost = 0;
      if (l.via === "transcript") {
        const text = await transcript;
        heard = { transcript: text.text };
        transcriptCost = text.usage.costUsd ?? 0;
      }
      const decision = await api.decide(l.model, current.runId, { state: stateFor(page, heard), questions, signal });
      count(decision);
      return { answers: decision.answers, latencyMs: performance.now() - t0, costUsd: (decision.usage.costUsd ?? 0) + transcriptCost };
    });

    let performed: string | null = null;
    const driverDone = results[0]!.then(
      async (r) => {
        if (run.current === current) performed = await drive(current, r.answers, actions, transcript, signal);
      },
      (e) => (run.current === current && !isBudgetError(e) ? say(current, talk[view().lang].sorry) : undefined),
    ).catch(async (e) => {
      // The page or the generation failed after the decision.
      if (run.current === current) await say(current, talk[view().lang].sorry);
      performed = `failed: ${message(e)}`;
    });
    const settled = await Promise.allSettled(results);
    await driverDone;
    if (run.current !== current) return;

    const overBudget = settled.find((r) => r.status === "rejected" && isBudgetError(r.reason));
    if (overBudget) return stop(`Stopped: ${message((overBudget as PromiseRejectedResult).reason)}`);

    const currentMission = current.mode === "missions" ? current.missions.at(-1)! : null;
    const rows: Row[] = current.listeners.map((listener, i) => {
      const r = settled[i]!;
      const tally = current.tallies[i]!;
      if (r.status === "rejected") {
        count("error");
        if (currentMission) current.tallies[i] = { ...tally, attempts: tally.attempts + 1, errors: tally.errors + 1 };
        return { listener, error: message(r.reason) };
      }
      const g = currentMission ? grade(currentMission, r.value.answers) : undefined;
      if (g) {
        current.tallies[i] = {
          attempts: tally.attempts + 1,
          action: tally.action + Number(g.action),
          language: tally.language + Number(g.language),
          mood: tally.mood + Number(g.mood),
          answered: tally.answered + 1,
          latencyMs: tally.latencyMs + r.value.latencyMs,
          costUsd: tally.costUsd + r.value.costUsd,
          errors: tally.errors,
        };
      }
      return { listener, result: r.value, grade: g };
    });
    const text = await transcript.then((x) => x.text, () => null);
    setClips((list) => [{ id: ++clipId.current, mission: currentMission, transcript: text, performed, rows }, ...list].slice(0, 6));

    if (currentMission) {
      if (current.missions.length >= MISSIONS) return finish(current);
      await nextMission(current);
    }
    if (run.current === current) changePhase("listening");
  }

  async function finish(current: Run) {
    setStatus("over");
    changePhase(null);
    mic.stop();
    const rows = current.listeners.flatMap((l, i) => {
      const t = current.tallies[i]!;
      const of = (n: number) => (t.attempts > 0 ? n / t.attempts : 0);
      return Object.entries({
        action_acc: of(t.action),
        language_acc: of(t.language),
        mood_acc: of(t.mood),
        latency_ms: t.answered > 0 ? t.latencyMs / t.answered : 0,
        cost_usd: t.costUsd,
        errors: t.errors,
      }).map(([metric, value]) => ({ model: scoreKey(l), metric, value }));
    });
    try {
      await api.addScores(current.runId, rows);
      setBoardKey((k) => k + 1);
    } catch (e) {
      setNotice(`Could not save scores: ${message(e)}`);
    }
    api.budget().then(setBudget, () => {});
  }

  async function start() {
    setNotice(undefined);
    stopSpeaking();
    run.current?.abort.abort();
    run.current = null;
    // First, inside the click: the browser lets the mic's AudioContext run only after a user gesture.
    if (mic.status !== "on" && !(await mic.start())) return;
    try {
      await acme.reset();
      const runId = await api.createRun(`voice-${mode}`, { listeners, mode });
      const current: Run = { runId, mode, listeners, abort: new AbortController(), missions: [], tallies: listeners.map(() => emptyTally) };
      run.current = current;
      statsRef.current = emptyStats;
      setStats(emptyStats);
      setClips([]);
      setMission(null);
      ask(null);
      setStatus("running");
      changePhase("thinking");
      if (mode === "missions") await nextMission(current);
      else await say(current, talk.en.greeting, "en");
      if (run.current === current) changePhase("listening");
    } catch (e) {
      mic.stop();
      setNotice(message(e));
    }
  }

  /** Ends the run without scores. Calls already made stay in the database. */
  function stop(reason = "Stopped. The run was not scored.") {
    run.current?.abort.abort();
    run.current = null;
    stopSpeaking();
    mic.stop();
    ask(null);
    changePhase(null);
    setStatus("setup");
    setNotice(reason);
    api.budget().then(setBudget, () => {});
  }

  const setListener = (i: number, next: Listener) => setListeners(listeners.map((l, j) => (j === i ? next : l)));
  const running = status === "running";
  const lang = acme.snapshot?.lang ?? "en";

  return (
    <section className="voice">
      <div className="game-setup card">
        <p className="muted">
          Talk to the Acme app. It is fully hands-free: Start opens the mic, then speak. The app is a real page with WebMCP-style tools (
          <a href="/acme" target="_blank" rel="noreferrer">
            open it in a tab
          </a>
          ). Every action is one of its tools, picked by a decision model. Free-text inputs come from a cheap text model. The first listener drives the
          app. The others answer the same clip next to it, from the audio or from a grok-stt transcript.
        </p>
        {audioModels.length === 0 && models.length > 0 && <p className="refused">No audio model: Clef-Omni needs Cloudflare keys. Every listener reads the transcript.</p>}
        <div className="picker">
          {listeners.map((l, i) => (
            <div className="picker-slot" key={i}>
              <span className="picker-label">{i === 0 ? "Driver" : `Listener ${i + 1}`}</span>
              <select
                value={l.model}
                disabled={running}
                aria-label={`Listener ${i + 1} model`}
                onChange={(e) => setListener(i, { ...l, model: e.target.value, via: audioModels.some((m) => m.key === e.target.value) ? l.via : "transcript" })}
              >
                {models.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select value={l.via} disabled={running} aria-label={`Listener ${i + 1} input`} onChange={(e) => setListener(i, { ...l, via: e.target.value as Via })}>
                <option value="audio" disabled={!audioModels.some((m) => m.key === l.model)}>
                  hears the audio
                </option>
                <option value="transcript">reads the transcript</option>
              </select>
              <button type="button" onClick={() => setListeners(listeners.filter((_, j) => j !== i))} disabled={running || listeners.length <= 1}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setListeners([...listeners, { model: models[0]!.key, via: "transcript" }])} disabled={running || listeners.length >= 4 || models.length === 0}>
            Add listener
          </button>
        </div>
        <div className="row">
          <label>
            Mode{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={running}>
              <option value="missions">missions ({MISSIONS}, scored)</option>
              <option value="free">free (not scored)</option>
            </select>
          </label>
          {running ? (
            <button type="button" onClick={() => stop()}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={start} disabled={listeners.length === 0}>
              Start
            </button>
          )}
          <span className="muted">{status}</span>
          {mic.error && <span className="refused">Mic: {mic.error}</span>}
        </div>
        {notice && <p className="refused">{notice}</p>}
        <Hud stats={stats} budget={budget} />
      </div>

      <div className="voice-play">
        <div>
          {mission && running && (
            <div className="card mission">
              <div className="muted small">
                Mission {mission.index + 1} of {MISSIONS}
              </div>
              <strong>{mission.mission.text}</strong>
            </div>
          )}
          <div className="card voice-status">
            <span className={`dot ${phase ?? "idle"}`} />
            {phase ?? (running ? "starting" : "mic off")}
            <span className="meter">
              <span style={{ width: `${Math.min(100, mic.level * 800)}%` }} />
            </span>
          </div>
          <iframe ref={acme.frame} src="/acme" title="Acme app" className="acme-frame" inert />
          {question && <div className="card voice-question">{talk[lang].didYouMean(question[0].title, question[1].title)}</div>}
        </div>
        <div className="clips">
          {clips.map((c) => (
            <div className="card" key={c.id}>
              <div className="small">
                {c.mission && <span className="muted">{c.mission.text} </span>}
                {c.transcript !== null && <span>Heard: "{c.transcript}"</span>}
                {c.performed && <div className="muted">Ran {c.performed}</div>}
              </div>
              <table className="board">
                <thead>
                  <tr>
                    <th>Listener</th>
                    <th>Action</th>
                    <th>Language</th>
                    <th>Mood</th>
                    <th>Latency</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((row, i) => (
                    <tr key={i}>
                      <td>
                        {i === 0 ? "▶ " : ""}
                        {listenerLabel(row.listener)}
                      </td>
                      {row.result ? (
                        <>
                          <AnswerCell answer={row.result.answers.action} ok={row.grade?.action} />
                          <AnswerCell answer={row.result.answers.language} ok={row.grade?.language} />
                          <AnswerCell answer={row.result.answers.mood} ok={row.grade?.mood} />
                          <td>{Math.round(row.result.latencyMs)} ms</td>
                          <td>{usd(row.result.costUsd)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="refused">
                          {row.error}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <h3>Rankings (voice-missions)</h3>
      <Board
        game="voice-missions"
        models={models}
        refreshKey={boardKey}
        columns={[
          { metric: "action_acc", label: "Action", format: pct },
          { metric: "language_acc", label: "Language", format: pct },
          { metric: "mood_acc", label: "Mood", format: pct },
          { metric: "latency_ms", label: "Latency", format: (n) => `${Math.round(n)} ms` },
          { metric: "cost_usd", label: "Cost", format: usd },
          { metric: "errors", label: "Errors", format: (n) => n.toFixed(1) },
        ]}
      />
    </section>
  );
}

function AnswerCell({ answer, ok }: { answer: VoiceAnswers[keyof VoiceAnswers]; ok: boolean | undefined }) {
  const mark = ok === undefined ? "" : ok ? " ✓" : " ✗";
  if (answer.type === "refusal") return <td className="refused">refused{mark}</td>;
  const p = (answer.probabilities as Record<string, number>)[answer.choice];
  return (
    <td className={ok === false ? "refused" : undefined}>
      {answer.choice} {pct(p)}
      {mark}
    </td>
  );
}
