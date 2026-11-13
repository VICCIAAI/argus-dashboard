import type { LedgerEntry, ReviewerStats, StagingSession, SwipeSettings } from "@/lib/swipe/types";
import type { ScoreRow } from "@/lib/swipe/queue";

// Browser-side calls for the swipe page. Node calls go through the
// /api/argus proxy like every other page.

function nodeQuery(nodeId: string, extra: Record<string, string | number | null> = {}) {
  const params = new URLSearchParams({ node: nodeId });
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null) params.set(key, String(value));
  }
  return params.toString();
}

export interface ScoresResponse {
  model: string | null;
  count: number;
  scores: ScoreRow[];
}

/** Null when the node runs code without the scores route. */
export async function fetchScores(
  nodeId: string,
  since: number | null,
  until: number | null,
): Promise<ScoresResponse | null> {
  try {
    const res = await fetch(
      `/api/argus/federated/scores?${nodeQuery(nodeId, { since, until })}`,
      { cache: "no-store", signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as ScoresResponse;
  } catch {
    return null;
  }
}

export interface AutoLabelResult {
  labelled: number;
  considered: number;
  threshold: number;
  source: string;
  dry_run: boolean;
  model: string | null;
  reason?: string;
}

export async function autoLabel(
  nodeId: string,
  body: {
    threshold: number;
    exclude: number[];
    since: number | null;
    until: number | null;
    dry_run: boolean;
  },
): Promise<AutoLabelResult> {
  const res = await fetch(`/api/argus/federated/autolabel?${nodeQuery(nodeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Auto-label failed (${res.status})`);
  return (await res.json()) as AutoLabelResult;
}

/** The node's own record of one event, for its clip. Null on failure. */
export async function fetchEventClip(nodeId: string, n: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/argus/events/${n}?${nodeQuery(nodeId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { clip?: string | null };
    return body.clip ? `/api/argus/events/${n}/clip?${nodeQuery(nodeId)}` : null;
  } catch {
    return null;
  }
}

export interface SwipeServerState {
  settings: SwipeSettings;
  staging: StagingSession[];
  stats: ReviewerStats | null;
  decided: { n: number; label: string | null; at: number; source: string }[];
}

export async function fetchSwipeState(
  nodeId: string | null,
  reviewer: string,
): Promise<SwipeServerState> {
  const params = new URLSearchParams({ reviewer });
  if (nodeId) params.set("node", nodeId);
  const res = await fetch(`/api/swipe?${params}`, { cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`swipe state ${res.status}`), { status: res.status });
  return (await res.json()) as SwipeServerState;
}

export async function saveSettings(patch: Partial<SwipeSettings>): Promise<SwipeSettings> {
  const res = await fetch("/api/swipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Could not save settings (${res.status})`);
  return ((await res.json()) as { settings: SwipeSettings }).settings;
}

export async function appendLedger(entries: Omit<LedgerEntry, "at">[], keepalive = false) {
  const res = await fetch("/api/swipe/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
    keepalive,
  });
  if (!res.ok) throw new Error(`Could not record swipe (${res.status})`);
}

export async function stagingAction(body: {
  node: string;
  action: "start" | "stop" | "tagged";
  by?: string;
  session?: string;
  tagged?: number[];
}): Promise<StagingSession | null> {
  const res = await fetch("/api/swipe/staging", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Staging ${body.action} failed (${res.status})`);
  return ((await res.json()) as { session: StagingSession | null }).session;
}

const REVIEWER_KEY = "argus-swipe-reviewer";

export function loadReviewer(): string {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeReviewer(name: string) {
  try {
    window.localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    // private mode: the name lasts for this page only
  }
}

/** Points are a per-device toy; swipes and streaks live on the server. */
export function loadPoints(reviewer: string, day: string): number {
  try {
    return Number(window.localStorage.getItem(`argus-swipe-points:${reviewer}:${day}`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function storePoints(reviewer: string, day: string, points: number) {
  try {
    window.localStorage.setItem(`argus-swipe-points:${reviewer}:${day}`, String(points));
  } catch {
    // ignore
  }
}
