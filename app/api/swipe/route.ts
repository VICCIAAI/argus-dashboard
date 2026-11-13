import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { findNode, isSessionCookie, sessionCookieName } from "@/lib/nodeSessions";
import { reviewerStats, effectiveEntries } from "@/lib/swipe/stats";
import { readLedger, readState, serialized, writeState } from "@/lib/swipe/store";
import type { DateWindow, SwipeSettings, TrainingRule } from "@/lib/swipe/types";

// Swipe page state: settings, staging sessions, the reviewer's score and
// streak, and what this console already decided for a node. Nothing here
// talks to a node.

export const dynamic = "force-dynamic";

async function anySession(): Promise<boolean> {
  return (await cookies()).getAll().some((cookie) => isSessionCookie(cookie.name));
}

export async function GET(request: NextRequest) {
  if (!(await anySession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const nodeId = request.nextUrl.searchParams.get("node");
  const reviewer = (request.nextUrl.searchParams.get("reviewer") ?? "").slice(0, 40);
  if (nodeId && !findNode(nodeId)) {
    return NextResponse.json({ error: "Unknown node" }, { status: 404 });
  }

  const [state, ledger] = await Promise.all([readState(), readLedger()]);
  let decided: { n: number; label: string | null; at: number; source: string }[] = [];
  if (nodeId) {
    if (!(await cookies()).has(sessionCookieName(nodeId))) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Latest entry in force per event on this node.
    const latest = new Map<number, (typeof decided)[number]>();
    for (const entry of effectiveEntries(ledger)) {
      if (entry.node !== nodeId) continue;
      latest.set(entry.n, { n: entry.n, label: entry.label, at: entry.at, source: entry.source });
    }
    decided = [...latest.values()];
  }

  return NextResponse.json({
    settings: state.settings,
    staging: state.staging,
    stats: reviewer ? reviewerStats(ledger, reviewer, state.settings.streakMin) : null,
    decided,
  });
}

const WINDOWS: DateWindow[] = ["first", "home", "all"];
const RULES: TrainingRule[] = ["pending", "first-only", "include-home"];

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

/** Change settings. Only known fields, each range-checked. */
export async function POST(request: NextRequest) {
  if (!(await anySession())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Partial<SwipeSettings> | null;
  if (!body) return NextResponse.json({ error: "Bad settings" }, { status: 422 });

  return serialized(async () => {
    const state = await readState();
    const next = { ...state.settings };
    const goal = clampNumber(body.dailyGoal, 10, 2000);
    if (goal !== undefined) next.dailyGoal = Math.round(goal);
    const streakMin = clampNumber(body.streakMin, 1, 2000);
    if (streakMin !== undefined) next.streakMin = Math.round(streakMin);
    const threshold = clampNumber(body.autoThreshold, 0.5, 0.999);
    if (threshold !== undefined) next.autoThreshold = threshold;
    const randomShare = clampNumber(body.randomShare, 0, 0.5);
    if (randomShare !== undefined) next.randomShare = randomShare;
    const spotShare = clampNumber(body.spotShare, 0, 0.5);
    if (spotShare !== undefined) next.spotShare = spotShare;
    if (body.window && WINDOWS.includes(body.window)) next.window = body.window;
    if (body.trainingRule && RULES.includes(body.trainingRule)) {
      next.trainingRule = body.trainingRule;
    }
    state.settings = next;
    await writeState(state);
    return NextResponse.json({ settings: next });
  });
}
