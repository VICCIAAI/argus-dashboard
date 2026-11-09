"use client";

/* eslint-disable @next/next/no-img-element */
// Plain <img>: proxied from the node with the session token, not a static
// asset the image optimizer could fetch.

import { useState } from "react";
import { eventSnapshotUrl } from "@/lib/api";
import type { Sample } from "@/lib/fl/types";

/**
 * The still for one event, with the detector's box drawn on it. Callers
 * key this by event, so its loaded state starts fresh for each one.
 * `onSeen` fires only once the picture has really rendered, because a
 * label may not be given for something the operator could not see.
 */
export function SnapshotImage({
  sample,
  nodeId,
  size,
  onSeen,
  onFailed,
}: {
  sample: Sample & { n: number };
  nodeId: string;
  size: "large" | "tile";
  onSeen: () => void;
  onFailed: () => void;
}) {
  const [state, setState] = useState<"loading" | "seen" | "failed">("loading");
  const box = sample.meta.box;

  if (state === "failed") {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded bg-surface-raised px-4 text-center font-mono text-[11px] text-muted">
        No picture for event {sample.n}. It cannot be labelled.
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-fit max-w-full">
      <img
        src={eventSnapshotUrl(sample.n, nodeId)}
        alt={`Camera still for event ${sample.n}, detector class ${sample.features.class}`}
        className={`block max-w-full ${size === "large" ? "max-h-[56vh]" : "h-36 w-full object-cover"}`}
        onLoad={() => {
          setState("seen");
          onSeen();
        }}
        onError={() => {
          setState("failed");
          onFailed();
        }}
      />
      {box && state === "seen" && size === "large" && (
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
  );
}
