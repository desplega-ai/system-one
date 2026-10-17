// The live feed of the Stats page: each model call, once stored, goes to the open pages as a server-sent
// event. Calls go out in batches, at most one event per `flushMs`, so a busy arcade sends few messages.
// Only what the page shows leaves the server: no visitor ids, no IP hashes, no inputs or outputs.
import type { RecentCall } from "./store.ts";

export type LiveEvent = {
  /** True for the first event of a stream: the newest calls from before the page opened. */
  backlog: boolean;
  /** Oldest first. */
  calls: RecentCall[];
  today: { calls: number; usd: number };
  /** Pages with the feed open, this one included. */
  viewers: number;
};

type Options = {
  today: () => { calls: number; usd: number };
  recent: () => RecentCall[];
  flushMs?: number;
  heartbeatMs?: number;
  maxBatch?: number;
  maxViewers?: number;
  maxPerIp?: number;
};

const encoder = new TextEncoder();

export function createLive({ today, recent, flushMs = 1000, heartbeatMs = 15_000, maxBatch = 50, maxViewers = 200, maxPerIp = 4 }: Options) {
  type Viewer = { ip: string; send: (chunk: string) => void };
  const viewers = new Set<Viewer>();
  let pending: RecentCall[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const broadcast = (chunk: string) => {
    for (const viewer of viewers) viewer.send(chunk);
  };
  const event = (backlog: boolean, calls: RecentCall[]) =>
    `data: ${JSON.stringify({ backlog, calls, today: today(), viewers: viewers.size } satisfies LiveEvent)}\n\n`;
  const flush = () => {
    flushTimer = undefined;
    const calls = pending.slice(-maxBatch);
    pending = [];
    if (calls.length > 0) broadcast(event(false, calls));
  };

  return {
    /** Queues one stored call for the next batch. Without viewers, nothing is kept. */
    push(call: RecentCall) {
      if (viewers.size === 0) return;
      pending.push(call);
      if (pending.length > maxBatch * 4) pending = pending.slice(-maxBatch);
      flushTimer ??= setTimeout(flush, flushMs);
    },

    /** The event stream for one page. A comment line every `heartbeatMs` keeps an idle stream open. */
    open(ip: string, signal: AbortSignal): Response {
      const fromIp = [...viewers].filter((v) => v.ip === ip).length;
      if (viewers.size >= maxViewers || fromIp >= maxPerIp) {
        return Response.json({ error: { code: "too_many_viewers", message: "too many live pages open, try again later" } }, { status: 503 });
      }
      let viewer: Viewer | undefined;
      const close = () => {
        if (!viewer) return;
        viewers.delete(viewer);
        viewer = undefined;
        if (viewers.size === 0) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          viewer = {
            ip,
            send: (chunk) => {
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                close();
              }
            },
          };
          viewers.add(viewer);
          heartbeat ??= setInterval(() => broadcast(": ping\n\n"), heartbeatMs);
          viewer.send(event(true, recent()));
        },
        cancel: close,
      });
      signal.addEventListener("abort", close);
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
    },

    get viewers() {
      return viewers.size;
    },
  };
}
