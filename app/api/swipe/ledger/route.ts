import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LABEL_NAMES, type LabelName } from "@/lib/fl/types";
import { findNode, sessionCookieName } from "@/lib/nodeSessions";
import { appendLedger, serialized } from "@/lib/swipe/store";
import type { LedgerEntry } from "@/lib/swipe/types";

// Append swipe decisions (and undos) to the console's ledger. Called after
// the node accepted the label, so the ledger never claims a label the node
// does not have.

export const dynamic = "force-dynamic";

const SOURCES = ["swipe", "staged"] as const;

function valid(entry: Partial<LedgerEntry>): entry is LedgerEntry {
  return (
    typeof entry.node === "string" &&
    typeof entry.n === "number" &&
    Number.isInteger(entry.n) &&
    (entry.label === null || LABEL_NAMES.includes(entry.label as LabelName)) &&
    SOURCES.includes(entry.source as (typeof SOURCES)[number]) &&
    typeof entry.reviewer === "string" &&
    typeof entry.via === "string"
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    entries?: Partial<LedgerEntry>[];
  } | null;
  const entries = body?.entries ?? [];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500) {
    return NextResponse.json({ error: "Bad entries" }, { status: 422 });
  }
  const jar = await cookies();
  const clean: LedgerEntry[] = [];
  for (const entry of entries) {
    if (!valid(entry) || !findNode(entry.node)) {
      return NextResponse.json({ error: "Bad entry" }, { status: 422 });
    }
    if (!jar.has(sessionCookieName(entry.node))) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    clean.push({
      node: entry.node,
      n: entry.n,
      label: entry.label,
      source: entry.source,
      reviewer: entry.reviewer.slice(0, 40),
      // Server time: phone clocks drift and the streak is by day.
      at: Date.now() / 1000,
      via: entry.via.slice(0, 40),
      ...(entry.group ? { group: String(entry.group).slice(0, 60) } : {}),
      ...(entry.undo ? { undo: true } : {}),
      ...(entry.nodeProvenance !== undefined
        ? { nodeProvenance: Boolean(entry.nodeProvenance) }
        : {}),
    });
  }
  await serialized(() => appendLedger(clean));
  return NextResponse.json({ ok: true, appended: clean.length });
}
