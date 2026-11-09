"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type StatusResponse } from "@/lib/api";
import { StatusDot } from "./StatusDot";

type ConnectionState = "connecting" | "online" | "offline";

export function StatusStrip({
  forceOffline = false,
}: {
  forceOffline?: boolean;
}) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err instanceof ApiError ? err.message : "Failed to load status");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectionState: ConnectionState = forceOffline || fetchError
    ? "offline"
    : data
      ? "online"
      : "connecting";

  const isOffline = connectionState === "offline";

  const dotTone = isOffline ? "down" : connectionState === "online" ? "live" : "idle";
  const label =
    connectionState === "offline"
      ? forceOffline
        ? "system offline (simulated)"
        : "system offline"
      : connectionState === "online"
        ? "system online"
        : "connecting…";

  return (
    <div
      className={`rounded border px-4 py-3 transition-colors ${
        isOffline ? "border-danger/40 bg-danger/5" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={dotTone} />
        <span
          className={`font-mono text-[11px] tracking-widest uppercase ${
            isOffline ? "text-danger" : "text-muted"
          }`}
        >
          {label}
        </span>
      </div>

      <div
        className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 sm:gap-x-6 ${
          isOffline ? "opacity-50" : ""
        }`}
      >
        <Metric label="FPS" value={data ? String(data.fps) : "—"} />
        <Metric label="Accelerator" value={data?.accelerator ?? "—"} />
        <Metric label="Model" value={data?.model_version ?? "—"} />
        <Metric
          label="Nodes online"
          value={data ? String(data.nodes_online) : "—"}
        />
      </div>

      {isOffline && data && (
        <p className="mt-2 font-mono text-[10px] tracking-wide text-danger/80 uppercase">
          last known values — unconfirmed
        </p>
      )}
    </div>
  );
}

export function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] tracking-wider text-muted uppercase">
        {label}
      </p>
      <p className="truncate font-mono text-sm text-foreground" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
