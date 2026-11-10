"use client";

import { wilson, pct } from "@/lib/fl/stats";
import { AMBER, formatEpoch } from "@/lib/format";
import { MIN_LABELS_PER_NODE, type PreflightResponse } from "@/lib/fl/types";

const TH = "py-1.5 pr-4 font-normal text-muted";
const TD = "py-1.5 pr-4 align-top text-foreground";

export function PreflightPanel({ data }: { data: PreflightResponse }) {
  const blockers = data.checks.filter((check) => check.level === "blocker");
  const warnings = data.checks.filter((check) => check.level === "warning");
  const { server } = data;

  return (
    <section className="rounded border border-border bg-surface p-4 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sans text-sm font-medium text-foreground">Pre-flight</h2>
        <p className="text-[11px] text-muted">
          Read {formatEpoch(data.checkedAt)}. This panel starts nothing.
        </p>
      </div>

      <p className={`mt-2 text-sm ${blockers.length ? "text-danger" : "text-accent"}`}>
        {blockers.length
          ? `✕ Not ready: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`
          : "✓ No blockers found. A round still needs Gio's go."}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px] text-left tabular-nums">
          <thead>
            <tr>
              <th className={TH}>Node</th>
              <th className={TH}>State</th>
              <th className={TH}>Reports as</th>
              <th className={TH}>Accelerator</th>
              <th className={TH}>Real labels</th>
              <th className={TH}>Human-reviewed</th>
              <th className={TH}>Machine, unreviewed</th>
              <th className={TH}>Anomalies</th>
              <th className={TH}>Synthetic rows</th>
              <th className={TH}>Head</th>
              <th className={TH}>Test set</th>
              <th className={TH}>flwr</th>
            </tr>
          </thead>
          <tbody>
            {data.nodes.map((node) => (
              <tr key={node.id} className="border-t border-border">
                <td className={TD}>{node.name}</td>
                <td className={TD}>
                  {node.online ? (
                    <span className="text-accent">✓ online</span>
                  ) : (
                    <span className="text-danger">✕ {node.error ?? "offline"}</span>
                  )}
                  {node.roundRunning && <span className="text-danger"> · round running</span>}
                </td>
                <td className={TD}>{node.reportedName ?? "unknown"}</td>
                <td className={TD}>{node.accelerator ?? "unknown"}</td>
                <td className={TD}>
                  {node.realLabelled === null
                    ? "unknown"
                    : `${node.realLabelled} / ${MIN_LABELS_PER_NODE}`}
                  {node.total !== undefined && (
                    <span className="text-muted"> of {node.total} events</span>
                  )}
                </td>
                <td className={TD}>
                  {node.labelsReviewed ?? "unknown"}
                  {node.reviewedAnomalies !== null &&
                    node.reviewedAnomalies !== undefined && (
                      <span className="text-muted">
                        {" "}
                        ({node.reviewedAnomalies} anomalies)
                      </span>
                    )}
                </td>
                <td className={TD}>
                  {node.labelsMachine ?? "unknown"}
                  {node.provenanceReported === false && (
                    <span className="text-muted"> (node not updated)</span>
                  )}
                </td>
                <td className={TD}>{node.realAnomalies ?? "unknown"}</td>
                <td className={TD}>{node.syntheticRows ?? "unknown"}</td>
                <td className={TD}>{node.modelVersion ?? "unknown"}</td>
                <td className={TD}>
                  {node.testSet.size} ({node.testSet.anomalies} anomalies)
                  <span className="text-muted">
                    {node.testSet.frozenAt ? " frozen" : " not frozen"}
                  </span>
                </td>
                <td className={TD}>
                  {node.flwrHandChecked ?? <span className="text-muted">not checked</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Flower server</dt>
          <dd className={server.up ? "text-accent" : "text-danger"}>
            {server.up ? "✓ up" : `✕ ${server.error ?? "down"}`}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Clients connected (TCP, :8080)</dt>
          <dd className="text-foreground">{server.establishedClients ?? "unknown"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Server plan</dt>
          <dd className="text-foreground">
            {server.config
              ? `${server.config.rounds} round, ${server.config.min_clients} clients, ${server.config.local_epochs} epochs, ${server.config.aggregation}`
              : "unknown"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Server flwr</dt>
          <dd className="text-foreground">{server.flwrHandChecked}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[11px] text-muted">
        Clients only connect once a round is triggered, so 0 is normal before
        that. The server&apos;s own connected count stays 0 until a round ends.
        No API reports flwr, so those are hand-checked values.
      </p>

      {data.checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {blockers.map((check) => (
            <li key={check.text} className="text-danger">
              ✕ {check.text}
            </li>
          ))}
          {warnings.map((check) => (
            <li key={check.text} style={{ color: AMBER }}>
              ! {check.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DetectorQualityPanel({ data }: { data: PreflightResponse }) {
  return (
    <section className="rounded border border-border bg-surface p-4 font-mono text-xs">
      <h2 className="font-sans text-sm font-medium text-foreground">
        Detector class, as confirmed by the operator
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        YOLO is not federated, so rounds cannot change these. This is how often
        a person agreed with the detector&apos;s class on events they labelled
        routine. It covers only those events and misses anything YOLO never
        detected, so it is not mAP or recall.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left tabular-nums">
          <thead>
            <tr>
              <th className={TH}>Node</th>
              <th className={TH}>Detector said</th>
              <th className={TH}>Person agreed</th>
              <th className={TH}>Corrected</th>
              <th className={TH}>Agreement (95% range)</th>
            </tr>
          </thead>
          <tbody>
            {data.nodes.flatMap((node) => {
              const classes = Object.entries(node.detector?.byClass ?? {});
              if (classes.length === 0) {
                return [
                  <tr key={node.id} className="border-t border-border">
                    <td className={TD}>{node.name}</td>
                    <td className={TD} colSpan={4}>
                      <span className="text-muted">
                        No operator confirmations yet
                        {node.detector?.notObject
                          ? ` · ${node.detector.notObject} marked no object`
                          : ""}
                      </span>
                    </td>
                  </tr>,
                ];
              }
              return classes.map(([cls, stat], index) => {
                const n = stat.confirmed + stat.corrected;
                const range = wilson(stat.confirmed, n);
                return (
                  <tr key={node.id + cls} className="border-t border-border">
                    <td className={TD}>
                      {index === 0
                        ? `${node.name}${node.detector?.notObject ? ` (${node.detector.notObject} no object)` : ""}`
                        : ""}
                    </td>
                    <td className={TD}>{cls}</td>
                    <td className={TD}>{stat.confirmed}</td>
                    <td className={TD}>{stat.corrected}</td>
                    <td className={TD}>
                      {range
                        ? `${pct(range.p)} (${pct(range.low)}–${pct(range.high)}), n=${n}`
                        : "none"}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
