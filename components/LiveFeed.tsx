"use client";

/* eslint-disable @next/next/no-img-element */
// Deliberately a plain <img>, not next/image: this is an endless
// multipart/x-mixed-replace MJPEG response, not an asset to optimize,
// and the optimizer would try to fetch and resize it once.

import { useState } from "react";
import { liveStreamUrl } from "@/lib/api";
import { StatusDot } from "./StatusDot";

type StreamState = "loading" | "streaming" | "error";

export function LiveFeed({
  nodeId,
  compact = false,
}: {
  /** Which node to show; defaults to the one picked in the nav. */
  nodeId?: string;
  /** Inside a panel: shorter picture, lighter stream, no footer. */
  compact?: boolean;
} = {}) {
  const [state, setState] = useState<StreamState>("loading");
  // Bumping this remounts the <img>, which is the only reliable way to
  // reopen an MJPEG connection the browser has already given up on.
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setState("loading");
    setAttempt((n) => n + 1);
  }

  return (
    <div
      className={
        compact
          ? "flex flex-col"
          : "flex flex-col rounded border border-border bg-surface"
      }
    >
      <div
        className={`flex items-center justify-between border-b border-border px-4 ${
          compact ? "py-2" : "py-3"
        }`}
      >
        <p className="font-mono text-[11px] tracking-widest text-muted uppercase">
          Live camera
        </p>
        <span className="flex items-center gap-2 font-mono text-[11px] text-muted uppercase">
          <StatusDot
            tone={state === "streaming" ? "live" : state === "error" ? "down" : "idle"}
            pulse={state === "streaming"}
          />
          {state === "streaming" ? "streaming" : state === "error" ? "no signal" : "opening…"}
        </span>
      </div>

      <div className="relative bg-black">
        <div className={`aspect-video w-full ${compact ? "max-h-[42vh]" : ""}`}>
          {state !== "error" && (
            <img
              key={attempt}
              // Several streams share one phone hotspot in a panel view.
              src={liveStreamUrl(nodeId, {
                ...(compact ? { quality: 70 } : {}),
                r: attempt,
              })}
              alt="Live camera feed from the ARGUS node"
              className="h-full w-full object-contain"
              onLoad={() => setState("streaming")}
              onError={() => setState("error")}
            />
          )}
        </div>

        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-xs tracking-widest text-muted uppercase">
              Opening camera stream…
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-mono text-xs tracking-widest text-danger uppercase">
              Camera stream unavailable
            </p>
            <p className="max-w-sm font-mono text-[11px] leading-relaxed text-muted">
              The node is not serving /api/camera/stream. The camera may be
              uninitialised, in use by another process, or the node may be
              unreachable.
            </p>
            <button
              onClick={retry}
              className="rounded border border-border px-3 py-2 font-mono text-[11px] tracking-[0.2em] text-muted uppercase transition-colors hover:border-accent hover:text-foreground"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {!compact && (
        <p className="border-t border-border px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
          Frames are served by the node on the local network and proxied with
          your session token. Nothing is recorded or forwarded off the
          property by this page.
        </p>
      )}
    </div>
  );
}
