import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/web/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/web/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import type { Input, ModelInfo } from "../lib/api.ts";
import { hostByKey, hosts } from "./brands.ts";
import { slotColor } from "./colors.ts";
import { ModelName, splitLabel } from "./ModelName.tsx";
import { Tip } from "./Tip.tsx";

type Props = {
  models: ModelInfo[];
  /** One registry key per slot. The same model can fill several slots. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Only models that take every one of these inputs are offered. */
  needs?: Input[];
  min?: number;
  max?: number;
  slotLabel?: (index: number) => string;
  disabled?: boolean;
};

/** One chip per slot, in the slot's player color, with a searchable model menu and a remove button. */
export function ModelPicker({ models, value, onChange, needs = [], min = 1, max = 6, slotLabel = (i) => `Player ${i + 1}`, disabled }: Props) {
  const usable = models.filter((m) => needs.every((input) => m.inputs.includes(input)));
  const set = (i: number, key: string) => onChange(value.map((v, j) => (j === i ? key : v)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((key, i) => (
        <div className="flex max-w-full items-center gap-0.5 rounded-lg border bg-white/[0.03] py-0.5 pr-0.5 pl-2.5" key={i}>
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: slotColor(i), boxShadow: `0 0 8px ${slotColor(i)}` }} />
          <ModelSelect models={usable} value={key} onChange={(k) => set(i, k)} label={slotLabel(i)} disabled={disabled} />
          <Tip text={value.length <= min ? `At least ${min} ${min === 1 ? "model is" : "models are"} needed` : `Remove ${slotLabel(i).toLowerCase()}`}>
            {/* A span keeps the tooltip working while the button is disabled. */}
            <span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${slotLabel(i)}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                disabled={disabled || value.length <= min}
              >
                <X />
              </Button>
            </span>
          </Tip>
        </div>
      ))}
      <Tip text={value.length >= max ? `At most ${max} models` : "Add one more model to the game"}>
        <span>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onChange([...value, usable[value.length % usable.length]!.key])}
            disabled={disabled || value.length >= max || usable.length === 0}
          >
            <Plus /> Add model
          </Button>
        </span>
      </Tip>
    </div>
  );
}

/** A model menu with a search field, grouped by host. */
function ModelSelect({ models, value, onChange, label, disabled }: { models: ModelInfo[]; value: string; onChange: (key: string) => void; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.key === value);
  const groups = [...hosts.map((h) => h.key), ...new Set(models.map((m) => m.provider))]
    .filter((key, i, all) => all.indexOf(key) === i)
    .map((key) => ({ key, host: hostByKey(key), models: models.filter((m) => m.provider === key) }))
    .filter((g) => g.models.length > 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled} className="min-w-0 gap-1.5 px-2 font-normal">
          {current ? <ModelName label={current.label} /> : <span className="text-muted-foreground">Pick a model</span>}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* A plain substring search: cmdk's fuzzy match finds "luna" in "clef flash openrouter". */}
        <Command filter={(text, search) => (text.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search models or hosts" />
          <CommandList>
            <CommandEmpty>No model found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.key}
                heading={
                  <span className="flex items-center gap-1.5">
                    {group.host && <img src={group.host.logo} alt="" className="size-3 rounded-[2px]" />}
                    {group.host?.name ?? group.key}
                  </span>
                }
              >
                {group.models.map((m) => (
                  <CommandItem
                    key={m.key}
                    // cmdk searches this text: the model name, the host and the key.
                    value={`${m.label} ${m.key}`}
                    onSelect={() => {
                      onChange(m.key);
                      setOpen(false);
                    }}
                  >
                    <ModelName label={splitLabel(m.label).name} />
                    {m.inputs.includes("audio") && <span className="caps text-[9px] text-muted-foreground">audio</span>}
                    <Check className={m.key === value ? "ml-auto opacity-100" : "ml-auto opacity-0"} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
