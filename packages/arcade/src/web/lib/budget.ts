// Today's spend, shared by the top bar and the games. It refreshes every 5 s while a page shows it and the
// tab is visible. A game also calls refreshBudget() after its calls.
import { useEffect, useState } from "react";
import { api, type BudgetInfo } from "./api.ts";

const POLL_MS = 5_000;

let current: BudgetInfo | undefined;
const listeners = new Set<(budget: BudgetInfo) => void>();
let poll: ReturnType<typeof setInterval> | undefined;

export function refreshBudget() {
  api.budget().then((budget) => {
    current = budget;
    for (const listener of listeners) listener(budget);
  }, () => {});
}

export function useBudget(): BudgetInfo | undefined {
  const [budget, setBudget] = useState(current);
  useEffect(() => {
    listeners.add(setBudget);
    refreshBudget();
    poll ??= setInterval(() => document.hidden || refreshBudget(), POLL_MS);
    return () => {
      listeners.delete(setBudget);
      if (listeners.size === 0) {
        clearInterval(poll);
        poll = undefined;
      }
    };
  }, []);
  return budget;
}
