import type { Input, ModelInfo } from "../lib/api.ts";

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
};

export function ModelPicker({ models, value, onChange, needs = [], min = 1, max = 6, slotLabel = (i) => `Player ${i + 1}` }: Props) {
  const usable = models.filter((m) => needs.every((input) => m.inputs.includes(input)));
  const set = (i: number, key: string) => onChange(value.map((v, j) => (j === i ? key : v)));
  return (
    <div className="picker">
      {value.map((key, i) => (
        <div className="picker-slot" key={i}>
          <span className="picker-label">{slotLabel(i)}</span>
          <select value={key} onChange={(e) => set(i, e.target.value)} aria-label={slotLabel(i)}>
            {usable.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} disabled={value.length <= min}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, usable[value.length % usable.length]!.key])} disabled={value.length >= max || usable.length === 0}>
        Add player
      </button>
    </div>
  );
}
