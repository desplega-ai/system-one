// The Acme page. It owns the app state, and every change goes through its tools:
// - WebMCP (document.modelContext), when the browser has it, for any agent;
// - postMessage (protocol.ts), for the voice game that shows this page in an iframe;
// - clicks, when you open the page alone and play the AI yourself.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type AppState, initialApp } from "./app.ts";
import { Phone } from "./Phone.tsx";
import { type AcmeMessage, type AcmeRequest, snapshotOf } from "./protocol.ts";
import { callTool, type Tool, toolInfo, toolsFor } from "./tools.ts";

type ModelContext = {
  registerTool(tool: { name: string; description: string; inputSchema: object; execute: (input: Record<string, unknown>) => Promise<unknown> }): void;
  unregisterTool?(name: string): void;
};
// Chromium moved it from navigator to document in 2026. Older builds have only the navigator one.
const modelContext =
  (document as unknown as { modelContext?: ModelContext }).modelContext ?? (navigator as unknown as { modelContext?: ModelContext }).modelContext;

type Source = "you" | "WebMCP" | "voice game";
type LogEntry = { id: number; source: Source; call: string; result: string; ok: boolean };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const describeCall = (name: string, input: Record<string, unknown>) =>
  `${name}(${Object.entries(input)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ")})`;

export function Acme() {
  const [app, setApp] = useState<AppState>(initialApp);
  const [log, setLog] = useState<LogEntry[]>([]);
  const appRef = useRef(app);
  const logId = useRef(0);
  const embedded = window.parent !== window;

  const commit = (next: AppState) => {
    appRef.current = next;
    setApp(next);
  };
  const note = (source: Source, call: string, result: string, ok: boolean) =>
    setLog((list) => [{ id: ++logId.current, source, call, result, ok }, ...list].slice(0, 8));
  /** Runs a tool on the current state and returns its reply. Throws on a bad call. */
  const run = (source: Source, name: string, input: Record<string, unknown> = {}) => {
    try {
      const result = callTool(appRef.current, name, input);
      commit(result.app);
      note(source, describeCall(name, input), result.reply || "done", true);
      return result.reply;
    } catch (e) {
      note(source, describeCall(name, input), message(e), false);
      throw e;
    }
  };
  /** A click: same call, but a failure only shows in the log. */
  const click = (name: string, input?: Record<string, unknown>) => {
    try {
      run("you", name, input);
    } catch {}
  };

  // The parent hears about every change, and about the first state.
  useEffect(() => {
    if (embedded) window.parent.postMessage({ acme: "state", snapshot: snapshotOf(app) } satisfies AcmeMessage, location.origin);
  }, [app]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const req = e.data as AcmeRequest | null;
      if (!req || typeof req !== "object" || !("acme" in req)) return;
      let reply = "";
      let error: string | undefined;
      try {
        if (req.acme === "call") reply = run("voice game", req.name, req.input ?? {});
        else if (req.acme === "reset") commit(initialApp);
      } catch (err) {
        error = message(err);
      }
      const snapshot = snapshotOf(appRef.current);
      const out: AcmeMessage = error === undefined ? { acme: "reply", id: req.id, ok: true, reply, snapshot } : { acme: "reply", id: req.id, ok: false, error, snapshot };
      window.parent.postMessage(out, location.origin);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // WebMCP: register the tools of this screen, and register again when they change.
  const tools = toolsFor(app);
  const toolsKey = JSON.stringify(tools.map(toolInfo));
  useEffect(() => {
    if (!modelContext) return;
    const registered: string[] = [];
    for (const tool of toolsFor(appRef.current)) {
      try {
        modelContext.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (input) => ({ content: [{ type: "text", text: run("WebMCP", tool.name, input ?? {}) || "Done." }] }),
        });
        registered.push(tool.name);
      } catch (e) {
        console.warn(`WebMCP: could not register ${tool.name}: ${message(e)}`);
      }
    }
    return () => {
      for (const name of registered) modelContext.unregisterTool?.(name);
    };
  }, [toolsKey]);

  if (embedded) return <Phone app={app} call={click} />;
  return (
    <main className="acme-preview">
      <Phone app={app} call={click} />
      <section className="tool-list">
        <h2>Play the AI</h2>
        <p className="muted">
          Tap the phone, or call a tool below. Both go through the same tools that the voice game and WebMCP agents use.{" "}
          {modelContext ? "This browser has WebMCP, so agents see these tools too." : "This browser has no WebMCP. The voice game calls the tools through postMessage."} The
          list changes with the screen.
        </p>
        {log.length > 0 && (
          <ol className="call-log">
            {log.map((entry) => (
              <li key={entry.id} className={entry.ok ? undefined : "bad"}>
                <span className="muted">{entry.source}:</span> <code>{entry.call}</code> → {entry.result}
              </li>
            ))}
          </ol>
        )}
        {tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} call={click} />
        ))}
      </section>
    </main>
  );
}

type Property = { description?: string; oneOf?: { const: string; title: string }[] };

/** One tool with a control per input: a button per enum value, a field for text, or a plain button. */
function ToolRow({ tool, call }: { tool: Tool; call: (name: string, input?: Record<string, unknown>) => void }) {
  const [text, setText] = useState("");
  const [[name, schema] = []] = Object.entries((tool.inputSchema.properties ?? {}) as Record<string, Property>);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name && text.trim()) call(tool.name, { [name]: text.trim() });
    setText("");
  };
  return (
    <div className="tool">
      <code>{tool.name}</code> <strong>{tool.title}</strong>
      <div className="muted">{tool.description}</div>
      <div className="tool-controls">
        {!name || !schema ? (
          <button type="button" onClick={() => call(tool.name)}>
            Call
          </button>
        ) : schema.oneOf ? (
          schema.oneOf.map((option) => (
            <button type="button" key={option.const} onClick={() => call(tool.name, { [name]: option.const })}>
              {name}: {option.const}
            </button>
          ))
        ) : (
          <form onSubmit={submit}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${name}: ${schema.description}`} />
            <button type="submit">Call</button>
          </form>
        )}
      </div>
    </div>
  );
}
