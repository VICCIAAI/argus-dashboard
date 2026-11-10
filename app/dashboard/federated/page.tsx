"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardNav } from "@/components/DashboardNav";
import { PreflightPanel, DetectorQualityPanel } from "@/components/fl/PreflightPanel";
import { RunHistory } from "@/components/fl/RunHistory";
import { TrendChart, type TrendSeries } from "@/components/fl/TrendChart";
import { useAuth } from "@/hooks/useAuth";
import { AMBER } from "@/lib/format";
import { pct, trendVerdict, wilson, type TrendKind, type CountPoint } from "@/lib/fl/stats";
import type {
  HistoryFile,
  HistoryResponse,
  PreflightResponse,
  RunRecord,
  TestMeasurement,
} from "@/lib/fl/types";

const NODE_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const HISTORY_POLL_MS = 15_000;
const PREFLIGHT_POLL_MS = 30_000;

type Rate = "recall" | "falseAlarm" | "precision";

function rateCounts(item: TestMeasurement, rate: Rate): { k: number; n: number } {
  if (rate === "recall") return { k: item.tp, n: item.tp + item.fn };
  if (rate === "falseAlarm") return { k: item.fp, n: item.fp + item.tn };
  return { k: item.tp, n: item.tp + item.fp };
}

/** One measurement per model version per node, the newest of each, oldest first. */
function perVersion(history: HistoryFile, nodeId: string): TestMeasurement[] {
  const latest = new Map<string, TestMeasurement>();
  for (const item of history.measurements) {
    if (item.node === nodeId) latest.set(item.modelVersion, item);
  }
  return [...latest.values()].sort((a, b) => a.at - b.at);
}

function realRuns(history: HistoryFile): RunRecord[] {
  return history.runs.filter(
    (run) => !run.nodes.some((node) => (node.syntheticRows ?? 0) > 0),
  );
}

const VERDICT_STYLE: Record<TrendKind, { icon: string; color: string }> = {
  none: { icon: "·", color: "var(--muted)" },
  "too-few": { icon: "·", color: "var(--muted)" },
  unclear: { icon: "–", color: AMBER },
  flat: { icon: "–", color: AMBER },
  improving: { icon: "▲", color: "var(--accent)" },
  regressing: { icon: "▼", color: "var(--danger)" },
};

export default function FederatedPage() {
  const { status } = useAuth();
  const router = useRouter();
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [measureNote, setMeasureNote] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/fl/history", { cache: "no-store" }).catch(() => null);
    if (!res) return;
    const body = await res.json().catch(() => null);
    if (res.ok && body) {
      setHistoryData(body as HistoryResponse);
      setProblem(null);
    } else {
      setProblem(body?.error ?? `History failed (${res.status})`);
    }
  }, []);

  const loadPreflight = useCallback(async () => {
    const res = await fetch("/api/fl/preflight", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setPreflight((await res.json()) as PreflightResponse);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const tick = () => {
      void loadHistory();
    };
    tick();
    const timer = setInterval(tick, HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [status, loadHistory]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const tick = () => {
      void loadPreflight();
    };
    tick();
    const timer = setInterval(tick, PREFLIGHT_POLL_MS);
    return () => clearInterval(timer);
  }, [status, loadPreflight]);

  const history = historyData?.history;
  const nodes = useMemo(() => preflight?.nodes ?? [], [preflight]);

  const testCharts = useMemo(() => {
    if (!history) return null;
    const allMeasurements = nodes.map((node) => perVersion(history, node.id));
    const maxPoints = Math.max(0, ...allMeasurements.map((list) => list.length));
    const xLabels = Array.from({ length: maxPoints }, (_, index) =>
      index === 0 ? "Baseline" : `Model ${index}`,
    );
    const build = (rate: Rate): TrendSeries[] =>
      nodes.map((node, index) => ({
        id: node.id,
        name: node.name,
        color: NODE_COLORS[index % NODE_COLORS.length],
        points: allMeasurements[index]
          .map((item, x) => {
            const { k, n } = rateCounts(item, rate);
            const range = wilson(k, n);
            return range
              ? { x, y: range.p, low: range.low, high: range.high, n, note: item.modelVersion }
              : null;
          })
          .filter((point) => point !== null),
      }));
    return {
      xLabels,
      recall: build("recall"),
      falseAlarm: build("falseAlarm"),
      precision: build("precision"),
    };
  }, [history, nodes]);

  const gate = useMemo(() => {
    if (!history) return [];
    const runs = realRuns(history);
    return nodes.map((node) => {
      const entries = runs.flatMap((run) =>
        run.nodes
          .filter((item) => item.nodeId === node.id && item.result?.candidate)
          .map((item) => ({ run, item })),
      );
      const xLabels = entries.map((_, index) => `Run ${index + 1}`);
      const series: TrendSeries[] = [
        {
          id: "live",
          name: "Live model",
          color: "var(--muted)",
          points: entries.flatMap(({ item }, x) =>
            item.result?.current
              ? [
                  {
                    x,
                    y: item.result.current.balanced_accuracy,
                    n: item.result.val_samples,
                  },
                ]
              : [],
          ),
        },
        {
          id: "candidate",
          name: "Candidate",
          color: "var(--series-1)",
          points: entries.map(({ item }, x) => ({
            x,
            y: item.result!.candidate!.balanced_accuracy,
            n: item.result!.val_samples,
          })),
        },
      ];
      return { node, xLabels, series };
    });
  }, [history, nodes]);

  const verdicts = useMemo(() => {
    if (!history) return [];
    return nodes.map((node) => {
      const list = perVersion(history, node.id);
      const points = (rate: Rate): CountPoint[] =>
        list.map((item) => ({ name: item.modelVersion, ...rateCounts(item, rate) }));
      return {
        node,
        recall: trendVerdict(points("recall"), true),
        falseAlarm: trendVerdict(points("falseAlarm"), false),
      };
    });
  }, [history, nodes]);

  const measure = useCallback(
    async (nodeId: string) => {
      setMeasureNote(null);
      const res = await fetch("/api/fl/testset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: nodeId, action: "measure" }),
      });
      const body = await res.json().catch(() => ({}));
      setMeasureNote(res.ok ? "Measured." : (body.error ?? "Could not measure."));
      await loadHistory();
    },
    [loadHistory],
  );

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          {status === "loading" ? "Checking session…" : "Redirecting…"}
        </p>
      </div>
    );
  }

  const noRounds = (history?.runs.length ?? 0) === 0;
  const lastMeasurement = (nodeId: string) =>
    history ? perVersion(history, nodeId).at(-1) : undefined;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6">
      <DashboardNav title="Federated learning" />

      <p className="font-mono text-[11px] leading-relaxed text-muted">
        Rounds train the anomaly head, which judges whether a detection is
        routine for this site. They do not change YOLO or its bounding boxes.
        Real data only: synthetic rows are excluded, and the Nov 8 simulation is
        not shown. Only a round trained on human-reviewed labels counts as
        evidence. Others are pipeline tests, because a label from a rule on an
        input feature can only teach the head that rule.
      </p>

      {problem && (
        <div className="rounded border border-danger/30 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          {problem}
        </div>
      )}

      {preflight ? (
        <PreflightPanel data={preflight} />
      ) : (
        <p className="rounded border border-border bg-surface p-6 font-mono text-xs text-muted">
          Reading the nodes and the Flower server…
        </p>
      )}

      <section className="rounded border border-border bg-surface p-4 font-mono text-xs">
        <h2 className="font-sans text-sm font-medium text-foreground">
          Is it improving?
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Judged only on each node&apos;s frozen test set: events labelled on
          this console and never sent to the node, so no round has trained on
          them. It says improving or regressing only when the 95% ranges stop
          overlapping.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {verdicts.map(({ node, recall, falseAlarm }) => (
            <li key={node.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="w-20 text-foreground">{node.name}</span>
              <Verdict name="Anomaly recall" kind={recall.kind} text={recall.text} />
              <Verdict name="False alarms" kind={falseAlarm.kind} text={falseAlarm.text} />
              {(node.testSet.frozenAt ? true : false) && (
                <button
                  type="button"
                  onClick={() => measure(node.id)}
                  className="text-[11px] text-accent underline-offset-2 hover:underline"
                >
                  Measure now
                </button>
              )}
              {lastMeasurement(node.id) && (
                <span className="text-[11px] text-muted">
                  Latest on {lastMeasurement(node.id)!.modelVersion}
                  {lastMeasurement(node.id)!.contaminated > 0 &&
                    `, ${lastMeasurement(node.id)!.contaminated} excluded as labelled on node`}
                </span>
              )}
            </li>
          ))}
        </ul>
        {measureNote && <p className="mt-2 text-[11px] text-accent">{measureNote}</p>}
      </section>

      {testCharts && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendChart
            title="Anomaly recall"
            subtitle="Share of real anomalies the live head flagged. Frozen test set. Bars show the 95% range; hollow dots have fewer than 10 events."
            xLabels={testCharts.xLabels}
            series={testCharts.recall}
            format={pct}
          />
          <TrendChart
            title="False alarm rate"
            subtitle="Share of routine events flagged as anomalies. Frozen test set. Lower is better."
            xLabels={testCharts.xLabels}
            series={testCharts.falseAlarm}
            format={pct}
          />
          <TrendChart
            title="Anomaly precision"
            subtitle="Of the events flagged, the share that really were anomalies. Frozen test set, which holds more anomalies than real life, so this reads high."
            xLabels={testCharts.xLabels}
            series={testCharts.precision}
            format={pct}
          />
        </div>
      )}

      {gate.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">
            Validation gate, per node
          </h2>
          <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted">
            Candidate against live on the node&apos;s own holdout. Read within
            one run: the holdout reshuffles when labels are added, so scores in
            different runs are not on the same events.
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            {gate.map(({ node, xLabels, series }) => (
              <TrendChart
                key={node.id}
                title={node.name}
                subtitle="Balanced accuracy, live and candidate."
                xLabels={xLabels}
                series={series}
                format={(value) => value.toFixed(2)}
              />
            ))}
          </div>
        </div>
      )}

      {history && <RunHistory history={history} />}

      {preflight && <DetectorQualityPanel data={preflight} />}

      <p className="font-mono text-[11px] text-muted">
        {historyData ? `History is saved in ${historyData.dataDir}. ` : ""}
        Keep this page open during a round so each result is copied there as
        soon as it appears.
        {noRounds ? " No live round yet." : ""}
      </p>
    </div>
  );
}

function Verdict({
  name,
  kind,
  text,
}: {
  name: string;
  kind: TrendKind;
  text: string;
}) {
  const style = VERDICT_STYLE[kind];
  return (
    <span className="text-[11px] text-muted">
      {name}:{" "}
      <span aria-hidden style={{ color: style.color }}>
        {style.icon}
      </span>{" "}
      <span className="text-foreground">{text}</span>
    </span>
  );
}
