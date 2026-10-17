// The live feed of the Live page: each model call, once stored, goes to the open pages as a server-sent
// event. Calls go out in batches, at most one event per `flushMs`, so a busy arcade sends few messages.
// A page can follow everyone or only its own visitor ("mine"). Only what the page shows leaves the
// server: no visitor ids, no IP hashes, no inputs or outputs.
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
  /** Today's totals, of everyone or of one visitor. */
  today: (visitor?: string) => { calls: number; usd: number };
  /** The newest calls, oldest first, of everyone or of one visitor. */
  recent: (visitor?: string) => RecentCall[];
  flushMs?: number;
  heartbeatMs?: number;
  maxBatch?: number;
  maxViewers?: number;
  maxPerIp?: number;
};

const encoder = new TextEncoder();

export function createLive({ today, recent, flushMs = 1000, heartbeatMs = 15_000, maxBatch = 50, maxViewers = 200, maxPerIp = 10 }: Options) {
  /** `visitor` is set for a page that shows only its own calls. */
  type Viewer = { ip: string; visitor?: string; send: (chunk: string) => void };
  const viewers = new Set<Viewer>();
  let pending: { call: RecentCall; visitor?: string }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const broadcast = (chunk: string) => {
    for (const viewer of viewers) viewer.send(chunk);
  };
  const event = (backlog: boolean, calls: RecentCall[], visitor?: string) =>
    `data: ${JSON.stringify({ backlog, calls, today: today(visitor), viewers: viewers.size } satisfies LiveEvent)}\n\n`;
  const flush = () => {
    flushTimer = undefined;
    const batch = pending;
    pending = [];
    // One event for every page that follows everyone, and one per page that follows only its own calls.
    let shared: string | undefined;
    for (const viewer of viewers) {
      const calls = batch.filter((p) => !viewer.visitor || p.visitor === viewer.visitor).map((p) => p.call).slice(-maxBatch);
      if (calls.length === 0) continue;
      if (viewer.visitor) viewer.send(event(false, calls, viewer.visitor));
      else viewer.send((shared ??= event(false, calls)));
    }
  };

  return {
    /** Queues one stored call, made by `visitor`, for the next batch. Without viewers, nothing is kept. */
    push(call: RecentCall, visitor?: string) {
      if (viewers.size === 0) return;
      pending.push({ call, visitor });
      if (pending.length > maxBatch * 20) pending = pending.slice(-maxBatch * 10);
      flushTimer ??= setTimeout(flush, flushMs);
    },

    /** The event stream for one page, of everyone or of one `visitor`. A comment line every `heartbeatMs`
     * keeps an idle stream open. */
    open(ip: string, signal: AbortSignal, visitor?: string): Response {
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
            visitor,
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
          viewer.send(event(true, recent(visitor), visitor));
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
