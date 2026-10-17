// All SQL lives here. Three tables, shared by every game: runs, calls, scores.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonCall, JsonValue, Usage } from "@system-one/ai";

export type CallKind = "decide" | "transcribe" | "generate";

export type CallRecord = {
  runId: string;
  kind: CallKind;
  provider: string;
  /** The registry key, for example "cloudflare:clef-flash". */
  model: string;
  startedAt: Date;
  latencyMs: number;
  usage: Usage | undefined;
  input: unknown;
  output: unknown;
  errorCode?: string;
};

export type Score = { model: string; metric: string; value: number };
export type RankingRow = { model: string; metric: string; rows: number; mean: number; sum: number };
export type Spend = { total: number; byProvider: Record<string, number> };

const schema = [
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    created_at TEXT NOT NULL,
    config TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    started_at TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    cost_source TEXT,
    input TEXT,
    output TEXT,
    error_code TEXT
  )`,
  // One row per agent and metric, so a model that plays twice in a run has two rows.
  `CREATE TABLE IF NOT EXISTS scores (
    run_id TEXT NOT NULL REFERENCES runs(id),
    model TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS calls_started_at ON calls(started_at)",
  "CREATE INDEX IF NOT EXISTS scores_run_id ON scores(run_id)",
  "CREATE INDEX IF NOT EXISTS runs_game ON runs(game)",
];

export type Store = ReturnType<typeof openStore>;

/** Opens (and creates) the database. Pass ":memory:" in tests. */
export function openStore(path = process.env.SYSTEM_ONE_DB ?? "data/arcade.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  for (const statement of schema) db.run(statement);

  const insertRun = db.query("INSERT INTO runs (id, game, created_at, config) VALUES ($id, $game, $createdAt, $config)");
  const selectRun = db.query<{ id: string }, { id: string }>("SELECT id FROM runs WHERE id = $id");
  const insertCall = db.query(`INSERT INTO calls
    (id, run_id, kind, provider, model, started_at, latency_ms, input_tokens, output_tokens, cost_usd, cost_source, input, output, error_code)
    VALUES ($id, $runId, $kind, $provider, $model, $startedAt, $latencyMs, $inputTokens, $outputTokens, $costUsd, $costSource, $input, $output, $errorCode)`);
  const insertScore = db.query("INSERT INTO scores (run_id, model, metric, value) VALUES ($runId, $model, $metric, $value)");
  const selectSpend = db.query<{ provider: string; usd: number }, { since: string }>(
    "SELECT provider, COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE started_at >= $since GROUP BY provider",
  );

  return {
    createRun(game: string, config: JsonValue): string {
      const id = crypto.randomUUID();
      insertRun.run({ id, game, createdAt: new Date().toISOString(), config: JSON.stringify(config) });
      return id;
    },

    hasRun(id: string): boolean {
      return selectRun.get({ id }) !== null;
    },

    recordCall(call: CallRecord): void {
      insertCall.run({
        id: crypto.randomUUID(),
        runId: call.runId,
        kind: call.kind,
        provider: call.provider,
        model: call.model,
        startedAt: call.startedAt.toISOString(),
        latencyMs: Math.round(call.latencyMs),
        inputTokens: call.usage?.inputTokens ?? null,
        outputTokens: call.usage?.outputTokens ?? null,
        costUsd: call.usage?.costUsd ?? null,
        costSource: call.usage?.costSource ?? null,
        input: JSON.stringify(call.input ?? null),
        output: JSON.stringify(call.output ?? null),
        errorCode: call.errorCode ?? null,
      });
    },

    addScores(runId: string, scores: readonly Score[]): void {
      db.transaction(() => {
        for (const s of scores) insertScore.run({ runId, ...s });
      })();
    },

    /** Spend since 00:00 UTC today. */
    spendToday(now = new Date()): Spend {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const byProvider = Object.fromEntries(selectSpend.all({ since }).map((r) => [r.provider, r.usd]));
      return { total: Object.values(byProvider).reduce((a, b) => a + b, 0), byProvider };
    },

    /**
     * One row per model and metric, over all runs of the games. `config` keeps only the runs whose config
     * has these values, for example { policy: "top" }. Keys must be plain words: they go into the SQL.
     */
    ranking(games: string | string[], config: Record<string, string> = {}): RankingRow[] {
      const list = typeof games === "string" ? [games] : games;
      const keys = Object.keys(config);
      if (list.length === 0) return [];
      if (keys.some((key) => !/^[a-z_]{1,40}$/.test(key))) throw new Error("config keys must be plain words");
      const where = [
        `r.game IN (${list.map((_, i) => `$g${i}`).join(", ")})`,
        ...keys.map((key, i) => `json_extract(r.config, '$.${key}') = $c${i}`),
      ];
      const params = { ...Object.fromEntries(list.map((g, i) => [`g${i}`, g])), ...Object.fromEntries(keys.map((key, i) => [`c${i}`, config[key]!])) };
      return db
        .query<RankingRow, Record<string, string>>(`SELECT s.model AS model, s.metric AS metric,
            COUNT(*) AS rows, AVG(s.value) AS mean, SUM(s.value) AS sum
          FROM scores s JOIN runs r ON r.id = s.run_id
          WHERE ${where.join(" AND ")}
          GROUP BY s.model, s.metric
          ORDER BY s.model, s.metric`)
        .all(params);
    },

    close(): void {
      db.close();
    },
  };
}

/** Replaces image and audio data in a JSON call with a hash and a size, so the database keeps no media. */
export function redact(call: JsonCall): JsonCall {
  if (!Array.isArray(call.state)) return call;
  const state = call.state.map((part) => {
    if (typeof part !== "object" || part === null || Array.isArray(part)) return part;
    for (const key of ["$image", "$audio"] as const) {
      const dataUrl = part[key];
      if (typeof dataUrl === "string") return { [key]: fingerprint(dataUrl) };
    }
    return part;
  });
  return { ...call, state };
}

export function fingerprint(dataUrl: string): { sha256: string; bytes: number } {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return {
    sha256: new Bun.CryptoHasher("sha256").update(dataUrl).digest("hex"),
    bytes: Math.floor((base64.length * 3) / 4),
  };
}
