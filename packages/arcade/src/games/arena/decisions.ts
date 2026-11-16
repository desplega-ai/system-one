import type { api } from "../../web/lib/api.ts";

/** Keep each match below the public limit of eight simultaneous calls per visitor. */
export function limitDecisions(decide: typeof api.decide, limit = 6): typeof api.decide {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (model, runId, call) => {
    call.signal?.throwIfAborted();
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      call.signal?.throwIfAborted();
      return await decide(model, runId, call);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
