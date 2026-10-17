// All SQL lives here. Three tables, shared by every game: runs, calls, scores.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonCall, JsonValue, Usage } from "@system-one/ai";

export type CallKind = "decide" | "transcribe" | "generate";

export type CallRecord = {
  runId: string;
  /** Who made the call: the visitor cookie and a hash of the IP address. Unset for calls without a visitor. */
  visitor?: string;
  ipHash?: string;
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

/** One call as the live feed shows it: no visitor, no IP hash, no input or output. */
export type RecentCall = {
  at: string;
  game: string;
  model: string;
  provider: string;
  kind: CallKind;
  latencyMs: number;
  usd: number | null;
  error: string | null;
};

export const statsRanges = ["today", "7d", "30d"] as const;
export type StatsRange = (typeof statsRanges)[number];
/** Call counts, spend, tokens and latency. "aborted" calls were stopped by the page (a newer turn replaced
 * them), so they are not failures. Latency percentiles are over successful calls only. */
export type CallStats = {
  calls: number;
  failed: number;
  aborted: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  p50Ms: number | null;
  p95Ms: number | null;
};
/** The call log, summed for the Stats page. No visitor ids or IP hashes, only counts. */
export type Stats = {
  range: StatsRange;
  since: string;
  /** One bucket per UTC hour for today, else one per UTC day. `at` is the start of the bucket. */
  series: { at: string; calls: number; failed: number; usd: number }[];
  totals: CallStats & { visitors: number; runs: number };
  models: (CallStats & { model: string; provider: string })[];
  games: { game: string; runs: number; calls: number; usd: number }[];
  errors: { code: string; calls: number }[];
};

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

/** Columns added after the first schema. Each runs once, when the column is missing. */
const added: [table: string, column: string, type: string][] = [
  ["runs", "visitor", "TEXT"],
  ["calls", "visitor", "TEXT"],
  ["calls", "ip_hash", "TEXT"],
];

export type Store = ReturnType<typeof openStore>;

/** Opens (and creates) the database. Pass ":memory:" in tests. */
export function openStore(path = process.env.SYSTEM_ONE_DB ?? "data/arcade.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  for (const statement of schema) db.run(statement);
  for (const [table, column, type] of added) {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
    if (!columns.some((c) => c.name === column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.run("CREATE INDEX IF NOT EXISTS calls_visitor ON calls(visitor, started_at)");
  db.run("CREATE INDEX IF NOT EXISTS calls_ip_hash ON calls(ip_hash, started_at)");

  const insertRun = db.query("INSERT INTO runs (id, game, created_at, config, visitor) VALUES ($id, $game, $createdAt, $config, $visitor)");
  const selectRun = db.query<{ id: string; game: string; visitor: string | null }, { id: string }>("SELECT id, game, visitor FROM runs WHERE id = $id");
  const selectScored = db.query<{ n: number }, { runId: string }>("SELECT COUNT(*) AS n FROM scores WHERE run_id = $runId");
  const selectPlayed = db.query<{ model: string }, { runId: string }>("SELECT DISTINCT model FROM calls WHERE run_id = $runId");
  const insertCall = db.query(`INSERT INTO calls
    (id, run_id, kind, provider, model, started_at, latency_ms, input_tokens, output_tokens, cost_usd, cost_source, input, output, error_code, visitor, ip_hash)
    VALUES ($id, $runId, $kind, $provider, $model, $startedAt, $latencyMs, $inputTokens, $outputTokens, $costUsd, $costSource, $input, $output, $errorCode, $visitor, $ipHash)`);
  const selectVisitorSpend = db.query<{ usd: number }, { since: string; visitor: string }>(
    "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE visitor = $visitor AND started_at >= $since",
  );
  const selectIpSpend = db.query<{ usd: number }, { since: string; ipHash: string }>(
    "SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE ip_hash = $ipHash AND started_at >= $since",
  );
  const today = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const insertScore = db.query("INSERT INTO scores (run_id, model, metric, value) VALUES ($runId, $model, $metric, $value)");
  const selectToday = db.query<{ calls: number; usd: number }, { since: string }>(
    "SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE started_at >= $since",
  );
  const selectRecent = db.query<RecentCall, { limit: number }>(`SELECT c.started_at AS at, r.game AS game, c.model AS model, c.provider AS provider,
      c.kind AS kind, c.latency_ms AS latencyMs, c.cost_usd AS usd, c.error_code AS error
    FROM calls c JOIN runs r ON r.id = c.run_id ORDER BY c.started_at DESC LIMIT $limit`);
  const selectSpend = db.query<{ provider: string; usd: number }, { since: string }>(
    "SELECT provider, COALESCE(SUM(cost_usd), 0) AS usd FROM calls WHERE started_at >= $since GROUP BY provider",
  );

  return {
    createRun(game: string, config: JsonValue, visitor: string | null = null): string {
      const id = crypto.randomUUID();
      insertRun.run({ id, game, createdAt: new Date().toISOString(), config: JSON.stringify(config), visitor });
      return id;
    },

    hasRun(id: string): boolean {
      return selectRun.get({ id }) !== null;
    },

    /** The game the run belongs to, for example "plane-realtime". */
    runGame(id: string): string | null {
      return selectRun.get({ id })?.game ?? null;
    },

    /** The visitor that created the run, or null for runs made without one. */
    runOwner(id: string): string | null {
      return selectRun.get({ id })?.visitor ?? null;
    },

    hasScores(runId: string): boolean {
      return (selectScored.get({ runId })?.n ?? 0) > 0;
    },

    /** The models that made at least one call in the run, failed calls included (a model that only failed still played). */
    playedIn(runId: string): Set<string> {
      return new Set(selectPlayed.all({ runId }).map((r) => r.model));
    },

    /** Today's spend of one visitor, and of one IP hash. */
    shareToday(who: { visitor: string; ipHash: string }, now = new Date()): { visitor: number; ip: number } {
      const since = today(now);
      return {
        visitor: selectVisitorSpend.get({ since, visitor: who.visitor })?.usd ?? 0,
        ip: selectIpSpend.get({ since, ipHash: who.ipHash })?.usd ?? 0,
      };
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
        visitor: call.visitor ?? null,
        ipHash: call.ipHash ?? null,
      });
    },

    addScores(runId: string, scores: readonly Score[]): void {
      db.transaction(() => {
        for (const s of scores) insertScore.run({ runId, ...s });
      })();
    },

    /** The calls and their cost since 00:00 UTC today. */
    todayTotals(now = new Date()): { calls: number; usd: number } {
      return selectToday.get({ since: today(now) }) ?? { calls: 0, usd: 0 };
    },

    /** The newest calls, oldest first, with the game of their run. For the live feed. */
    recentCalls(limit: number): RecentCall[] {
      return selectRecent.all({ limit }).reverse();
    },

    /** Spend since 00:00 UTC today. */
    spendToday(now = new Date()): Spend {
      const since = today(now);
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

    /** The call log since 00:00 UTC today, or over the last 7 or 30 days (today included). */
    stats(range: StatsRange, now = new Date()): Stats {
      const days = { today: 1, "7d": 7, "30d": 30 }[range];
      const start = new Date(today(now));
      start.setUTCDate(start.getUTCDate() - (days - 1));
      const since = start.toISOString();
      const hourly = range === "today";
      // The bucket key is a prefix of started_at: "2026-10-17T05" for an hour, "2026-10-17" for a day.
      const width = hourly ? 13 : 10;
      const counts = `COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE error_code IS NOT NULL AND error_code != 'aborted') AS failed,
        COALESCE(SUM(cost_usd), 0) AS usd`;

      type Bucket = { at: string; calls: number; failed: number; usd: number };
      const buckets = new Map(
        db
          .query<Bucket, { since: string }>(`SELECT substr(started_at, 1, ${width}) AS at, ${counts} FROM calls WHERE started_at >= $since GROUP BY at`)
          .all({ since })
          .map((row) => [row.at, row]),
      );
      const step = hourly ? 3_600_000 : 86_400_000;
      const series = Array.from({ length: hourly ? 24 : days }, (_, i) => {
        const at = new Date(start.getTime() + i * step).toISOString();
        const row = buckets.get(at.slice(0, width));
        return { at, calls: row?.calls ?? 0, failed: row?.failed ?? 0, usd: row?.usd ?? 0 };
      });

      type ModelRow = Omit<CallStats, "p50Ms" | "p95Ms"> & { model: string; provider: string };
      const rows = db
        .query<ModelRow, { since: string }>(`SELECT model, provider, ${counts},
            COUNT(*) FILTER (WHERE error_code = 'aborted') AS aborted,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens
          FROM calls WHERE started_at >= $since GROUP BY model, provider ORDER BY calls DESC, model`)
        .all({ since });
      const latencies = db
        .query<{ model: string; ms: number }, { since: string }>("SELECT model, latency_ms AS ms FROM calls WHERE started_at >= $since AND error_code IS NULL")
        .all({ since });
      const byModel = Map.groupBy(latencies, (row) => row.model);
      const models = rows.map((row) => ({ ...row, ...percentiles((byModel.get(row.model) ?? []).map((r) => r.ms)) }));

      const people = db
        .query<{ visitors: number; runs: number }, { since: string }>(
          "SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT run_id) AS runs FROM calls WHERE started_at >= $since",
        )
        .get({ since });
      const sum = (key: "calls" | "failed" | "aborted" | "usd" | "inputTokens" | "outputTokens") => rows.reduce((total, row) => total + row[key], 0);
      const totals = {
        calls: sum("calls"),
        failed: sum("failed"),
        aborted: sum("aborted"),
        usd: sum("usd"),
        inputTokens: sum("inputTokens"),
        outputTokens: sum("outputTokens"),
        ...percentiles(latencies.map((r) => r.ms)),
        visitors: people?.visitors ?? 0,
        runs: people?.runs ?? 0,
      };

      const games = db
        .query<Stats["games"][number], { since: string }>(`SELECT r.game AS game, COUNT(DISTINCT c.run_id) AS runs, COUNT(*) AS calls,
            COALESCE(SUM(c.cost_usd), 0) AS usd
          FROM calls c JOIN runs r ON r.id = c.run_id WHERE c.started_at >= $since GROUP BY r.game ORDER BY calls DESC, game`)
        .all({ since });
      const errors = db
        .query<Stats["errors"][number], { since: string }>(`SELECT error_code AS code, COUNT(*) AS calls
          FROM calls WHERE started_at >= $since AND error_code IS NOT NULL GROUP BY error_code ORDER BY calls DESC, code`)
        .all({ since });

      return { range, since, series, totals, models, games, errors };
    },

    close(): void {
      db.close();
    },
  };
}

/** The median and the 95th percentile (nearest rank), or null without values. */
function percentiles(values: number[]): { p50Ms: number | null; p95Ms: number | null } {
  if (values.length === 0) return { p50Ms: null, p95Ms: null };
  const sorted = values.toSorted((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { p50Ms: rank(0.5), p95Ms: rank(0.95) };
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
