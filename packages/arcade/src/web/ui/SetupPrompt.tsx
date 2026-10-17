import { LoaderCircle, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/web/components/ui/button";
import { api, type ModelInfo } from "../lib/api.ts";
import { refreshBudget } from "../lib/budget.ts";
import { readSetup, type SetupChoice, setupCall } from "../lib/setup.ts";
import { makerOf } from "./brands.ts";
import { splitLabel } from "./ModelName.tsx";

/** The model that reads the request: Jev when it has a key, else the first model with text input. */
const readers = ["typesafe:jev-latest", "openrouter:jev-latest", "cloudflare:clef-flash"];

type Props = {
  /** The game, for the run log: "arena", "attention". */
  game: string;
  models: ModelInfo[];
  usable: ModelInfo[];
  slots: string[];
  min: number;
  max: number;
  choices: Record<string, SetupChoice>;
  placeholder: string;
  onApply: (setup: { slots: string[]; choices: Record<string, string> }) => void;
};

/** A text field: describe the setup in words, and one of our decision models fills in the options. */
export function SetupPrompt({ game, models, usable, slots, min, max, choices, placeholder, onApply }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const reader = readers.map((key) => models.find((m) => m.key === key)).find(Boolean) ?? models.find((m) => m.inputs.includes("text"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !reader || busy) return;
    setBusy(true);
    setResult(undefined);
    const input = { text: text.trim(), models: usable, slots, min, max, choices };
    try {
      const runId = await api.createRun(`setup-${game}`, { text: input.text });
      const decision = await api.decide(reader.key, runId, setupCall(input));
      const setup = readSetup(input, decision.answers);
      onApply(setup);
      setResult({ ok: true, text: `${splitLabel(reader.label).name} set it up in ${Math.round(decision.latencyMs)} ms.` });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      refreshBudget();
    }
  }

  const maker = reader && makerOf(splitLabel(reader.label).name);
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border bg-white/[0.03] py-1 pr-1 pl-3 focus-within:ring-2 focus-within:ring-ring/50">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label="Describe the setup"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim() || !reader || busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : maker ? <img src={maker.logo} alt="" className="size-4" /> : null}
          Set up
        </Button>
      </div>
      {result && <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{result.text}</p>}
    </form>
  );
}
