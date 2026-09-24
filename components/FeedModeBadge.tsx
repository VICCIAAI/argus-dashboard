import { StatusDot } from "./StatusDot";
import type { FeedMode } from "@/hooks/useEventFeed";

// Says how the events on screen are arriving. "Live" is reserved for a
// real push on /ws/events — a 5s poll is labelled as a poll, because on
// a security console the difference between "the moment it happens" and
// "within five seconds" is the whole point.
const COPY: Record<FeedMode, { label: string; tone: "live" | "idle" | "down" }> = {
  connecting: { label: "connecting…", tone: "idle" },
  live: { label: "live push", tone: "live" },
  polling: { label: "polling 5s", tone: "idle" },
  offline: { label: "no connection", tone: "down" },
};

export function FeedModeBadge({ mode }: { mode: FeedMode }) {
  const { label, tone } = COPY[mode];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded border px-2.5 py-1.5 font-mono text-[11px] tracking-widest uppercase ${
        mode === "offline"
          ? "border-danger/40 bg-danger/5 text-danger"
          : "border-border bg-surface text-muted"
      }`}
    >
      <StatusDot tone={tone} pulse={mode === "live"} />
      {label}
    </span>
  );
}
