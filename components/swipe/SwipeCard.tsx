"use client";

/* eslint-disable @next/next/no-img-element */
// Plain <img>: proxied from the node with the session token.

import { useEffect, useState } from "react";
import { eventSnapshotUrl } from "@/lib/api";
import { fetchEventClip } from "@/lib/swipe/client";
import type { Card, Item } from "@/lib/swipe/queue";

const LANE_BADGE: Record<Card["lane"], { text: string; className: string }> = {
  uncertain: { text: "Model unsure", className: "bg-accent/15 text-accent" },
  random: { text: "Calibration · guess hidden", className: "bg-foreground/10 text-foreground" },
  spot: { text: "Spot check · machine label", className: "bg-amber-400/15 text-amber-300" },
};

function pretty(label: string): string {
  return label === "anomaly" ? "Anomaly" : `Routine ${label.replace("routine_", "")}`;
}

function time(t: number): string {
  return new Date(t * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** The still, zoomed onto the detector's box when the box is small. */
export function Snapshot({
  item,
  nodeId,
  zoom,
  onState,
  className = "",
}: {
  item: Item;
  nodeId: string;
  zoom: boolean;
  onState?: (state: "seen" | "failed") => void;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = item.meta.box;
  let transform: string | undefined;
  if (zoom && box) {
    const bw = Math.max(0.05, box[2] - box[0]);
    const bh = Math.max(0.05, box[3] - box[1]);
    const s = Math.min(0.8 / bw, 0.8 / bh, 4);
    if (s > 1.1) {
      const cx = (box[0] + box[2]) / 2;
      const cy = (box[1] + box[3]) / 2;
      transform = `translate(${(0.5 - cx * s) * 100}%, ${(0.5 - cy * s) * 100}%) scale(${s})`;
    }
  }

  if (failed) {
    return (
      <div className={`flex aspect-video w-full items-center justify-center bg-surface-raised px-4 text-center font-mono text-xs text-muted ${className}`}>
        No picture for event {item.n}. Skip it (swipe up).
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden bg-black ${className}`}>
      <div style={{ transform, transformOrigin: "0 0" }} className="transition-transform duration-300">
        <img
          src={eventSnapshotUrl(item.n, nodeId)}
          alt={`Event ${item.n}, detector class ${item.features.class}`}
          draggable={false}
          className="block w-full select-none"
          onLoad={() => onState?.("seen")}
          onError={() => {
            setFailed(true);
            onState?.("failed");
          }}
        />
        {box && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-accent"
            style={{
              left: `${box[0] * 100}%`,
              top: `${box[1] * 100}%`,
              width: `${(box[2] - box[0]) * 100}%`,
              height: `${(box[3] - box[1]) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

export function SwipeCardBody({
  card,
  nodeId,
  nodeName,
  expanded,
  onToggleExpand,
  onImageState,
}: {
  card: Card;
  nodeId: string;
  nodeName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onImageState: (state: "seen" | "failed") => void;
}) {
  const box = card.lead.meta.box;
  const small = box ? Math.max(box[2] - box[0], box[3] - box[1]) < 0.4 : false;
  const [zoom, setZoom] = useState(small);
  const [clip, setClip] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const badge = LANE_BADGE[card.lane];
  const count = card.members.length;

  useEffect(() => {
    let cancelled = false;
    void fetchEventClip(nodeId, card.lead.n).then((url) => {
      if (!cancelled) setClip(url);
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, card.lead.n]);

  return (
    <div className="flex flex-col">
      <div className="relative">
        {playing && clip ? (
          <video src={clip} controls autoPlay muted playsInline className="block w-full bg-black" />
        ) : (
          <button
            type="button"
            className="block w-full cursor-zoom-in"
            onClick={() => setZoom((z) => !z)}
            aria-label={zoom ? "Show the whole frame" : "Zoom onto the detection"}
          >
            <Snapshot item={card.lead} nodeId={nodeId} zoom={zoom} onState={onImageState} />
          </button>
        )}
        <span className={`absolute top-2 left-2 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase backdrop-blur ${badge.className}`}>
          {badge.text}
        </span>
        {count > 1 && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="absolute top-2 right-2 rounded-full bg-black/70 px-3 py-1 font-mono text-xs font-semibold text-foreground backdrop-blur"
          >
            ×{count} similar {expanded ? "▴" : "▾"}
          </button>
        )}
        {clip && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="absolute right-2 bottom-2 rounded-full bg-black/70 px-3 py-1 font-mono text-xs text-foreground backdrop-blur"
          >
            {playing ? "■ Still" : "▶ Clip"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-muted">
          <span>
            {nodeName} · #{card.lead.n}
          </span>
          <span>{time(card.lead.t)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground first-letter:uppercase">
            {card.lead.features.class} · {Math.round(card.lead.features.dwell * 30)} s in view
          </span>
          {card.guess ? (
            <span
              className={`rounded px-2 py-0.5 text-sm font-semibold ${
                card.guess.label === "anomaly" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"
              }`}
              title={card.guess.source}
            >
              {card.lane === "spot" ? "Machine: " : card.basis === "model" ? "Model: " : "Rule: "}
              {pretty(card.guess.label)}
              {card.guess.confidence !== null && ` ${Math.round(card.guess.confidence * 100)}%`}
            </span>
          ) : (
            <span className="rounded bg-foreground/10 px-2 py-0.5 text-sm text-muted">Your call</span>
          )}
        </div>
        {card.guess?.confidence !== null && card.guess && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised" aria-hidden>
            <div
              className={card.guess.label === "anomaly" ? "h-full bg-danger" : "h-full bg-accent"}
              style={{ width: `${Math.round((card.guess.confidence ?? 0) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {expanded && count > 1 && (
        <div className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto border-t border-border p-2">
          {card.members.map((member) => (
            <div key={member.n} className="flex flex-col">
              <Snapshot item={member} nodeId={nodeId} zoom={false} className="rounded" />
              <span className="mt-0.5 text-center font-mono text-[9px] text-muted">
                #{member.n} · {new Date(member.t * 1000).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
