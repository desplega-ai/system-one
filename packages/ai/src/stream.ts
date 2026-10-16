// A steady flow of decisions: one call every N ms, without waiting for the previous answer.

export type DecisionStreamOptions<Call, Result> = {
  /** Builds the next call from the current state, or returns null to skip this tick. */
  makeCall: () => Call | null;
  decide: (call: Call, signal: AbortSignal) => Promise<Result>;
  everyMs: number;
  /** How many calls can be open at once. When that many are open, the tick is skipped. Default 1. */
  maxInFlight?: number;
  /** Gets each result that is newer than the last one delivered. Older results are dropped. */
  onResult: (result: Result, call: Call) => void;
  onError?: (error: unknown, call: Call) => void;
};

export type DecisionStream = {
  /** Stops the timer and aborts the open calls. No callback runs after this. */
  stop(): void;
  readonly inFlight: number;
};

/** Starts at once with a first call, then calls again every `everyMs`. Works with any `decide`. */
export function decisionStream<Call, Result>(options: DecisionStreamOptions<Call, Result>): DecisionStream {
  const maxInFlight = options.maxInFlight ?? 1;
  const open = new Map<number, AbortController>();
  let issued = 0;
  let delivered = 0;
  let stopped = false;

  const tick = () => {
    if (stopped || open.size >= maxInFlight) return;
    const call = options.makeCall();
    if (call === null) return;
    const seq = ++issued;
    const controller = new AbortController();
    open.set(seq, controller);
    options
      .decide(call, controller.signal)
      .then(
        (result) => {
          if (stopped || seq < delivered) return;
          delivered = seq;
          options.onResult(result, call);
        },
        (error) => {
          if (!stopped) options.onError?.(error, call);
        },
      )
      .finally(() => open.delete(seq));
  };

  tick();
  const timer = setInterval(tick, options.everyMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const controller of open.values()) controller.abort();
      open.clear();
    },
    get inFlight() {
      return open.size;
    },
  };
}
