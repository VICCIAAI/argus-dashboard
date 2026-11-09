"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  connectEventsSocket,
  createApi,
  type DetectionEvent,
  type LabelPayload,
} from "@/lib/api";
import { fetchNodes } from "@/hooks/useNodes";
import type { NodeOption } from "@/lib/nodes";

/**
 * The live event feed, shared by every dashboard page.
 *
 * Closes the "no live push yet" gap in the README: `connectEventsSocket()`
 * existed but nothing called it. The node pushes on /ws/events, so that is
 * the primary path; a socket that never opens, dies, or is blocked falls
 * back to polling /api/events, because a security console that silently
 * stops updating is worse than one that updates slowly.
 *
 * `mode` is what the UI renders: it distinguishes real live push from the
 * fallback rather than showing a "LIVE" badge for a poll.
 */
export type FeedMode = "connecting" | "live" | "polling" | "offline";

// Long enough not to hammer a Pi that is also running detection, short
// enough that a demo doesn't look frozen.
const POLL_INTERVAL_MS = 5_000;

// The console shows recent activity, not the whole history; the node's
// store is the record.
const MAX_EVENTS = 200;

function newestFirst(events: DetectionEvent[]): DetectionEvent[] {
  return [...events].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
  );
}

/** Replace an event with the same id, or add it; newest first, capped. */
function mergeEvent(
  events: DetectionEvent[],
  incoming: DetectionEvent,
): DetectionEvent[] {
  const existing = events.findIndex((event) => event.id === incoming.id);
  if (existing !== -1) {
    const next = [...events];
    next[existing] = incoming;
    return next;
  }
  return newestFirst([incoming, ...events]).slice(0, MAX_EVENTS);
}

/** With no node, follows the one picked in the nav. */
export function useEventFeed(node?: NodeOption) {
  const nodeId = node?.id;
  const nodeWsUrl = node?.wsUrl;
  const client = useMemo(() => (nodeId ? createApi(nodeId) : api), [nodeId]);
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [mode, setMode] = useState<FeedMode>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await client.getEvents();
      setEvents(newestFirst(data).slice(0, MAX_EVENTS));
      setError(null);
      // A successful poll while the socket is down is "polling", not
      // "offline" — but never downgrade a socket that is alive, which is
      // why this reads the current mode rather than setting it flat.
      setMode((current) => (current === "live" ? current : "polling"));
    } catch (err) {
      setMode("offline");
      setError(
        err instanceof ApiError ? err.message : "Failed to load events",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (cancelled || poll) return;
      poll = setInterval(() => {
        void refresh();
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (poll) clearInterval(poll);
      poll = null;
    }

    // First paint comes from REST either way; the socket only carries
    // what happens from now on.
    async function start() {
      await refresh();
      if (cancelled) return;

      // The socket goes straight to the node, so it needs the picked
      // node's own address rather than the proxy.
      let wsUrl = nodeWsUrl;
      if (!wsUrl) {
        const nodes = await fetchNodes();
        wsUrl = nodes?.nodes.find((option) => option.id === nodes.selected)?.wsUrl;
      }
      if (cancelled) return;

      try {
        socket = connectEventsSocket(
          (event) => {
            if (cancelled) return;
            setMode("live");
            setError(null);
            // Push means the socket is carrying updates; polling on top
            // of it would just duplicate work.
            stopPolling();
            setEvents((prev) => mergeEvent(prev, event));
          },
          () => {
            if (!cancelled) startPolling();
          },
          wsUrl,
        );

        socket.onopen = () => {
          if (!cancelled) setMode("live");
        };
        socket.onclose = () => {
          if (cancelled) return;
          setMode((current) => (current === "offline" ? current : "polling"));
          startPolling();
        };
      } catch {
        // No WS support or a bad URL — polling is the whole feed then.
        startPolling();
      }

      // Until a frame actually arrives the socket is unproven, so poll
      // alongside it; the first push stops this.
      startPolling();
    }

    void start();

    return () => {
      cancelled = true;
      stopPolling();
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [refresh, nodeWsUrl]);

  /**
   * Confirm/Correct. The node writes the label into the store the next
   * federated round trains on, so this is the human-in-the-loop, not a
   * cosmetic toggle — the local update mirrors what the node stored.
   */
  const applyLabel = useCallback(async (id: number, payload: LabelPayload) => {
    await client.labelEvent(id, payload);
    setEvents((prev) =>
      prev.map((event) =>
        event.id === id
          ? {
              ...event,
              confirmed: payload.action === "confirm" ? 1 : event.confirmed,
              label:
                payload.action === "correct" && payload.label
                  ? payload.label
                  : event.label,
            }
          : event,
      ),
    );
  }, [client]);

  return { events, mode, error, loading, refresh, applyLabel };
}
