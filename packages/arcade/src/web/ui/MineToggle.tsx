import { User, Users } from "lucide-react";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { onChip } from "./RankingFilters.tsx";
import { Tip } from "./Tip.tsx";

const KEY = "s1-mine";

/** "Everyone" or "Mine" (the calls of this browser's visitor cookie), shared by Stats and Live and kept in localStorage. */
export function useMine(): [boolean, (mine: boolean) => void] {
  const [mine, setMine] = useState(() => localStorage.getItem(KEY) === "1");
  return [
    mine,
    (next) => {
      localStorage.setItem(KEY, next ? "1" : "0");
      setMine(next);
    },
  ];
}

export function MineToggle({ value, onChange }: { value: boolean; onChange: (mine: boolean) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value ? "mine" : "all"} onValueChange={(v) => v && onChange(v === "mine")}>
      <Tip text="The calls of every visitor">
        <ToggleGroupItem value="all" className={onChip}>
          <Users /> Everyone
        </ToggleGroupItem>
      </Tip>
      <Tip text="Only the calls from this browser">
        <ToggleGroupItem value="mine" className={onChip}>
          <User /> Mine
        </ToggleGroupItem>
      </Tip>
    </ToggleGroup>
  );
}
