// Today's spend, shared by the top bar and the games. A game calls refreshBudget() after its calls.
import { useEffect, useState } from "react";
import { api, type BudgetInfo } from "./api.ts";

let current: BudgetInfo | undefined;
const listeners = new Set<(budget: BudgetInfo) => void>();

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
    return () => {
      listeners.delete(setBudget);
    };
  }, []);
  return budget;
}
