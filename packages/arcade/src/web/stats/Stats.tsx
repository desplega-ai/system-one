// The Stats page: a live feed of the calls, and the server's call log summed for today (polled every 5 s)
// or the last 7 or 30 days (every 30 s).
import { cn } from "cn";
import { ArrowDown, ArrowUp, ChartColumn, Coins, Gamepad2, Hash, type LucideIcon, Timer, TriangleAlert, Users, Zap } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/web/components/ui/alert";
import { Card } from "@/web/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/web/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { api, type CallStats, type ModelInfo, type Stats as StatsData, type StatsRange } from "../lib/api.ts";
import { refreshBudget, useBudget } from "../lib/budget.ts";
import { hostByKey } from "../ui/brands.ts";
import { ModelName } from "../ui/ModelName.tsx";
import { MineToggle, useMine } from "../ui/MineToggle.tsx";
import { onChip } from "../ui/RankingFilters.tsx";
import { compact, count, gameLabel, money, ms, percent } from "./format.ts";

/** How often each range polls. The server caches today for 4 s and the longer ranges for 15 s. */
const REFRESH_MS: Record<StatsRange, number> = { today: 5_000, "7d": 30_000, "30d": 30_000 };
const ranges: { value: StatsRange; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
];

const errorNotes: Record<string, string> = {
  aborted: "Stopped by the page, for example when a newer turn replaced the call. Not a failure.",
  http: "The provider answered with an HTTP error.",
  bad_response: "The answer did not have the expected shape.",
  missing_credentials: "The server has no key for the provider.",
  error: "Any other error.",
};

export function Stats({ arg }: { arg?: string }) {
  const range = ranges.find((r) => r.value === arg) ?? ranges[0]!;
  const [stats, setStats] = useState<StatsData>();
  const [error, setError] = useState<string>();
  const [updated, setUpdated] = useState<Date>();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const budget = useBudget();
  const [mine, setMine] = useMine();
  /** Whether the shown stats are "mine", so they dim while the other kind loads. */
  const [shownMine, setShownMine] = useState(mine);

  useEffect(() => {
    api.models().then(setModels, () => {});
  }, []);

  useEffect(() => {
    let live = true;
    const load = () => {
      api.stats(range.value, mine).then(
        (next) => {
          if (!live) return;
          setStats(next);
          setShownMine(mine);
          setError(undefined);
          setUpdated(new Date());
        },
        (e: Error) => live && setError(e.message),
      );
      refreshBudget();
    };
    load();
    const id = setInterval(() => document.hidden || load(), REFRESH_MS[range.value]);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [range.value, mine]);

  const label = (key: string) => models.find((m) => m.key === key)?.label ?? key;
  const stale = stats !== undefined && (stats.range !== range.value || shownMine !== mine);

  return (
    <div className="space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ChartColumn className="size-5 text-muted-foreground" /> Stats
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mine ? "Your calls from this browser" : "Every model call the arcade made"}, from the server's log. Days start at 00:00 UTC.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {updated && (
            <span className="font-mono text-xs text-muted-foreground">
              updated {updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <MineToggle value={mine} onChange={setMine} />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={range.value}
            onValueChange={(value) => {
              if (value) window.location.hash = value === "today" ? "#/stats" : `#/stats/${value}`;
            }}
          >
            {ranges.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className={onChip}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!stats ? (
        <p className="text-sm text-muted-foreground">Loading the stats.</p>
      ) : (
        <div className={cn("space-y-5 transition-opacity", stale && "opacity-50")}>
          <Kpis stats={stats} days={range.days} cap={range.value !== "today" ? undefined : mine ? budget?.you?.cap : budget?.dailyUsd} />
          <ChartCard stats={stats} />
          {stats.totals.calls === 0 ? (
            <Card className="items-center gap-2 py-10 text-center">
              <p className="font-medium">No calls {range.value === "today" ? "today" : `in the last ${range.label}`} yet.</p>
              <p className="text-sm text-muted-foreground">
                Play <a href="#/attention" className="text-foreground underline-offset-4 hover:underline">Attention</a> or{" "}
                <a href="#/arena" className="text-foreground underline-offset-4 hover:underline">Arena</a>, and the numbers show up here.
              </p>
            </Card>
          ) : (
            <>
              <ModelsTable stats={stats} label={label} />
              <div className="grid gap-5 lg:grid-cols-3">
                <Providers stats={stats} />
                <Games stats={stats} />
                <Errors stats={stats} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Kpis({ stats, days, cap }: { stats: StatsData; days: number; cap?: number }) {
  const t = stats.totals;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={Coins} label="Spend" value={money(t.usd)} meter={cap ? t.usd / cap : undefined}>
        {cap ? `of the ${money(cap)} cap` : `${money(t.usd / days)} a day`}
      </Kpi>
      <Kpi icon={Zap} label="Calls" value={count(t.calls)}>
        <span className={cn(t.failed > 0 && "text-destructive")}>{count(t.failed)} failed</span>, {count(t.aborted)} stopped
      </Kpi>
      <Kpi icon={Timer} label="Latency, median" value={ms(t.p50Ms)}>
        95% under {ms(t.p95Ms)}
      </Kpi>
      <Kpi icon={Users} label="Visitors" value={count(t.visitors)}>
        made at least one call
      </Kpi>
      <Kpi icon={Gamepad2} label="Runs" value={count(t.runs)}>
        games and setups
      </Kpi>
      <Kpi icon={Hash} label="Tokens" value={compact.format(t.inputTokens + t.outputTokens)}>
        {compact.format(t.inputTokens)} in, {compact.format(t.outputTokens)} out
      </Kpi>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, meter, children }: { icon: LucideIcon; label: string; value: string; meter?: number; children: ReactNode }) {
  return (
    <Card className="gap-1.5 px-4 py-4">
      <span className="caps flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </span>
      <span className="font-mono text-2xl font-medium tracking-tight tabular-nums">{value}</span>
      {meter !== undefined && (
        <span className="h-1 overflow-hidden rounded-full bg-white/10">
          <span
            className={cn("block h-full rounded-full transition-[width] duration-700", meter >= 1 ? "bg-destructive" : meter >= 0.75 ? "bg-amber-400" : "bg-foreground/70")}
            style={{ width: `${Math.min(1, meter) * 100}%` }}
          />
        </span>
      )}
      <span className="text-xs text-muted-foreground">{children}</span>
    </Card>
  );
}

type Metric = "calls" | "usd";

/** One bar per hour (today) or per day. Failed calls show red at the top of the bar. Hours still to come stay empty. */
function ChartCard({ stats }: { stats: StatsData }) {
  const [metric, setMetric] = useState<Metric>("calls");
  const hourly = stats.range === "today";
  const width = hourly ? 13 : 10;
  const nowKey = new Date().toISOString().slice(0, width);
  const values = stats.series.map((b) => (metric === "calls" ? b.calls : b.usd));
  const max = Math.max(...values);
  const total = values.reduce((a, b) => a + b, 0);
  const format = metric === "calls" ? count : money;
  const tick = (at: string, i: number) => {
    const date = new Date(at);
    if (hourly) return i % 6 === 0 ? `${String(date.getUTCHours()).padStart(2, "0")}:00` : "";
    if (stats.series.length > 7 && i % 5 !== 0) return "";
    return date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">
            {metric === "calls" ? "Calls" : "Spend"} per {hourly ? "hour" : "day"}
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">UTC</span>
          </h2>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {format(total)} in total{max > 0 && `, peak ${format(max)}`}
          </p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(value) => value && setMetric(value as Metric)}>
          <ToggleGroupItem value="calls" className={onChip}>
            Calls
          </ToggleGroupItem>
          <ToggleGroupItem value="usd" className={onChip}>
            Spend
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="relative">
        {/* Grid lines at the peak and at half of it. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40">
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-white/[0.07]" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.07]" />
        </div>
        <div className="flex h-40 items-end gap-[3px] sm:gap-1">
          {stats.series.map((bucket, i) => {
            const value = values[i]!;
            const key = bucket.at.slice(0, width);
            const current = key === nowKey;
            const future = key > nowKey;
            const height = max > 0 ? (value / max) * 100 : 0;
            return (
              <Tooltip key={bucket.at}>
                <TooltipTrigger asChild>
                  <div className="group flex h-full flex-1 flex-col justify-end">
                    {value > 0 ? (
                      <div
                        className={cn(
                          "flex w-full flex-col overflow-hidden rounded-t-[3px] transition-[height] duration-500",
                          current ? "bg-foreground" : "bg-foreground/40 group-hover:bg-foreground/70",
                        )}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      >
                        {metric === "calls" && bucket.failed > 0 && <div className="w-full bg-destructive" style={{ height: `${(bucket.failed / bucket.calls) * 100}%` }} />}
                      </div>
                    ) : (
                      <div className={cn("h-px w-full", future ? "bg-white/[0.04]" : "bg-white/15")} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono tabular-nums">
                  <p className="font-sans font-medium">{bucketName(bucket.at, hourly)}</p>
                  {future ? (
                    <p>still to come</p>
                  ) : (
                    <p>
                      {count(bucket.calls)} calls, {count(bucket.failed)} failed, {money(bucket.usd)}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="mt-2 flex gap-[3px] sm:gap-1">
          {stats.series.map((bucket, i) => (
            <span key={bucket.at} className="flex-1 overflow-visible font-mono text-[10px] whitespace-nowrap text-muted-foreground">
              {tick(bucket.at, i)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

function bucketName(at: string, hourly: boolean): string {
  const date = new Date(at);
  if (!hourly) return date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const hour = date.getUTCHours();
  return `${String(hour).padStart(2, "0")}:00 to ${String((hour + 1) % 24).padStart(2, "0")}:00 UTC`;
}

type ModelRow = StatsData["models"][number];
type SortKey = "calls" | "failed" | "p50Ms" | "p95Ms" | "inputTokens" | "outputTokens" | "usd";

const columns: { key: SortKey; label: string; render: (row: ModelRow) => ReactNode }[] = [
  { key: "calls", label: "Calls", render: (row) => count(row.calls) },
  {
    key: "failed",
    label: "Failed",
    render: (row) => <span className={cn(row.failed > 0 ? "text-destructive" : "text-muted-foreground")}>{row.failed > 0 ? `${count(row.failed)} (${percent(row.failed, row.calls)})` : "0"}</span>,
  },
  { key: "p50Ms", label: "Median", render: (row) => ms(row.p50Ms) },
  { key: "p95Ms", label: "p95", render: (row) => ms(row.p95Ms) },
  { key: "inputTokens", label: "Tokens in", render: (row) => compact.format(row.inputTokens) },
  { key: "outputTokens", label: "Tokens out", render: (row) => compact.format(row.outputTokens) },
  { key: "usd", label: "Cost", render: (row) => money(row.usd) },
];

function ModelsTable({ stats, label }: { stats: StatsData; label: (key: string) => string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "calls", desc: true });
  const rows = stats.models.toSorted((a, b) => {
    // Models without a value (no successful call) go last, whatever the direction.
    const [x, y] = [a[sort.key], b[sort.key]];
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return sort.desc ? y - x : x - y;
  });
  const spend = stats.totals.usd;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <span className="font-medium">Models</span>
        <span className="caps text-muted-foreground">{stats.models.length} used</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="caps pl-5 text-muted-foreground">Model</TableHead>
            {columns.map((column) => {
              const active = sort.key === column.key;
              return (
                <TableHead key={column.key} className="caps text-right text-muted-foreground" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button
                    type="button"
                    onClick={() => setSort(active ? { key: column.key, desc: !sort.desc } : { key: column.key, desc: true })}
                    className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", active && "text-foreground")}
                    title={`Sort by ${column.label}`}
                  >
                    {column.label}
                    {active && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                </TableHead>
              );
            })}
            <TableHead className="caps w-40 pr-5 text-muted-foreground">Share of spend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.provider}/${row.model}`}>
              <TableCell className="pl-5">
                <ModelName label={label(row.model)} />
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} className={cn("text-right font-mono tabular-nums", sort.key === column.key && "text-foreground")}>
                  {column.render(row)}
                </TableCell>
              ))}
              <TableCell className="pr-5">
                <ShareBar part={row.usd} whole={spend} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ShareBar({ part, whole }: { part: number; whole: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-foreground/70 transition-[width] duration-700" style={{ width: whole > 0 ? `${(part / whole) * 100}%` : 0 }} />
      </span>
      <span className="w-10 text-right font-mono text-xs text-muted-foreground tabular-nums">{percent(part, whole)}</span>
    </span>
  );
}

/** A small card with a title and rows. */
function ListCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <span className="font-medium">{title}</span>
        {note && <span className="caps text-muted-foreground">{note}</span>}
      </div>
      <ul className="divide-y divide-white/[0.06]">{children}</ul>
    </Card>
  );
}

function Providers({ stats }: { stats: StatsData }) {
  const byProvider = new Map<string, Pick<CallStats, "calls" | "failed" | "usd">>();
  for (const row of stats.models) {
    const sum = byProvider.get(row.provider) ?? { calls: 0, failed: 0, usd: 0 };
    byProvider.set(row.provider, { calls: sum.calls + row.calls, failed: sum.failed + row.failed, usd: sum.usd + row.usd });
  }
  const rows = [...byProvider.entries()].sort(([, a], [, b]) => b.usd - a.usd);
  return (
    <ListCard title="Providers" note="by spend">
      {rows.map(([provider, sum]) => {
        const host = hostByKey(provider);
        return (
          <li key={provider} className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              {host && <img src={host.logo} alt="" className="size-4 rounded-sm" />}
              <span className="font-medium">{host?.name ?? provider}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                {count(sum.calls)} calls, {money(sum.usd)}
              </span>
            </div>
            <ShareBar part={sum.usd} whole={stats.totals.usd} />
          </li>
        );
      })}
    </ListCard>
  );
}

function Games({ stats }: { stats: StatsData }) {
  return (
    <ListCard title="Games" note="by calls">
      {stats.games.map((row) => {
        const { name, variant } = gameLabel(row.game);
        return (
          <li key={row.game} className="space-y-2 px-5 py-3">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">{name}</span>
              {variant && <span className="text-xs text-muted-foreground">{variant}</span>}
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                {count(row.runs)} {row.runs === 1 ? "run" : "runs"}, {money(row.usd)}
              </span>
            </div>
            <ShareBar part={row.calls} whole={stats.totals.calls} />
          </li>
        );
      })}
    </ListCard>
  );
}

function Errors({ stats }: { stats: StatsData }) {
  return (
    <ListCard title="Errors" note={`${percent(stats.totals.failed, stats.totals.calls)} failed`}>
      {stats.errors.length === 0 ? (
        <li className="px-5 py-4 text-sm text-muted-foreground">No errors.</li>
      ) : (
        stats.errors.map((row) => (
          <li key={row.code} className="flex items-start gap-3 px-5 py-3 text-sm">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", row.code === "aborted" ? "bg-white/30" : "bg-destructive")} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs">{row.code}</p>
              <p className="text-xs text-muted-foreground">{errorNotes[row.code] ?? "An error from the provider or the server."}</p>
            </div>
            <span className="font-mono text-xs tabular-nums">{count(row.calls)}</span>
          </li>
        ))
      )}
    </ListCard>
  );
}
