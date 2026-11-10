import { execFile } from "child_process";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { promisify } from "util";
import { FLOWER_API, getJson, nodeTokens } from "@/lib/fl/capture";
import { latestNotes, readHistory, readNotes } from "@/lib/fl/store";
import {
  MIN_LABELS_PER_NODE,
  type DetectorQuality,
  type FlowerConfig,
  type PreflightCheck,
  type PreflightNode,
  type PreflightResponse,
  type PreflightServer,
  type Sample,
  type SamplesResponse,
  type SampleStats,
} from "@/lib/fl/types";
import { isSessionCookie } from "@/lib/nodeSessions";
import { configuredNodes, type NodeConfig } from "@/lib/nodes";

// Pre-flight for a federated round: reads real state, starts nothing.
// Every call out of this file is a GET to a node or the aggregator.

export const dynamic = "force-dynamic";

const run = promisify(execFile);

// No API reports flwr, so these came from a shell on each machine. Shown
// as hand-checked and dated, never as a live reading.
const FLWR_CHECKED_ON = "2026-11-09";
const FLWR_BY_NODE: Record<string, string> = {
  "Node A": "1.43.0",
  "Node C": "1.42.0",
};
const FLWR_SERVER = "1.43.0";

interface StatusBody {
  node?: string;
  accelerator?: string;
  model_version?: string;
  samples?: SampleStats | null;
}

interface RoundBody {
  running: boolean;
}

interface SchedulerBody {
  enabled: boolean;
  running?: boolean;
  server?: string;
  next_due_at?: string;
}

interface RowSummary {
  real: Sample[];
  synthetic: number;
}

// A full read of a Pi's store is the heaviest GET this console makes, so
// its answer is reused for a few minutes while the node's labelled count
// stays the same.
const rowCache = new Map<
  string,
  { at: number; labelled: number; reviewed: number; rows: RowSummary }
>();
const ROW_CACHE_MS = 5 * 60_000;

async function readRows(
  node: NodeConfig,
  token: string | null,
  stats: SampleStats,
): Promise<RowSummary | null> {
  const cached = rowCache.get(node.id);
  if (
    cached &&
    cached.labelled === stats.labelled &&
    // Reviewing a machine label changes neither count of labels.
    cached.reviewed === (stats.provenance?.reviewed ?? 0) &&
    Date.now() - cached.at < ROW_CACHE_MS
  ) {
    return cached.rows;
  }
  const res = await getJson<SamplesResponse>(
    `${node.baseUrl}/api/federated/samples?limit=${stats.total + 50}`,
    token,
    30_000,
  );
  if (!res.ok || !res.data) return cached?.rows ?? null;
  const rows: RowSummary = {
    real: res.data.samples.filter((row) => !row.meta?.synthetic),
    synthetic: res.data.samples.filter((row) => row.meta?.synthetic).length,
  };
  rowCache.set(node.id, {
    at: Date.now(),
    labelled: stats.labelled,
    reviewed: stats.provenance?.reviewed ?? 0,
    rows,
  });
  return rows;
}

function detectorQuality(
  rows: Sample[],
  notObject: number,
  testRoutine: { detector?: string; label?: string }[],
): DetectorQuality {
  const byClass: DetectorQuality["byClass"] = {};
  const count = (detector: string, label: string) => {
    // An anomaly label says nothing about whether the class was right.
    if (!label.startsWith("routine_")) return;
    const entry = (byClass[detector] ??= { confirmed: 0, corrected: 0 });
    if (label === `routine_${detector}`) entry.confirmed += 1;
    else entry.corrected += 1;
  };
  for (const row of rows) {
    if (row.label) count(row.features.class, row.label);
  }
  for (const note of testRoutine) {
    if (note.detector && note.label) count(note.detector, note.label);
  }
  return { byClass, notObject };
}

async function readNode(
  node: NodeConfig,
  token: string | null,
  frozenAt: number | null,
): Promise<PreflightNode> {
  const notes = latestNotes(await readNotes(node.id));
  const noteList = [...notes.values()];
  const test = noteList.filter((note) => note.kind === "test");
  const testSet = {
    size: test.length,
    anomalies: test.filter((note) => note.label === "anomaly").length,
    frozenAt,
  };
  const base: PreflightNode = {
    id: node.id,
    name: node.name,
    online: false,
    needsSignIn: false,
    realLabelled: null,
    realAnomalies: null,
    labelsReviewed: null,
    labelsMachine: null,
    reviewedAnomalies: null,
    provenanceReported: null,
    syntheticRows: null,
    flwrHandChecked: FLWR_BY_NODE[node.name]
      ? `${FLWR_BY_NODE[node.name]} (hand-checked ${FLWR_CHECKED_ON})`
      : null,
    detector: null,
    testSet,
  };

  const status = await getJson<StatusBody>(
    `${node.baseUrl}/api/status`,
    token,
    6_000,
  );
  if (!status.ok || !status.data) {
    return {
      ...base,
      needsSignIn: status.status === 401,
      error:
        status.status === 401 ? "Sign-in needed on this node" : `No answer (${status.error})`,
    };
  }

  const stats = status.data.samples ?? null;
  const [round, scheduler, rows] = await Promise.all([
    getJson<RoundBody>(`${node.baseUrl}/api/federated/round`, token, 6_000),
    getJson<SchedulerBody>(`${node.baseUrl}/api/federated/status`, token, 6_000),
    stats ? readRows(node, token, stats) : Promise.resolve(null),
  ]);

  const labelled = rows?.real.filter((row) => row.label !== null) ?? null;
  // No provenance on a row means machine: today's labels were rule-derived.
  const reviewed = labelled?.filter((row) => row.provenance?.reviewed === true) ?? null;
  return {
    ...base,
    online: true,
    reportedName: status.data.node,
    accelerator: status.data.accelerator,
    modelVersion: status.data.model_version,
    total: stats?.total,
    labelledOnNode: stats?.labelled,
    perLabel: stats?.per_label,
    realLabelled: labelled ? labelled.length : null,
    realAnomalies: labelled
      ? labelled.filter((row) => row.label === "anomaly").length
      : null,
    labelsReviewed: reviewed ? reviewed.length : null,
    labelsMachine: labelled && reviewed ? labelled.length - reviewed.length : null,
    reviewedAnomalies: reviewed
      ? reviewed.filter((row) => row.label === "anomaly").length
      : null,
    provenanceReported: stats ? stats.provenance !== undefined : null,
    syntheticRows: rows ? rows.synthetic : null,
    roundRunning: round.data?.running,
    scheduler: scheduler.data
      ? {
          enabled: scheduler.data.enabled,
          server: scheduler.data.server,
          nextDueAt: scheduler.data.next_due_at,
        }
      : undefined,
    detector: rows
      ? detectorQuality(
          rows.real,
          noteList.filter((note) => note.kind === "not_object").length,
          test,
        )
      : null,
  };
}

/** Established TCP peers on :8080. The aggregator's own count stays 0 until a round ends. */
async function establishedOn8080(): Promise<number | null> {
  try {
    const { stdout } = await run("netstat", ["-an", "-p", "TCP"], {
      timeout: 4_000,
      windowsHide: true,
    });
    const peers = new Set<string>();
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[3] !== "ESTABLISHED" || !parts[1]?.endsWith(":8080")) continue;
      peers.add(parts[2].slice(0, parts[2].lastIndexOf(":")));
    }
    return peers.size;
  } catch {
    return null;
  }
}

async function readServer(): Promise<PreflightServer> {
  const [status, config, established] = await Promise.all([
    getJson<PreflightServer["status"]>(`${FLOWER_API}/api/status`, null, 4_000),
    getJson<FlowerConfig>(`${FLOWER_API}/api/config`, null, 4_000),
    establishedOn8080(),
  ]);
  return {
    up: status.ok,
    error: status.ok ? undefined : status.error,
    status: status.data,
    config: config.data,
    establishedClients: established,
    flwrHandChecked: `${FLWR_SERVER} (hand-checked ${FLWR_CHECKED_ON})`,
  };
}

function evaluate(
  nodes: PreflightNode[],
  server: PreflightServer,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (level: PreflightCheck["level"], text: string) =>
    checks.push({ level, text });

  if (!server.up) add("blocker", "Flower server is not answering on its REST port.");

  for (const node of nodes) {
    if (!node.online) {
      add("blocker", `${node.name}: ${node.error ?? "offline"}.`);
      continue;
    }
    if (node.realLabelled === null) {
      add("blocker", `${node.name}: could not read its rows, so real labels are unconfirmed.`);
    } else if (node.realLabelled < MIN_LABELS_PER_NODE) {
      add(
        "blocker",
        `${node.name}: ${node.realLabelled} of ${MIN_LABELS_PER_NODE} real labels.`,
      );
    }
    if (node.provenanceReported === false) {
      add(
        "warning",
        `${node.name}: runs code that predates label provenance, so all of its labels count as machine.`,
      );
    }
    if (node.labelsReviewed !== null && node.labelsReviewed < MIN_LABELS_PER_NODE) {
      add(
        "warning",
        `${node.name}: ${node.labelsReviewed} of ${MIN_LABELS_PER_NODE} human-reviewed labels. A round on machine labels is a pipeline test, not evidence.`,
      );
    }
    if (node.syntheticRows) {
      add(
        "blocker",
        `${node.name}: ${node.syntheticRows} synthetic rows in its store. Training does not filter them out.`,
      );
    }
    if (node.realLabelled !== null && node.realAnomalies === 0) {
      add("warning", `${node.name}: no anomalies labelled, so the gate cannot measure anomaly recall.`);
    }
    if ((node.total ?? 0) < MIN_LABELS_PER_NODE) {
      add(
        "warning",
        `${node.name}: only ${node.total ?? 0} events recorded, fewer than the ${MIN_LABELS_PER_NODE} it needs labelled.`,
      );
    }
    if (node.roundRunning) add("blocker", `${node.name}: a round is already running.`);
    if (node.scheduler?.enabled) {
      add(
        "warning",
        `${node.name}: scheduled round armed${node.scheduler.nextDueAt ? ` for ${node.scheduler.nextDueAt}` : ""}, pointing at ${node.scheduler.server ?? "an unknown server"}.`,
      );
    }
    if (!node.flwrHandChecked) {
      add("warning", `${node.name}: flwr version not checked.`);
    }
    if (!node.testSet.frozenAt) {
      add(
        "blocker",
        `${node.name}: test set not frozen, so round 1 would have no baseline to compare with.`,
      );
    }
  }

  const reported = nodes.flatMap((node) => (node.reportedName ? [node.reportedName] : []));
  const duplicate = reported.filter((name, i) => reported.indexOf(name) !== i);
  if (duplicate.length > 0) {
    add(
      "warning",
      `Two nodes report the name ${duplicate[0]}. The server log will show ${duplicate[0]}#1 and cannot say which Pi it was.`,
    );
  }

  const min = server.config?.min_clients;
  if (min !== undefined && min !== nodes.length) {
    add("warning", `Server waits for ${min} clients; this console has ${nodes.length} nodes.`);
  }

  return checks;
}

export async function GET() {
  const jar = await cookies();
  if (!jar.getAll().some((cookie) => isSessionCookie(cookie.name))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [tokens, history] = await Promise.all([nodeTokens(), readHistory()]);
  const [nodes, server] = await Promise.all([
    Promise.all(
      configuredNodes().map((node) =>
        readNode(
          node,
          tokens.get(node.id) ?? null,
          history.testSets[node.id]?.frozenAt ?? null,
        ),
      ),
    ),
    readServer(),
  ]);

  const body: PreflightResponse = {
    checkedAt: Date.now() / 1000,
    nodes,
    server,
    checks: evaluate(nodes, server),
  };
  return NextResponse.json(body);
}
