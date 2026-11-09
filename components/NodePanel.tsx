"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DetectionEvent, LabelPayload } from "@/lib/api";
import type { NodeOption } from "@/lib/nodes";
import { tempColor } from "@/lib/format";
import { useEventFeed } from "@/hooks/useEventFeed";
import { useNodeHealth, type NodeState } from "@/hooks/useNodeHealth";
import { EventDetailPanel } from "./EventDetailPanel";
import { EventList } from "./EventList";
import { FeedModeBadge } from "./FeedModeBadge";
import { LiveFeed } from "./LiveFeed";
import { NodeSignIn } from "./NodeSignIn";
import { StatusDot } from "./StatusDot";
import { Metric } from "./StatusStrip";

const STATE_COPY: Record<NodeState, string> = {
  connecting: "connecting…",
  online: "online",
  offline: "offline",
  signin: "sign-in needed",
};

/**
 * Everything the console shows about one node. Each panel fetches, polls
 * and fails on its own, so a node that goes away only takes its own panel
 * with it.
 */
export function NodePanel({
  node,
  onAlertCount,
}: {
  node: NodeOption;
  onAlertCount: (nodeId: string, count: number) => void;
}) {
  const health = useNodeHealth(node.id);
  const { state, status, thermal } = health;
  const reportedName = status?.node;

  const header = (right?: ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          tone={state === "online" ? "live" : state === "offline" ? "down" : "idle"}
          pulse={state === "online"}
        />
        <h2 className="truncate text-sm font-medium text-foreground">{node.name}</h2>
        {/* The node's own idea of its name labels its events below. */}
        {reportedName && reportedName !== node.name && (
          <span className="truncate font-mono text-[11px] text-muted">
            reports as {reportedName}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={`font-mono text-[11px] tracking-widest uppercase ${
            state === "offline" ? "text-danger" : "text-muted"
          }`}
        >
          {STATE_COPY[state]}
        </span>
        {right}
      </div>
    </div>
  );

  const temp = thermal?.current?.soc_temp_c ?? null;
  const soft = thermal?.limits_c.soft ?? 80;
  const throttled = (thermal?.throttled.now.length ?? 0) > 0;

  const metrics = (
    <div
      className={`grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:grid-cols-4 ${
        state === "offline" ? "opacity-50" : ""
      }`}
    >
      <Metric label="FPS" value={status ? String(status.fps) : "—"} />
      <Metric label="Accelerator" value={status?.accelerator ?? "—"} />
      <Metric label="Model" value={status?.model_version ?? "—"} />
      <Metric
        label="SoC temp"
        value={temp === null ? "—" : `${temp.toFixed(1)}°C${throttled ? " ⚠" : ""}`}
        color={tempColor(temp, soft)}
      />
    </div>
  );

  return (
    <section
      aria-label={node.name}
      className={`flex min-w-0 flex-col rounded border bg-surface ${
        state === "offline" ? "border-danger/40" : "border-border"
      }`}
    >
      {state === "signin" ? (
        <>
          {header()}
          <NodeSignIn
            nodeId={node.id}
            nodeName={node.name}
            onSignedIn={health.recheck}
          />
        </>
      ) : state === "connecting" ? (
        <>
          {header()}
          <div className="flex flex-1 items-center justify-center p-12">
            <p className="font-mono text-xs tracking-widest text-muted uppercase">
              Connecting to {node.name}…
            </p>
          </div>
        </>
      ) : (
        <NodeContent
          node={node}
          online={state === "online"}
          header={header}
          metrics={metrics}
          onAlertCount={onAlertCount}
        />
      )}
    </section>
  );
}

/** The signed-in panel; mounted only once the node has answered. */
function NodeContent({
  node,
  online,
  header,
  metrics,
  onAlertCount,
}: {
  node: NodeOption;
  online: boolean;
  header: (right?: ReactNode) => ReactNode;
  metrics: ReactNode;
  onAlertCount: (nodeId: string, count: number) => void;
}) {
  const { events, mode, error, applyLabel } = useEventFeed(node);
  // Held whole, not by id: the event must stay open if a burst of newer
  // ones pushes it out of the feed while it is being read.
  const [selected, setSelected] = useState<DetectionEvent | null>(null);

  const alertCount = events.filter(
    (event) => event.status === "stranger" && !event.confirmed,
  ).length;

  useEffect(() => {
    onAlertCount(node.id, alertCount);
  }, [node.id, alertCount, onAlertCount]);

  useEffect(() => () => onAlertCount(node.id, 0), [node.id, onAlertCount]);

  const close = useCallback(() => setSelected(null), []);

  function select(id: number) {
    setSelected(events.find((event) => event.id === id) ?? null);
  }

  // The feed's copy has any label applied since the event was opened.
  const current = selected
    ? (events.find((event) => event.id === selected.id) ?? selected)
    : null;

  return (
    <>
      {header(<FeedModeBadge mode={mode} />)}
      {metrics}

      {online ? (
        <LiveFeed nodeId={node.id} compact />
      ) : (
        <div className="flex aspect-video max-h-[42vh] w-full items-center justify-center bg-black">
          <p className="font-mono text-xs tracking-widest text-danger uppercase">
            Node offline
          </p>
        </div>
      )}

      {online && error && (
        <p className="border-t border-border px-4 py-2 font-mono text-[11px] text-danger">
          Events unavailable: {error}
        </p>
      )}

      <div className="h-48 border-t border-border">
        <EventList
          events={events.slice(0, 8)}
          selectedId={current?.id ?? null}
          onSelect={select}
          bare
        />
      </div>

      {current && (
        <EventDetailOverlay
          event={current}
          nodeName={node.name}
          onClose={close}
          onLabel={applyLabel}
        />
      )}
    </>
  );
}

/**
 * The event's details over the wall. An overlay rather than a route so
 * the camera streams keep running underneath and closing it is instant.
 */
function EventDetailOverlay({
  event,
  nodeName,
  onClose,
  onLabel,
}: {
  event: DetectionEvent;
  nodeName: string;
  onClose: () => void;
  onLabel: (id: number, payload: LabelPayload) => Promise<void>;
}) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    backRef.current?.focus();

    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Event details from ${nodeName}`}
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
    >
      <div className="flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto">
        <button
          ref={backRef}
          onClick={onClose}
          className="rounded border border-border bg-surface px-4 py-3 text-center font-mono text-[11px] tracking-[0.2em] text-foreground uppercase transition-colors hover:border-accent"
        >
          ← Back to live view
        </button>
        <div className="min-h-[420px]">
          <EventDetailPanel event={event} onLabel={onLabel} />
        </div>
      </div>
    </div>
  );
}
