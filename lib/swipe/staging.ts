import { fetchSamples, writeLabel } from "@/lib/api";
import { isReviewed } from "@/lib/fl/review";
import type { OperatorNote } from "@/lib/fl/types";
import { appendLedger, stagingAction } from "@/lib/swipe/client";
import type { StagingSession } from "@/lib/swipe/types";

// Labels everything a node recorded during a staging session as anomaly,
// provenance staged. Runs from the dashboard while the session is on and
// once more when it stops. Skips test-set events and anything a person
// already reviewed, and never labels the same event twice.

/** Node and console clocks can disagree a little. */
const CLOCK_PAD_S = 2;

async function testSet(nodeId: string): Promise<Set<number>> {
  const res = await fetch(`/api/fl/notes?node=${encodeURIComponent(nodeId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not read the test set (${res.status})`);
  const body = (await res.json()) as { notes: OperatorNote[] };
  return new Set(body.notes.filter((note) => note.kind === "test").map((note) => note.n));
}

export async function applyStaging(
  session: StagingSession,
  reviewer: string,
): Promise<{ tagged: number; failed: number }> {
  const [samples, held] = await Promise.all([
    fetchSamples(session.node, 400),
    testSet(session.node),
  ]);
  const start = session.start - CLOCK_PAD_S;
  const stop = (session.stop ?? Date.now() / 1000) + CLOCK_PAD_S;
  const done = new Set(session.tagged);
  const targets = samples.samples.filter(
    (row) =>
      row.n !== null &&
      !row.meta.synthetic &&
      row.t >= start &&
      row.t <= stop &&
      !done.has(row.n) &&
      !held.has(row.n) &&
      !isReviewed(row),
  );

  const tagged: number[] = [];
  let failed = 0;
  let echoed = true;
  for (const row of targets) {
    try {
      const result = await writeLabel(session.node, row.n as number, "anomaly", false, {
        kind: "staged",
        via: `staging:${session.id}`,
        reviewer: reviewer || session.by,
      });
      if (!result.provenance) echoed = false;
      tagged.push(row.n as number);
    } catch {
      failed += 1;
    }
  }

  if (tagged.length > 0) {
    await stagingAction({ node: session.node, action: "tagged", session: session.id, tagged });
    await appendLedger(
      tagged.map((n) => ({
        node: session.node,
        n,
        label: "anomaly" as const,
        source: "staged" as const,
        reviewer: reviewer || session.by,
        via: `staging:${session.id}`,
        nodeProvenance: echoed,
      })),
    ).catch(() => undefined);
  }
  return { tagged: tagged.length, failed };
}
