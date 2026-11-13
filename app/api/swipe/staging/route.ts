import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { findNode, sessionCookieName } from "@/lib/nodeSessions";
import { readState, serialized, writeState } from "@/lib/swipe/store";

// Staging mode: the team acts out suspicious behaviour in front of one node
// and everything it records meanwhile is labelled anomaly, provenance
// staged. This route only keeps the sessions (start and stop on this
// server's clock); the dashboard writes the labels through the node's own
// label route as events arrive and once more on stop.

export const dynamic = "force-dynamic";

/** A session left on by accident stops counting after this long. */
const MAX_SESSION_S = 30 * 60;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    node?: string;
    action?: "start" | "stop" | "tagged";
    by?: string;
    session?: string;
    tagged?: number[];
  } | null;
  const nodeId = body?.node ?? "";
  if (!body || !findNode(nodeId)) {
    return NextResponse.json({ error: "Unknown node" }, { status: 404 });
  }
  if (!(await cookies()).has(sessionCookieName(nodeId))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return serialized(async () => {
    const state = await readState();
    const now = Date.now() / 1000;
    // Close anything that ran past the cap.
    for (const s of state.staging) {
      if (s.stop === null && now - s.start > MAX_SESSION_S) s.stop = s.start + MAX_SESSION_S;
    }
    const open = state.staging.find((s) => s.node === nodeId && s.stop === null);

    if (body.action === "start") {
      if (open) return NextResponse.json({ session: open });
      const session = {
        id: randomUUID().slice(0, 8),
        node: nodeId,
        start: now,
        stop: null,
        by: String(body.by ?? "").slice(0, 40) || "unknown",
        tagged: [],
      };
      state.staging.push(session);
      await writeState(state);
      return NextResponse.json({ session });
    }

    if (body.action === "stop") {
      if (!open) return NextResponse.json({ session: null });
      open.stop = now;
      await writeState(state);
      return NextResponse.json({ session: open });
    }

    if (body.action === "tagged") {
      const session = state.staging.find((s) => s.id === body.session && s.node === nodeId);
      if (!session || !Array.isArray(body.tagged)) {
        return NextResponse.json({ error: "Unknown session" }, { status: 404 });
      }
      const merged = new Set(session.tagged);
      for (const n of body.tagged) if (Number.isInteger(n)) merged.add(n);
      session.tagged = [...merged].sort((a, b) => a - b);
      await writeState(state);
      return NextResponse.json({ session });
    }

    return NextResponse.json({ error: "Bad action" }, { status: 422 });
  });
}
