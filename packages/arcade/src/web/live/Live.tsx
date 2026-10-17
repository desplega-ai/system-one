// The Live page: a REC badge, today's spend and calls as they happen, the last minute, and a feed of the
// newest calls, for everyone or only this browser. It listens to /api/live (server-sent events).
import { cn } from "cn";
import { Eye } from "lucide-react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card } from "@/web/components/ui/card";
import { api, type LiveCall, type LiveEvent, type ModelInfo } from "../lib/api.ts";
import { count, gameLabel, ms, smallMoney } from "../stats/format.ts";
import { FlipText } from "../ui/FlipText.tsx";
import { MineToggle, useMine } from "../ui/MineToggle.tsx";
import { ModelName } from "../ui/ModelName.tsx";

const FEED_SIZE = 40;
const WINDOW_MS = 60_000;
/** After a failed connection (for example too many pages open), try again this much later. */
const RETRY_MS = 5_000;

type Status = "connecting" | "live" | "offline";
/** `delayMs` staggers the rows that arrive together, so they dash in one after the other. */
type FeedCall = LiveCall & { id: number; delayMs: number };
/** The calls of one event, by the time the page got them. */
type Arrival = { at: number; calls: number; usd: number };

function useLive(mine: boolean) {
  const [status, setStatus] = useState<Status>("connecting");
  const [feed, setFeed] = useState<FeedCall[]>([]);
  const [today, setToday] = useState<LiveEvent["today"]>();
  const [viewers, setViewers] = useState(0);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [now, setNow] = useState(Date.now());
  const nextId = useRef(0);

  useEffect(() => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setStatus("connecting");
    setFeed([]);
    setToday(undefined);
    setArrivals([]);
    const connect = () => {
      source = new EventSource(`/api/live${mine ? "?mine=1" : ""}`);
      source.onopen = () => setStatus("live");
      source.onerror = () => {
        // EventSource retries a dropped stream by itself, but not a refused one.
        if (source?.readyState !== EventSource.CLOSED) return setStatus("connecting");
        setStatus("offline");
        retry = setTimeout(connect, RETRY_MS);
      };
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as LiveEvent;
        // Newest first. In a batch, the oldest call dashes in first.
        const step = event.backlog ? 25 : 70;
        const fresh = event.calls.map((call, i) => ({ ...call, id: ++nextId.current, delayMs: i * step })).reverse();
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
    };
    connect();
    return () => {
      source?.close();
      clearTimeout(retry);
    };
  }, [mine]);

  // A 1 s clock, so the last minute moves on also when no call comes.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  const recent = arrivals.filter((a) => now - a.at < WINDOW_MS);
  const perSecond = Array.from({ length: WINDOW_MS / 1000 }, () => 0);
  for (const a of recent) perSecond[perSecond.length - 1 - Math.min(perSecond.length - 1, Math.floor((now - a.at) / 1000))]! += a.calls;
  const minute = { calls: recent.reduce((sum, a) => sum + a.calls, 0), usd: recent.reduce((sum, a) => sum + a.usd, 0) };
  return { status, feed, today, viewers, perSecond, minute };
}

export function Live() {
  const [mine, setMine] = useMine();
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    api.models().then(setModels, () => {});
  }, []);
  const label = (key: string) => models.find((m) => m.key === key)?.label ?? key;
  const live = useLive(mine);
  const max = Math.max(1, ...live.perSecond);

  return (
    <div className="space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <Rec status={live.status} /> Live
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mine ? "Your calls from this browser, as they happen." : "Every model call the arcade makes, as it happens."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {live.viewers > 0 && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
              <Eye className="size-3.5" /> {live.viewers} watching
            </span>
          )}
          <MineToggle value={mine} onChange={setMine} />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <Card className="gap-6 px-5 py-5">
          <Counter label={mine ? "You spent today" : "Spent today"} value={`$${(live.today?.usd ?? 0).toFixed(5)}`} big />
          <Counter label={mine ? "Your calls today" : "Calls today"} value={count(live.today?.calls ?? 0)} big />
          <div className="grid grid-cols-2 gap-4">
            <Counter label="Calls, last minute" value={count(live.minute.calls)} />
            <Counter label="Spend, last minute" value={smallMoney(live.minute.usd)} />
          </div>
          <div className="mt-auto space-y-1.5">
            <div className="flex h-32 items-end gap-px">
              {live.perSecond.map((n, i) => (
                <span
                  // One bar per second, by position.
                  key={i}
                  className={cn("flex-1 rounded-t-[2px] transition-[height] duration-300", n > 0 ? "bg-live/80" : "bg-white/10")}
                  style={{ height: n > 0 ? `${Math.max(6, (n / max) * 100)}%` : "1px" }}
                />
              ))}
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>60 s ago</span>
              <span>calls per second</span>
              <span>now</span>
            </div>
          </div>
        </Card>
        <Card className="gap-0 overflow-hidden py-0">
          <div className="caps grid grid-cols-[minmax(0,1fr)_auto_4.5rem] gap-3 border-b px-5 py-3 text-[10px] text-muted-foreground sm:grid-cols-[3.75rem_minmax(0,1fr)_auto_4.5rem]">
            <span className="hidden sm:inline">Time</span>
            <span>Model and game</span>
            <span>Latency</span>
            <span className="text-right">Cost</span>
          </div>
          <Feed calls={live.feed} label={label} mine={mine} />
        </Card>
      </div>
    </div>
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
      <FlipText text={value} className={cn("font-mono font-medium tracking-tight tabular-nums", big ? "text-4xl sm:text-5xl" : "text-xl")} />
    </div>
  );
}

const trails = { ok: "oklch(0.78 0.16 160)", failed: "oklch(0.64 0.22 25)", stopped: "oklch(0.7 0 0)" };
/** Where the sparks fly, from the status dot. */
const sparks = [
  { dx: "-14px", dy: "-9px" },
  { dx: "-16px", dy: "6px" },
  { dx: "-6px", dy: "-13px" },
  { dx: "-9px", dy: "12px" },
];

/**
 * The newest calls on top. A new row dashes in with a trail and sparks, and the older rows slide down
 * (each row remembers where it was, and animates from there).
 */
function Feed({ calls, label, mine }: { calls: FeedCall[]; label: (key: string) => string; mine: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.children ?? []) {
      const el = row as HTMLElement;
      const key = el.dataset.id!;
      const before = tops.current.get(key);
      next.set(key, el.offsetTop);
      if (before !== undefined && before !== el.offsetTop) {
        el.animate([{ transform: `translateY(${before - el.offsetTop}px)` }, { transform: "translateY(0)" }], {
          duration: 320,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    tops.current = next;
  }, [calls]);

  if (calls.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {mine ? "No calls from this browser yet today. Start a game, and watch them come in here." : "Waiting for the next call. Start a game in another tab, and watch it here."}
      </div>
    );
  }
  return (
    <ol ref={list} className="relative h-[34rem] overflow-hidden py-1.5 [mask-image:linear-gradient(to_bottom,black_80%,transparent)]">
      {calls.map((call) => {
        const { name, variant } = gameLabel(call.game);
        const outcome = call.error === null ? "ok" : call.error === "aborted" ? "stopped" : "failed";
        return (
          <li
            key={call.id}
            data-id={call.id}
            style={{ "--trail": trails[outcome], "--delay": `${call.delayMs}ms` } as CSSProperties}
            className="dash-in relative grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 px-5 py-1.5 text-sm sm:grid-cols-[3.75rem_minmax(0,1fr)_auto_4.5rem]"
          >
            <span className="dash-trail" />
            <span className="relative hidden font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">
              {new Date(call.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </span>
            <span className="relative flex min-w-0 items-center gap-2">
              <span className="relative size-1.5 shrink-0 rounded-full" style={{ background: "var(--trail)" }} title={call.error ?? "ok"}>
                {sparks.map((spark) => (
                  <span key={spark.dx + spark.dy} className="spark top-0 left-0" style={{ "--dx": spark.dx, "--dy": spark.dy } as CSSProperties} />
                ))}
              </span>
              {/* Phones drop the host's name (the small caps part), so the model name fits. */}
              <ModelName label={label(call.model)} className="min-w-0 shrink [&_.caps]:hidden sm:[&_.caps]:inline-flex" />
              <span className="hidden truncate text-xs text-muted-foreground md:inline">
                {name}
                {variant && `, ${variant}`}
              </span>
            </span>
            <span className={cn("relative font-mono text-xs tabular-nums", outcome === "failed" && "text-destructive")}>
              {outcome === "failed" ? call.error : ms(call.latencyMs)}
            </span>
            <span className="relative text-right font-mono text-xs text-muted-foreground tabular-nums">{call.usd === null ? "" : smallMoney(call.usd)}</span>
          </li>
        );
      })}
    </ol>
  );
}
