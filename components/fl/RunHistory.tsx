"use client";

import { Fragment, useState } from "react";
import { formatEpoch } from "@/lib/format";
import { pct } from "@/lib/fl/stats";
import type { HistoryFile, NodeRun, RunRecord, TestMeasurement } from "@/lib/fl/types";

const TH = "py-1.5 pr-4 font-normal text-muted whitespace-nowrap";
const TD = "py-1.5 pr-4 align-top text-foreground";
const NOT_REPORTED = "Not reported";

function epochsOf(run: RunRecord): string {
  const seen = new Set(run.nodes.flatMap((node) => node.fits.map((fit) => fit.epochs)));
  if (seen.size > 0) return [...seen].join(", ");
  return run.serverConfig?.local_epochs !== undefined
    ? `${run.serverConfig.local_epochs} (server setting)`
    : "unknown";
}

function roundsOf(run: RunRecord): string {
  if (run.serverRounds.length > 0) return String(run.serverRounds.length);
  const fits = Math.max(0, ...run.nodes.map((node) => node.fits.length));
  return fits > 0 ? String(fits) : "0";
}

function gateText(node: NodeRun): string {
  if (node.running) return "Running";
  if (!node.result) return "No result";
  if (node.result.accepted) return `Accepted${node.result.label ? ` as ${node.result.label}` : ""}`;
  return "Rejected";
}

function fixed(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_REPORTED : value.toFixed(3);
}

function usesSynthetic(run: RunRecord): boolean {
  return run.nodes.some((node) => (node.syntheticRows ?? 0) > 0);
}

export function RunHistory({ history }: { history: HistoryFile }) {
  const [open, setOpen] = useState<string | null>(null);
  const runs = [...history.runs].reverse();

  return (
    <section className="rounded border border-border bg-surface p-4 font-mono text-xs">
      <h2 className="font-sans text-sm font-medium text-foreground">Run history</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Only rounds that ran on the Pis. Simulation runs are not listed, and a
        run with synthetic rows on any node is marked and left out of the trends.
      </p>

      {runs.length === 0 ? (
        <p className="py-10 text-center text-muted">No live round yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left tabular-nums">
            <thead>
              <tr>
                <th className={TH}>Run</th>
                <th className={TH}>Date</th>
                <th className={TH}>Epochs</th>
                <th className={TH}>Rounds</th>
                <th className={TH}>Nodes</th>
                <th className={TH}>Training samples</th>
                <th className={TH}>Gate</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const expanded = open === run.id;
                return (
                  <Fragment key={run.id}>
                    <tr className="border-t border-border">
                      <td className={TD}>
                        {run.id}
                        {usesSynthetic(run) && (
                          <span className="ml-2 text-danger">synthetic, excluded</span>
                        )}
                      </td>
                      <td className={TD}>{formatEpoch(run.startedAt)}</td>
                      <td className={TD}>{epochsOf(run)}</td>
                      <td className={TD}>{roundsOf(run)}</td>
                      <td className={TD}>
                        {run.nodes.map((node) => node.nodeName).join(", ") || "server only"}
                      </td>
                      <td className={TD}>
                        {run.nodes.map((node) => node.trainSamples ?? "?").join(" / ") || "none"}
                      </td>
                      <td className={TD}>
                        {run.nodes
                          .map((node) => `${node.nodeName}: ${gateText(node)}`)
                          .join(", ") || "none"}
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : run.id)}
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          {expanded ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} className="bg-surface-raised p-3">
                          <RunDetail run={run} measurements={history.measurements} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunDetail({
  run,
  measurements,
}: {
  run: RunRecord;
  measurements: TestMeasurement[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {run.nodes.map((node) => {
        const test = measurements.find(
          (item) => item.node === node.nodeId && item.modelVersion === node.result?.label,
        );
        const result = node.result;
        return (
          <div key={node.runDir}>
            <p className="text-foreground">
              {node.nodeName}{" "}
              <span className="text-muted">
                (reports as {node.reportedName ?? "unknown"}) · {node.runDir}
              </span>
            </p>
            <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
              <Fact name="Train / validation samples" value={`${node.trainSamples ?? "?"} / ${node.valSamples ?? "?"}`} />
              <Fact
                name="Trained on"
                value={
                  node.humanOnly === true
                    ? "Human-reviewed labels only"
                    : node.humanOnly === false
                      ? "All labels, machine included: a pipeline test, not evidence"
                      : "Not recorded (before provenance existed): not evidence"
                }
              />
              <Fact
                name="Labels on node, reviewed / machine"
                value={`${node.labelsReviewed ?? "?"} / ${node.labelsMachine ?? "?"}`}
              />
              <Fact name="Exit code" value={node.exitCode ?? "none"} />
              <Fact name="Gate decision" value={gateText(node)} />
              <Fact name="Gate reason" value={result?.reason ?? "none"} />
              <Fact name="Gate validation size" value={result?.val_samples ?? "?"} />
              <Fact name="Model version after" value={result?.label ?? "unchanged"} />
              <Fact
                name="Balanced accuracy, live to candidate"
                value={`${fixed(result?.current?.balanced_accuracy)} to ${fixed(result?.candidate?.balanced_accuracy)}`}
              />
              <Fact
                name="Loss on validation, live to candidate"
                value={`${fixed(result?.current?.loss)} to ${fixed(result?.candidate?.loss)}`}
              />
              <Fact
                name="Anomaly recall, live to candidate"
                value={`${fixed(result?.current?.anomaly_recall)} to ${fixed(result?.candidate?.anomaly_recall)}`}
              />
              <Fact name="Training loss" value={NOT_REPORTED} />
              <Fact name="Per-class recall" value={NOT_REPORTED} />
              <Fact
                name="Test-set anomaly precision"
                value={test && test.tp + test.fp > 0 ? `${pct(test.tp / (test.tp + test.fp))}, n=${test.tp + test.fp}` : "None"}
              />
              <Fact
                name="Test-set false alarm rate"
                value={test && test.fp + test.tn > 0 ? `${pct(test.fp / (test.fp + test.tn))}, n=${test.fp + test.tn}` : "None"}
              />
            </dl>
          </div>
        );
      })}

      {run.serverRounds.map((round) => (
        <div key={round.key} className="text-[11px]">
          <p className="text-foreground">
            Server round {round.round_num} · {round.num_clients} clients ·{" "}
            {round.duration_seconds.toFixed(1)} s · server version {round.model_version}
          </p>
          {round.aggregation?.detail?.length ? (
            <ul className="mt-1">
              {round.aggregation.detail.map((item, index) => (
                <li key={`${item.node_id}${index}`} className="text-muted">
                  <span className={item.accepted ? "text-accent" : "text-danger"}>
                    {item.accepted ? "✓ accepted" : "✕ rejected"}
                  </span>{" "}
                  <span className="text-foreground">{item.node_id}</span> · {item.reason}
                  {item.cosine !== null ? ` · cosine ${item.cosine}` : ""} · norm{" "}
                  {item.norm.toFixed(3)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No screening detail reported.</p>
          )}
          {round.aggregation?.note && (
            <p className="text-muted">Server note: {round.aggregation.note}</p>
          )}
        </div>
      ))}

      <p className="text-[11px] leading-relaxed text-muted">
        Training loss and per-class recall are not sent by the node or the
        server today, so they are left blank rather than estimated. The gate
        is scored on the node&apos;s own holdout, which reshuffles as labels are
        added, so compare runs using the test-set trends above instead.
      </p>
    </div>
  );
}

function Fact({ name, value }: { name: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{name}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
