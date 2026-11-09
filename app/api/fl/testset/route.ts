import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getJson, measureNode } from "@/lib/fl/capture";
import {
  latestNotes,
  readHistory,
  readNotes,
  serialized,
  writeHistory,
} from "@/lib/fl/store";
import type { SampleStats } from "@/lib/fl/types";
import { findNode, sessionCookieName } from "@/lib/nodeSessions";

// Freeze a node's held-back test set and score its live head on it. Both
// are console-side: the only node traffic is GET /api/status and /api/events.

export const dynamic = "force-dynamic";

/** Below these the set is too small to say anything, so freezing is refused. */
const MIN_TEST_ITEMS = 20;
const MIN_TEST_ANOMALIES = 5;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    node?: string;
    action?: string;
  } | null;
  const node = findNode(body?.node ?? "");
  if (!node) return NextResponse.json({ error: "Unknown node" }, { status: 404 });

  const jar = await cookies();
  const token = jar.get(sessionCookieName(node.id))?.value ?? null;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const status = await getJson<{
    model_version?: string;
    samples?: SampleStats | null;
  }>(`${node.baseUrl}/api/status`, token, 6_000);
  if (!status.ok || !status.data?.model_version) {
    return NextResponse.json(
      { error: `Cannot read ${node.name} (${status.error ?? "no version"})` },
      { status: 502 },
    );
  }
  const version = status.data.model_version;
  const total = status.data.samples?.total ?? 0;

  return serialized(async () => {
    const history = await readHistory();

    if (body?.action === "freeze") {
      if (history.testSets[node.id]?.frozenAt) {
        return NextResponse.json({ error: "Already frozen" }, { status: 409 });
      }
      const items = [...latestNotes(await readNotes(node.id)).values()].filter(
        (note) => note.kind === "test",
      );
      const anomalies = items.filter((note) => note.label === "anomaly").length;
      if (items.length < MIN_TEST_ITEMS || anomalies < MIN_TEST_ANOMALIES) {
        return NextResponse.json(
          {
            error: `Needs at least ${MIN_TEST_ITEMS} events and ${MIN_TEST_ANOMALIES} anomalies (have ${items.length} and ${anomalies})`,
          },
          { status: 409 },
        );
      }
      history.testSets[node.id] = { frozenAt: Date.now() / 1000 };
    } else if (body?.action !== "measure") {
      return NextResponse.json({ error: "Unknown action" }, { status: 422 });
    } else if (!history.testSets[node.id]?.frozenAt) {
      return NextResponse.json(
        { error: "Freeze the test set first" },
        { status: 409 },
      );
    }

    // Freezing scores the baseline at once: the head on the node right now.
    const outcome = await measureNode(history, node, token, version, total);
    if (typeof outcome === "string") {
      if (body?.action === "freeze") await writeHistory(history);
      return NextResponse.json({ error: outcome }, { status: 502 });
    }
    await writeHistory(history);
    return NextResponse.json({ ok: true, measurement: outcome });
  });
}
