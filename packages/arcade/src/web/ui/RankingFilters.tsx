// Filters above a leaderboard: game options as chips, and the provider and model of each row.
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import type { ModelInfo } from "../lib/api.ts";
import { hostByKey, hosts } from "./brands.ts";
import { splitLabel } from "./ModelName.tsx";

// The selected chip keys on aria-checked, like the setup chips.
export const onChip = "h-7 px-2.5 text-xs aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground";

/** Radix treats an empty value as "nothing selected", so "" (all) is "all" inside the toggle group. Clicking the
 * selected chip again unselects it, which also means all. */
const toGroup = (value: string) => value || "all";
const fromGroup = (value: string) => (value === "all" ? "" : value);

/** One filter as a row of chips. The value "" means all. */
export function FilterChips({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="caps text-[10px] text-muted-foreground">{label}</span>
      <ToggleGroup type="single" variant="outline" size="sm" value={toGroup(value)} onValueChange={(v) => onChange(fromGroup(v))}>
        {options.map((o) => (
          <ToggleGroupItem key={toGroup(o.value)} value={toGroup(o.value)} className={onChip}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** The provider and model filters. Returns the controls and the row test for the Board. */
export function useModelFilters(models: ModelInfo[]) {
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const names = [...new Set(models.map((m) => splitLabel(m.label).name))].sort();
  const present = hosts.filter((h) => models.some((m) => m.provider === h.key));
  const include = (key: string) => {
    const model = models.find((m) => m.key === key);
    if (!model) return host === "" && name === "";
    return (host === "" || model.provider === host) && (name === "" || splitLabel(model.label).name === name);
  };
  const controls = (
    <>
      <div className="flex items-center gap-2">
        <span className="caps text-[10px] text-muted-foreground">Provider</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={toGroup(host)} onValueChange={(v) => setHost(fromGroup(v))}>
          <ToggleGroupItem value="all" className={onChip}>
            All
          </ToggleGroupItem>
          {present.map((h) => (
            <ToggleGroupItem key={h.key} value={h.key} className={onChip} aria-label={h.name}>
              <img src={hostByKey(h.key)!.logo} alt="" className="size-3.5" />
              <span className="hidden xl:inline">{h.name}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-2">
        <span className="caps text-[10px] text-muted-foreground">Model</span>
        <Select value={name || "all"} onValueChange={(v) => setName(v === "all" ? "" : v)}>
          <SelectTrigger size="sm" className="h-7 min-w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            {names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
  return { include, controls };
}
