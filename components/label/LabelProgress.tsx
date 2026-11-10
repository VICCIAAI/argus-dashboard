"use client";

import { LABEL_NAMES, MIN_LABELS_PER_NODE, type LabelName } from "@/lib/fl/types";

// Colors validated with the dataviz script against this console's surface.
// Anomaly sits apart from yellow so the two never touch.
const SEGMENTS: { label: LabelName; name: string; color: string }[] = [
  { label: "anomaly", name: "Anomaly", color: "var(--danger)" },
  { label: "routine_person", name: "Person", color: "var(--series-1)" },
  { label: "routine_vehicle", name: "Vehicle", color: "var(--series-2)" },
  { label: "routine_animal", name: "Animal", color: "var(--series-3)" },
  { label: "routine_package", name: "Package", color: "var(--series-4)" },
];

export function LabelProgress({
  counts,
  pending,
  totalEvents,
  synthetic,
  machineLabelled,
  provenanceReported,
}: {
  /** Labels a person reviewed. Machine labels do not count toward a round. */
  counts: Record<LabelName, number>;
  pending: number;
  totalEvents: number;
  synthetic: number;
  machineLabelled: number;
  provenanceReported: boolean;
}) {
  const labelled = LABEL_NAMES.reduce((sum, name) => sum + counts[name], 0);
  const share = Math.min(1, labelled / MIN_LABELS_PER_NODE);
  const anomalies = counts.anomaly;

  return (
    <section className="grid items-center gap-4 rounded border border-border bg-surface px-4 py-3 md:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-3 pr-6 md:border-r md:border-border">
        <p className="text-4xl leading-none font-semibold text-foreground">{anomalies}</p>
        <p className="max-w-[130px] font-mono text-[11px] leading-snug tracking-wider text-muted uppercase">
          Anomalies reviewed
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-xs text-foreground">
            <span className="text-lg font-semibold">{labelled}</span> of{" "}
            {MIN_LABELS_PER_NODE} human-reviewed labels for a round
            {pending > 0 && <span className="text-muted"> · {pending} saving</span>}
          </p>
          <p className="font-mono text-[11px] text-muted">
            {totalEvents} events recorded
            {synthetic > 0 && ` · ${synthetic} synthetic rows excluded`}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={MIN_LABELS_PER_NODE}
          aria-valuenow={labelled}
          aria-label="Human-reviewed labels toward the minimum for a round"
          className="mt-2 h-2 rounded-full bg-surface-raised"
        >
          <div
            className="h-2 rounded-full bg-accent transition-[width]"
            style={{ width: `${share * 100}%` }}
          />
        </div>

        {labelled > 0 && (
          <div className="mt-2 flex h-2 gap-0.5" aria-hidden>
            {SEGMENTS.filter((segment) => counts[segment.label] > 0).map((segment) => (
              <div
                key={segment.label}
                className="rounded-full"
                style={{ flexGrow: counts[segment.label], background: segment.color }}
              />
            ))}
          </div>
        )}
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          {SEGMENTS.map((segment) => (
            <li key={segment.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: segment.color }}
              />
              {segment.name}{" "}
              <span className="text-foreground">{counts[segment.label]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 font-mono text-[11px] text-muted">
          Real camera events only, synthetic rows excluded. Unlabelled is never
          treated as routine. {machineLabelled} machine label
          {machineLabelled === 1 ? "" : "s"} on this node not reviewed yet.
          {!provenanceReported &&
            " This node does not record provenance yet, so all of its labels count as machine."}
        </p>
      </div>
    </section>
  );
}
