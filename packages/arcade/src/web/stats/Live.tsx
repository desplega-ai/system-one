// The live part of the Stats page: a REC badge, today's spend and calls as they happen, the last minute,
// and a feed of the newest calls. It listens to /api/live (server-sent events). EventSource reconnects by itself.
import { cn } from "cn";
import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/web/components/ui/card";
import type { LiveCall, LiveEvent } from "../lib/api.ts";
import { ModelName } from "../ui/ModelName.tsx";
import { count, gameLabel, ms, smallMoney } from "./format.ts";

const FEED_SIZE = 30;
const WINDOW_MS = 60_000;

type Status = "connecting" | "live" | "offline";
type FeedCall = LiveCall & { id: number };
/** The calls of one event, by the time the page got them. */
type Arrival = { at: number; calls: number; usd: number };

function useLive() {
  const [status, setStatus] = useState<Status>("connecting");
  const [feed, setFeed] = useState<FeedCall[]>([]);
  const [today, setToday] = useState<LiveEvent["today"]>();
  const [viewers, setViewers] = useState(0);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const source = new EventSource("/api/live");
    let id = 0;
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      const fresh = event.calls.map((call) => ({ ...call, id: ++id })).reverse();
      setStatus("live");
      setToday(event.today);
      setViewers(event.viewers);
      setFeed((old) => (event.backlog ? fresh : [...fresh, ...old]).slice(0, FEED_SIZE));
      // The backlog happened before the page opened, so it does not count toward the last minute.
      if (!event.backlog) {
        const usd = event.calls.reduce((sum, call) => sum + (call.usd ?? 0), 0);
        setArrivals((old) => [...old.filter((a) => Date.now() - a.at < WINDOW_MS), { at: Date.now(), calls: event.calls.length, usd }]);
      }
    };
    // A 1 s clock, so the last minute moves on also when no call comes.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      source.close();
      clearInterval(clock);
    };
  }, []);

  const recent = arrivals.filter((a) => now - a.at < WINDOW_MS);
  const perSecond = Array.from({ length: WINDOW_MS / 1000 }, () => 0);
  for (const a of recent) perSecond[perSecond.length - 1 - Math.min(perSecond.length - 1, Math.floor((now - a.at) / 1000))]! += a.calls;
  const minute = { calls: recent.reduce((sum, a) => sum + a.calls, 0), usd: recent.reduce((sum, a) => sum + a.usd, 0) };
  return { status, feed, today, viewers, perSecond, minute };
}

/** Eases a number toward `target` over `durationMs`, so counters roll instead of jumping. */
function useTween(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / durationMs);
      current.current = from + (target - from) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function LivePanel({ label }: { label: (key: string) => string }) {
  const live = useLive();
  const usd = useTween(live.today?.usd ?? 0);
  const calls = useTween(live.today?.calls ?? 0);
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <Rec status={live.status} />
          <span className="font-medium">Live</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">each model call, as it happens</span>
        </div>
        {live.viewers > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
            <Eye className="size-3.5" /> {live.viewers} watching
          </span>
        )}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-5 border-b p-5 lg:border-r lg:border-b-0">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Counter label="Spent today" value={`$${usd.toFixed(5)}`} big />
            <Counter label="Calls today" value={count(Math.round(calls))} big />
            <Counter label="Calls, last minute" value={count(live.minute.calls)} />
            <Counter label="Spend, last minute" value={smallMoney(live.minute.usd)} />
          </div>
          <div className="mt-auto space-y-1.5">
            <div className="flex h-24 items-end gap-px">
              {live.perSecond.map((n, i) => {
                const max = Math.max(1, ...live.perSecond);
                return (
                  <span
                    key={i}
                    className={cn("flex-1 rounded-t-[2px] transition-[height] duration-300", n > 0 ? "bg-live/80" : "bg-white/10")}
                    style={{ height: n > 0 ? `${Math.max(8, (n / max) * 100)}%` : "1px" }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>60 s ago</span>
              <span>calls per second</span>
              <span>now</span>
            </div>
          </div>
        </div>
        <Feed calls={live.feed} label={label} />
      </div>
    </Card>
  );
}

/** A camera's REC light while the feed is connected. */
function Rec({ status }: { status: Status }) {
  const on = status === "live";
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-widest",
        on ? "border-live/40 bg-live/10 text-live" : "text-muted-foreground",
      )}
    >
      <span className="relative flex size-2">
        {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-75" />}
        <span className={cn("relative inline-flex size-2 rounded-full", on ? "bg-live" : "bg-muted-foreground")} />
      </span>
      {on ? "REC" : status === "connecting" ? "CONNECTING" : "OFFLINE"}
    </span>
  );
}

function Counter({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="caps text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("truncate font-mono font-medium tracking-tight tabular-nums", big ? "text-2xl sm:text-3xl" : "text-lg")}>{value}</p>
    </div>
  );
}

function Feed({ calls, label }: { calls: FeedCall[]; label: (key: string) => string }) {
  if (calls.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Waiting for the next call. Start a game in another tab, and watch it here.
      </div>
    );
  }
  return (
    <ol className="h-72 overflow-hidden py-1.5 [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
      {calls.map((call) => {
        const { name, variant } = gameLabel(call.game);
        const stopped = call.error === "aborted";
        return (
          <li
            key={call.id}
            className="grid animate-in grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 px-5 py-1.5 text-sm duration-300 fade-in slide-in-from-top-1 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto_4.5rem]"
          >
            <span className="hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">
              {new Date(call.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", call.error === null ? "bg-emerald-400" : stopped ? "bg-white/30" : "bg-destructive")}
                title={call.error ?? "ok"}
              />
              {/* Phones drop the host's name (the small caps part), so the model name fits. */}
              <ModelName label={label(call.model)} className="min-w-0 shrink [&_.caps]:hidden sm:[&_.caps]:inline-flex" />
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                {name}
                {variant && `, ${variant}`}
              </span>
            </span>
            <span className={cn("font-mono text-xs tabular-nums", call.error !== null && !stopped && "text-destructive")}>
              {call.error !== null && !stopped ? call.error : ms(call.latencyMs)}
            </span>
            <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{call.usd === null ? "" : smallMoney(call.usd)}</span>
          </li>
        );
      })}
    </ol>
  );
}
