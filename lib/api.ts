import { WS_EVENTS_URL } from "./config";

// Shapes match the FastAPI contract in CLAUDE.md — keep in sync with
// Mohammed's backend once it exists for real.
//
// Calls go to /api/argus/* on this origin, not straight to the backend:
// the JWT is an HttpOnly cookie here, so only a server-side hop can
// attach it (see app/api/argus/[...path]/route.ts). Paths below are the
// backend's own, minus the /api prefix the proxy re-adds.
const PROXY_BASE = "/api/argus";

export interface StatusResponse {
  fps: number;
  accelerator: string;
  model_version: string;
  nodes_online: number;
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
}

export type LabelAction = "confirm" | "correct";

export interface LabelPayload {
  action: LabelAction;
  label?: string;
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

export const api = {
  getStatus: () => apiFetch<StatusResponse>("/status"),

  getEvents: () => apiFetch<DetectionEvent[]>("/events"),

  labelEvent: (id: number, payload: LabelPayload) =>
    apiFetch<void>(`/events/${id}/label`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

/**
 * Opens the live event feed. Backend push shape is identical to a
 * DetectionEvent record (see CLAUDE.md).
 */
export function connectEventsSocket(
  onEvent: (event: DetectionEvent) => void,
  onError?: (event: Event) => void,
): WebSocket {
  const socket = new WebSocket(WS_EVENTS_URL);

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
export function liveStreamUrl(): string {
  return `${PROXY_BASE}/camera/stream`;
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
export function eventSnapshotUrl(id: number): string {
  return `${PROXY_BASE}/events/${id}/snapshot`;
}
