import { useEffect, useState } from "react";
import { api, type ModelInfo, type RankingRow } from "../lib/api.ts";

export type Column = { metric: string; label: string; format?: (mean: number) => string };

/** Per-model ranking for one game, sorted by the first column. Refetches when `refreshKey` changes. */
export function Board({ game, columns, models, refreshKey }: { game: string; columns: Column[]; models: ModelInfo[]; refreshKey?: unknown }) {
  const [rows, setRows] = useState<RankingRow[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.rankings(game).then(setRows, (e: Error) => setError(e.message));
  }, [game, refreshKey]);

  if (error) return <div className="refused">{error}</div>;
  if (!rows) return <div className="muted">loading rankings</div>;

  const byModel = new Map<string, Map<string, RankingRow>>();
  for (const row of rows) {
    if (!byModel.has(row.model)) byModel.set(row.model, new Map());
    byModel.get(row.model)!.set(row.metric, row);
  }
  if (byModel.size === 0) return <div className="muted">no games played yet</div>;

  const first = columns[0]!.metric;
  const sorted = [...byModel.entries()].sort(([, a], [, b]) => (b.get(first)?.mean ?? 0) - (a.get(first)?.mean ?? 0));
  // The voice game scores a model that reads the transcript as "<key> (transcript)".
  const label = (key: string) => {
    const suffix = key.endsWith(" (transcript)") ? " (transcript)" : "";
    const base = key.slice(0, key.length - suffix.length);
    return (models.find((m) => m.key === base)?.label ?? base) + suffix;
  };

  return (
    <table className="board">
      <thead>
        <tr>
          <th>Model</th>
          <th>Played</th>
          {columns.map((c) => (
            <th key={c.metric}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(([model, metrics]) => (
          <tr key={model}>
            <td>{label(model)}</td>
            <td>{metrics.get(first)?.rows ?? 0}</td>
            {columns.map((c) => {
              const mean = metrics.get(c.metric)?.mean;
              return <td key={c.metric}>{mean === undefined ? "" : (c.format ?? ((n) => n.toFixed(2)))(mean)}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
