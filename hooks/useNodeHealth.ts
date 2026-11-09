"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createApi,
  type StatusResponse,
  type ThermalStatus,
} from "@/lib/api";

/**
 * What one panel knows about its node. "signin" means this browser has no
 * session the node accepts; it is separate from "offline" because the fix
 * is a password, not a cable.
 */
export type NodeState = "connecting" | "online" | "offline" | "signin";

// Each node is polled on its own, so one that hangs delays nothing else.
const POLL_MS = 5_000;

// A hotspot drops the odd request; one miss should not tear down a video
// stream that is still running.
const OFFLINE_AFTER_FAILURES = 2;

export function useNodeHealth(nodeId: string) {
  const [state, setState] = useState<NodeState>("connecting");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [thermal, setThermal] = useState<ThermalStatus | null>(null);
  // Bumped after a sign-in to start polling again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const client = createApi(nodeId);
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    async function tick() {
      const [statusResult, thermalResult] = await Promise.allSettled([
        client.getStatus(),
        client.getThermal(),
      ]);
      if (cancelled) return;

      if (statusResult.status === "fulfilled") {
        failures = 0;
        setStatus(statusResult.value);
        setState("online");
      } else if (
        statusResult.reason instanceof ApiError &&
        statusResult.reason.status === 401
      ) {
        stop();
        setStatus(null);
        setThermal(null);
        setState("signin");
        return;
      } else {
        failures += 1;
        const down = failures >= OFFLINE_AFTER_FAILURES;
        setState((current) =>
          current === "online" && !down ? current : "offline",
        );
      }

      if (thermalResult.status === "fulfilled") {
        setThermal(thermalResult.value);
      } else if (
        thermalResult.reason instanceof ApiError &&
        thermalResult.reason.status === 404
      ) {
        // Older node with no thermal endpoint: the tile stays a dash.
        setThermal(null);
      }
    }

    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [nodeId, attempt]);

  const recheck = useCallback(() => {
    setState("connecting");
    setAttempt((n) => n + 1);
  }, []);

  return { state, status, thermal, recheck };
}
