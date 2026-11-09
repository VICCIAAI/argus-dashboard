import type { DetectionEvent } from "@/lib/api";
import { formatTimeShort } from "@/lib/format";

export function EventList({
  events,
  selectedId,
  onSelect,
  bare = false,
}: {
  events: DetectionEvent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Inside a panel that already draws the border. */
  bare?: boolean;
}) {
  return (
    <div
      className={
        bare
          ? "flex h-full flex-col"
          : "flex h-full flex-col rounded border border-border bg-surface"
      }
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="font-mono text-[11px] tracking-widest text-muted uppercase">
          Recent events
        </p>
        <span className="font-mono text-[11px] text-muted">{events.length}</span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-xs tracking-widest text-muted uppercase">
            No events
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {events.map((event) => {
            const isAlert = event.status === "stranger";
            const isSelected = event.id === selectedId;
            return (
              <li key={event.id}>
                <button
                  onClick={() => onSelect(event.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised ${
                    isSelected ? "bg-surface-raised" : ""
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      isAlert ? "bg-danger" : "bg-muted"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {event.label}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted">
                      {event.zone} · {event.node}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[11px] text-muted">
                      {formatTimeShort(event.ts)}
                    </p>
                    <p className="font-mono text-[11px] text-muted">
                      {event.confidence}%
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
