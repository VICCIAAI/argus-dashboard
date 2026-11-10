import { cookies } from "next/headers";
import { configuredNodes, type NodeConfig } from "@/lib/nodes";
import { sessionCookieName } from "@/lib/nodeSessions";
import {
  latestNotes,
  readHistory,
  readNotes,
  serialized,
  writeHistory,
} from "@/lib/fl/store";
import type {
  FitLog,
  FlowerConfig,
  GateResult,
  GlobalLog,
  HistoryFile,
  NodeRun,
  OperatorNote,
  RunRecord,
  SamplesResponse,
  SampleStats,
  ServerRound,
  TestMeasurement,
} from "@/lib/fl/types";

// Reads what the nodes and the aggregator report and copies it to disk.
// Server-only, and GET-only toward every node and the aggregator: nothing
// in this file can start a round or write a label.

export const FLOWER_API =
  process.env.ARGUS_FLOWER_API?.replace(/\/+$/, "") ?? "http://localhost:8090";

export interface Fetched<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function getJson<T>(
  url: string,
  token: string | null,
  timeoutMs: number,
): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.name : "unreachable",
    };
  }
}

/** Node name to its session token, for the nodes this browser signed in to. */
export async function nodeTokens(): Promise<Map<string, string | null>> {
  const jar = await cookies();
  return new Map(
    configuredNodes().map((node) => [
      node.id,
      jar.get(sessionCookieName(node.id))?.value ?? null,
    ]),
  );
}

interface NodeRoundStatus {
  running: boolean;
  exit_code: number | null;
  started: number | null;
  run_dir: string | null;
  result: GateResult | null;
  log: string[];
  human_only?: boolean;
}

interface NodeHead {
  model: { label: string; last_decision: GateResult | null };
}

interface NodeStatus {
  node?: string;
  model_version?: string;
  samples?: SampleStats | null;
}

interface EventRow {
  id: number;
  status: string;
  confirmed: number;
}

type RawServerRound = Omit<ServerRound, "key">;

const JOIN_WINDOW_S = 10 * 60;
const ROUND_WINDOW_S = 40 * 60;

function runIdFor(startedSeconds: number): string {
  const iso = new Date(startedSeconds * 1000).toISOString();
  return `run-${iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}`;
}

function parseLog(log: string[]) {
  const fits: FitLog[] = [];
  const globals: GlobalLog[] = [];
  let trainSamples: number | undefined;
  let valSamples: number | undefined;
  let humanOnly: boolean | undefined;
  let labelsReviewed: number | undefined;
  let labelsMachine: number | undefined;
  for (const line of log) {
    if (!line.startsWith("{")) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.kind === "ready") {
        trainSamples = entry.train;
        valSamples = entry.val;
        humanOnly = entry.human_only;
        labelsReviewed = entry.labels_reviewed;
        labelsMachine = entry.labels_machine;
      } else if (entry.kind === "fit") fits.push(entry);
      else if (entry.kind === "global") globals.push(entry);
    } catch {
      // Flower's own log lines are mixed in; only ours are JSON.
    }
  }
  return {
    fits,
    globals,
    trainSamples,
    valSamples,
    humanOnly,
    labelsReviewed,
    labelsMachine,
  };
}

function runContaining(history: HistoryFile, seconds: number, window: number) {
  return history.runs.find((run) => Math.abs(run.startedAt - seconds) <= window);
}

function ensureRun(history: HistoryFile, started: number): RunRecord {
  const found = runContaining(history, started, JOIN_WINDOW_S);
  if (found) return found;
  const run: RunRecord = {
    id: runIdFor(started),
    startedAt: started,
    nodes: [],
    serverRounds: [],
  };
  history.runs.push(run);
  history.runs.sort((a, b) => a.startedAt - b.startedAt);
  return run;
}

/** Comparable form of a record, whatever order its keys were set in. */
function canonical(run: NodeRun): string {
  return JSON.stringify(
    Object.entries({ ...run, capturedAt: 0 })
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Copy one node's latest round. Returns true if the file should be saved. */
function mergeNode(
  history: HistoryFile,
  node: NodeConfig,
  round: NodeRoundStatus,
  head: NodeHead | undefined,
  status: NodeStatus | undefined,
): boolean {
  if (!round.started || !round.run_dir) return false;
  const started = round.started;
  const run = ensureRun(history, started);
  const existing = run.nodes.find(
    (item) => item.nodeId === node.id && item.runDir === round.run_dir,
  );

  // The node forgets `result` if it restarts mid-run; the last decision on
  // disk survives, so it stands in when it is plainly from this round.
  const decision = head?.model.last_decision;
  const result =
    round.result ??
    (decision?.at && decision.at >= started ? decision : null) ??
    existing?.result ??
    null;

  const parsed = parseLog(round.log);
  const next: NodeRun = {
    nodeId: node.id,
    nodeName: node.name,
    reportedName: status?.node ?? existing?.reportedName,
    started,
    runDir: round.run_dir,
    running: round.running,
    exitCode: round.exit_code,
    trainSamples: parsed.trainSamples ?? existing?.trainSamples,
    valSamples: parsed.valSamples ?? existing?.valSamples,
    humanOnly: parsed.humanOnly ?? round.human_only ?? existing?.humanOnly,
    labelsReviewed: parsed.labelsReviewed ?? existing?.labelsReviewed,
    labelsMachine: parsed.labelsMachine ?? existing?.labelsMachine,
    fits: parsed.fits.length ? parsed.fits : (existing?.fits ?? []),
    globals: parsed.globals.length ? parsed.globals : (existing?.globals ?? []),
    result,
    syntheticRows: existing?.syntheticRows,
    capturedAt: existing?.capturedAt ?? Date.now() / 1000,
  };

  if (existing) {
    if (canonical(existing) === canonical(next)) return false;
    Object.assign(existing, next);
    return true;
  }
  run.nodes.push(next);
  return true;
}

function mergeServerRounds(
  history: HistoryFile,
  rounds: RawServerRound[],
  config: FlowerConfig | undefined,
): boolean {
  let changed = false;
  const seen = new Set(
    history.runs.flatMap((run) => run.serverRounds.map((round) => round.key)),
  );

  for (const raw of rounds) {
    // The aggregator restarts its round counter each session, so the
    // timestamp is what makes a round unique.
    const key = `${raw.timestamp}#${raw.round_num}`;
    if (seen.has(key)) continue;
    const finished = Date.parse(raw.timestamp) / 1000;
    const started = finished - raw.duration_seconds;
    const run =
      history.runs.find(
        (item) =>
          finished >= item.startedAt - 60 &&
          finished <= item.startedAt + ROUND_WINDOW_S,
      ) ?? ensureRun(history, started);
    run.serverRounds.push({ ...raw, key });
    run.serverRounds.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (config && !run.serverConfig) run.serverConfig = config;
    changed = true;
  }
  return changed;
}

function testItems(notes: OperatorNote[]) {
  return [...latestNotes(notes).values()].filter((note) => note.kind === "test");
}

/**
 * Score a node's live head on its frozen test set.
 *
 * These events are labelled only on the console, so they are unlabelled on
 * the node: no round can train on them, and GET /api/events returns the
 * live head's own call for them. `status` is "stranger" when the head says
 * anomaly. Read-only on the node.
 */
export async function measureNode(
  history: HistoryFile,
  node: NodeConfig,
  token: string | null,
  modelVersion: string,
  total: number,
): Promise<TestMeasurement | string> {
  const items = testItems(await readNotes(node.id));
  if (items.length === 0) return "No test set labelled";

  const events = await getJson<EventRow[]>(
    `${node.baseUrl}/api/events?limit=${Math.max(total, 50) + 20}`,
    token,
    30_000,
  );
  if (!events.ok || !events.data) {
    return `${node.name}: could not read events (${events.error})`;
  }

  const byId = new Map(events.data.map((event) => [event.id, event]));
  const measurement: TestMeasurement = {
    node: node.id,
    at: Date.now() / 1000,
    modelVersion,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    contaminated: 0,
    missing: 0,
  };

  for (const item of items) {
    const event = byId.get(item.n);
    if (!event) {
      measurement.missing += 1;
      continue;
    }
    if (event.confirmed) {
      measurement.contaminated += 1;
      continue;
    }
    const truth = item.label === "anomaly";
    const called = event.status === "stranger";
    if (truth && called) measurement.tp += 1;
    else if (truth) measurement.fn += 1;
    else if (called) measurement.fp += 1;
    else measurement.tn += 1;
  }

  history.measurements.push(measurement);
  return measurement;
}

/** Pull everything new and save it. Safe to call on every page poll. */
export async function capture(): Promise<{
  history: HistoryFile;
  errors: string[];
}> {
  const tokens = await nodeTokens();

  return serialized(async () => {
    const history = await readHistory();
    const errors: string[] = [];
    let changed = false;

    const [flower, config] = await Promise.all([
      getJson<RawServerRound[]>(
        `${FLOWER_API}/api/training/history?limit=500`,
        null,
        4_000,
      ),
      getJson<FlowerConfig>(`${FLOWER_API}/api/config`, null, 4_000),
    ]);
    if (!flower.ok) errors.push(`Flower server: ${flower.error}`);

    await Promise.all(
      configuredNodes().map(async (node) => {
        const token = tokens.get(node.id) ?? null;
        const [round, head, status] = await Promise.all([
          getJson<NodeRoundStatus>(
            `${node.baseUrl}/api/federated/round`,
            token,
            6_000,
          ),
          getJson<NodeHead>(`${node.baseUrl}/api/federated/head`, token, 6_000),
          getJson<NodeStatus>(`${node.baseUrl}/api/status`, token, 6_000),
        ]);

        if (!round.ok || !round.data) {
          errors.push(`${node.name}: ${round.error}`);
          return;
        }
        if (mergeNode(history, node, round.data, head.data, status.data)) {
          changed = true;
        }

        // Training does not filter synthetic rows, so a finished run records
        // whether the node had any. Real-data views then leave it out.
        const nodeRun = history.runs
          .flatMap((run) => run.nodes)
          .find(
            (item) =>
              item.nodeId === node.id && item.runDir === round.data?.run_dir,
          );
        const total = status.data?.samples?.total;
        if (
          nodeRun &&
          nodeRun.syntheticRows === undefined &&
          !round.data.running &&
          total !== undefined
        ) {
          const rows = await getJson<SamplesResponse>(
            `${node.baseUrl}/api/federated/samples?limit=${total + 50}`,
            token,
            30_000,
          );
          if (rows.data) {
            nodeRun.syntheticRows = rows.data.samples.filter(
              (row) => row.meta?.synthetic,
            ).length;
            changed = true;
          }
        }

        // A new model on a frozen test set gets scored once, automatically,
        // so a round's result cannot go unmeasured.
        const frozen = history.testSets[node.id]?.frozenAt;
        const version = status.data?.model_version;
        if (
          frozen &&
          version &&
          !round.data.running &&
          !history.measurements.some(
            (item) => item.node === node.id && item.modelVersion === version,
          )
        ) {
          const outcome = await measureNode(
            history,
            node,
            token,
            version,
            status.data?.samples?.total ?? 0,
          );
          if (typeof outcome === "string") errors.push(outcome);
          else changed = true;
        }
      }),
    );

    if (flower.ok && flower.data) {
      if (mergeServerRounds(history, flower.data, config.data)) changed = true;
    }

    if (changed) await writeHistory(history);
    return { history, errors };
  });
}
