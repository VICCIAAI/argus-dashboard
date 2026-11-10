import { WS_EVENTS_URL } from "./config";
import type {
  GenerateResult,
  LabelName,
  LabelProvenance,
  ReviewPayload,
  SamplesResponse,
  SuggestionsResponse,
} from "./fl/types";

// Shapes match the FastAPI contract in CLAUDE.md — keep in sync with
// Mohammed's backend once it exists for real.
//
// Calls go to /api/argus/* on this origin, not straight to the backend:
// the JWT is an HttpOnly cookie here, so only a server-side hop can
// attach it (see app/api/argus/[...path]/route.ts). Paths below are the
// backend's own, minus the /api prefix the proxy re-adds.
const PROXY_BASE = "/api/argus";

// A panel polling one of several nodes should give up on a dead one
// quickly; a Pi that is off leaves the connection hanging otherwise.
const NODE_READ_TIMEOUT_MS = 4_000;

/** Adds the proxy's node selector. Without one it uses the picked node. */
function withNode(path: string, nodeId?: string): string {
  if (!nodeId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}node=${encodeURIComponent(nodeId)}`;
}

export interface StatusResponse {
  fps: number;
  accelerator: string;
  model_version: string;
  nodes_online: number;
  /** The node's own NODE_NAME, which need not match ARGUS_NODES. */
  node?: string;
}

/** One thermal reading from the node (GET /api/system/thermal*). */
export interface ThermalSample {
  ts: number;
  soc_temp_c: number | null;
  cpu_mhz: number | null;
  fan_rpm: number | null;
  throttled_hex: string | null;
  /** Throttle flags set at the time of the sample; empty when healthy. */
  throttled_now: string[];
  detect_fps: number | null;
}

/** pass = stayed under the soft limit with no throttling in the window. */
export interface ThermalSummary {
  window_min: number;
  samples: number;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_avg_c: number | null;
  throttled_samples: number;
  pass: boolean;
}

export interface ThermalStatus {
  node: string;
  enclosure: string;
  interval_s: number;
  running_since: string;
  limits_c: { soft: number; hard: number };
  current: ThermalSample | null;
  throttled: { hex: string | null; now: string[]; since_boot: string[] };
  summary: ThermalSummary;
}

export interface ThermalHistory {
  interval_s: number;
  summary: ThermalSummary;
  samples: ThermalSample[];
}

export type DetectionClass = "person" | "vehicle" | "package" | "animal";
export type DetectionStatus = "member" | "stranger" | "na";

export interface DetectionEvent {
  id: number;
  cls: DetectionClass;
  zone: string;
  node: string;
  ts: string;
  status: DetectionStatus;
  label: string;
  confidence: number;
  confirmed: number;
  /** 1 = anomaly, frozen on the node once decided; null = unranked. */
  priority?: number | null;
  /** Node path of the kept clip; set only for events with footage. */
  clip?: string | null;
}

export type LabelAction = "confirm" | "correct";

export interface LabelPayload {
  action: LabelAction;
  label?: string;
  review?: ReviewPayload;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the ARGUS node", 0);
  }

  if (!res.ok) {
    throw new ApiError(`${path} failed: ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** The API for one node by id, or for the node picked in the nav. */
export function createApi(nodeId?: string) {
  const read = <T,>(path: string) =>
    apiFetch<T>(
      withNode(path, nodeId),
      nodeId ? { signal: AbortSignal.timeout(NODE_READ_TIMEOUT_MS) } : undefined,
    );

  return {
    getStatus: () => read<StatusResponse>("/status"),

    getEvents: () => read<DetectionEvent[]>("/events"),

    getThermal: () => read<ThermalStatus>("/system/thermal"),

    getThermalHistory: (minutes: number) =>
      read<ThermalHistory>(`/system/thermal/history?minutes=${minutes}`),

    labelEvent: (id: number, payload: LabelPayload) =>
      apiFetch<void>(withNode(`/events/${id}/label`, nodeId), {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}

export const api = createApi();

export interface LabelResult {
  ok: boolean;
  id: number;
  label?: string;
  labelled_total?: number;
  /** Absent when the node runs code that does not record provenance. */
  provenance?: LabelProvenance;
}

/**
 * Read a node's samples. A full store can run to megabytes off a busy Pi,
 * so this allows far longer than the 4 s a status poll gets.
 */
export function fetchSamples(nodeId: string, limit: number) {
  return apiFetch<SamplesResponse>(
    withNode(`/federated/samples?limit=${limit}`, nodeId),
    { signal: AbortSignal.timeout(30_000) },
  );
}

/**
 * Write one training label. Always `correct` with an exact label name:
 * `confirm` lets the node decide what was confirmed from the model's own
 * call, which would feed the model's opinion back in as ground truth.
 */
export function writeLabel(
  nodeId: string,
  id: number,
  label: LabelName,
  keepalive = false,
  review?: ReviewPayload,
) {
  const payload: LabelPayload = { action: "correct", label, review };
  return apiFetch<LabelResult>(withNode(`/events/${id}/label`, nodeId), {
    method: "POST",
    body: JSON.stringify(payload),
    keepalive,
  });
}

/** A node's machine suggestions, or null if it has no such endpoint yet. */
export async function fetchSuggestions(
  nodeId: string,
): Promise<SuggestionsResponse | null> {
  try {
    return await apiFetch<SuggestionsResponse>(
      withNode("/federated/suggestions", nodeId),
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch {
    return null;
  }
}

/**
 * Ask a node to recompute suggestions. Writes only its suggestions file.
 * `exclude` is the test set, which must never be pre-filled.
 */
export function generateSuggestions(nodeId: string, exclude: number[]) {
  return apiFetch<GenerateResult>(
    withNode("/federated/suggestions/generate", nodeId),
    { method: "POST", body: JSON.stringify({ exclude }) },
  );
}

/**
 * Opens the live event feed. Backend push shape is identical to a
 * DetectionEvent record (see CLAUDE.md).
 */
export function connectEventsSocket(
  onEvent: (event: DetectionEvent) => void,
  onError?: (event: Event) => void,
  /** The selected node's socket (GET /api/nodes); defaults to the env one. */
  url: string = WS_EVENTS_URL,
): WebSocket {
  const socket = new WebSocket(url);

  socket.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as DetectionEvent);
    } catch {
      // ignore malformed frames rather than crash the feed
    }
  };

  if (onError) socket.onerror = onError;

  return socket;
}

/**
 * MJPEG camera stream, for an <img src>. An <img> cannot carry an
 * Authorization header, which is why this points at the proxy rather
 * than at the node's /api/camera/stream directly.
 */
export function liveStreamUrl(
  nodeId?: string,
  params: Record<string, string | number> = {},
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  if (nodeId) query.set("node", nodeId);
  const suffix = query.toString();
  return `${PROXY_BASE}/camera/stream${suffix ? `?${suffix}` : ""}`;
}

/** Single still, used as the live panel's poster and on failure retries. */
export function cameraSnapshotUrl(cacheBust?: number): string {
  const suffix = cacheBust === undefined ? "" : `?t=${cacheBust}`;
  return `${PROXY_BASE}/camera/snapshot${suffix}`;
}

/**
 * The still captured for one event. The node serves it at
 * /api/events/{id}/snapshot; it 404s for events recorded without one.
 */
export function eventSnapshotUrl(id: number, nodeId?: string): string {
  return withNode(`${PROXY_BASE}/events/${id}/snapshot`, nodeId);
}

/** The H.264 clip the node kept for a priority-1 event. */
export function eventClipUrl(id: number): string {
  return `${PROXY_BASE}/events/${id}/clip`;
}

/** The thermal window as a CSV download, for soak-test records. */
export function thermalCsvUrl(minutes: number): string {
  return `${PROXY_BASE}/system/thermal.csv?minutes=${minutes}`;
}
