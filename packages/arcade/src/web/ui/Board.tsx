import { cn } from "cn";
import { ArrowDown, ArrowUp, Trophy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Card } from "@/web/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { api, type ModelInfo, type RankingRow } from "../lib/api.ts";
import { ModelName } from "./ModelName.tsx";

export type Column = { metric: string; label: string; format?: (mean: number) => string };

type Props = {
  /** One game, or several that share metrics (lockstep and real-time). */
  game: string | string[];
  columns: Column[];
  models: ModelInfo[];
  refreshKey?: unknown;
  /** Keeps only runs whose config has these values, for example { policy: "top" }. */
  config?: Record<string, string>;
  /** Keeps only the models this returns true for. Gets the registry key ("openai:gpt-6-luna"). */
  include?: (model: string) => boolean;
  /** Filters, shown above the table. */
  toolbar?: ReactNode;
};

/** "played" sorts by how many runs a model played. Any other key is a metric. */
type Sort = { key: string; desc: boolean };

/** Per-model ranking. Sorted by the first column, or by any column the user clicks. Refetches when the games, the config or `refreshKey` change. */
export function Board({ game, columns, models, refreshKey, config = {}, include, toolbar }: Props) {
  const [rows, setRows] = useState<RankingRow[]>();
  const [error, setError] = useState<string>();
  const [sort, setSort] = useState<Sort>({ key: columns[0]!.metric, desc: true });
  const games = [game].flat();
  const gamesKey = games.join(",");
  const configKey = JSON.stringify(config);

  useEffect(() => {
    setError(undefined);
    api.rankings(games, config).then(setRows, (e: Error) => setError(e.message));
  }, [gamesKey, configKey, refreshKey]);

  const byModel = new Map<string, Map<string, RankingRow>>();
  for (const row of rows ?? []) {
    if (include && !include(row.model.replace(/ \(transcript\)$/, ""))) continue;
    if (!byModel.has(row.model)) byModel.set(row.model, new Map());
    byModel.get(row.model)!.set(row.metric, row);
  }
  const first = columns[0]!.metric;
  const played = (metrics: Map<string, RankingRow>) => metrics.get(first)?.rows ?? 0;
  const value = (metrics: Map<string, RankingRow>) => (sort.key === "played" ? played(metrics) : metrics.get(sort.key)?.mean);
  const sorted = [...byModel.entries()].sort(([, a], [, b]) => {
    // Models without the metric go last, whatever the direction.
    const [x, y] = [value(a), value(b)];
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : 1) : -1;
    return sort.desc ? y - x : x - y;
  });
  // The voice game scores a model that reads the transcript as "<key> (transcript)".
  const label = (key: string) => {
    const suffix = key.endsWith(" (transcript)") ? " (transcript)" : "";
    const base = key.slice(0, key.length - suffix.length);
    return (models.find((m) => m.key === base)?.label ?? base) + suffix;
  };
  const header = (key: string, text: string, className?: string) => {
    const active = sort.key === key;
    return (
      <TableHead key={key} className={cn("caps text-right text-muted-foreground", className)} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => setSort(active ? { key, desc: !sort.desc } : { key, desc: true })}
          className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", active && "text-foreground")}
          title={`Sort by ${text}`}
        >
          {text}
          {active && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      </TableHead>
    );
  };

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <span className="flex items-center gap-2 font-medium">
          <Trophy className="size-4 text-muted-foreground" /> Leaderboard
        </span>
        <span className="caps text-muted-foreground">{games.join(" + ")}</span>
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">{toolbar}</div>}
      {error ? (
        <p className="px-5 py-4 text-sm text-destructive">{error}</p>
      ) : !rows ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Loading the rankings.</p>
      ) : sorted.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No games match. Play one, or change the filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="caps w-8 pl-5 text-muted-foreground">#</TableHead>
              <TableHead className="caps text-muted-foreground">Model</TableHead>
              {header("played", "Played")}
              {columns.map((c) => header(c.metric, c.label, "last:pr-5"))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(([model, metrics], i) => (
              <TableRow key={model}>
                <TableCell className="pl-5 font-mono text-muted-foreground">{i === 0 ? <Trophy className="size-3.5 text-[#ffc53d]" /> : i + 1}</TableCell>
                <TableCell>
                  <ModelName label={label(model)} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{played(metrics)}</TableCell>
                {columns.map((c) => {
                  const mean = metrics.get(c.metric)?.mean;
                  return (
                    <TableCell key={c.metric} className={cn("text-right font-mono tabular-nums last:pr-5", sort.key === c.metric && "text-foreground")}>
                      {mean === undefined ? "" : (c.format ?? ((n) => n.toFixed(2)))(mean)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
