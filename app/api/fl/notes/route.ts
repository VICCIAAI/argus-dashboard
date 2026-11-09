import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { appendNote, latestNotes, readHistory, readNotes, serialized } from "@/lib/fl/store";
import {
  LABEL_NAMES,
  type LabelName,
  type NoteKind,
  type OperatorNote,
} from "@/lib/fl/types";
import { findNode, sessionCookieName } from "@/lib/nodeSessions";

// Operator decisions kept on this console: the held-back test set, skips,
// "not a real object", and an audit copy of labels sent to a node. Nothing
// here talks to a node.

export const dynamic = "force-dynamic";

const KINDS: NoteKind[] = ["train", "test", "skip", "not_object", "cleared"];

async function signedIn(nodeId: string): Promise<boolean> {
  return (await cookies()).has(sessionCookieName(nodeId));
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("node") ?? "";
  if (!findNode(id)) {
    return NextResponse.json({ error: "Unknown node" }, { status: 404 });
  }
  if (!(await signedIn(id))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [notes, history] = await Promise.all([readNotes(id), readHistory()]);
  return NextResponse.json({
    notes: [...latestNotes(notes).values()],
    frozenAt: history.testSets[id]?.frozenAt ?? null,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<OperatorNote> | null;
  const id = body?.node ?? "";
  if (!body || !findNode(id)) {
    return NextResponse.json({ error: "Unknown node" }, { status: 404 });
  }
  if (!(await signedIn(id))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (
    typeof body.n !== "number" ||
    !KINDS.includes(body.kind as NoteKind) ||
    (body.label !== undefined && !LABEL_NAMES.includes(body.label as LabelName))
  ) {
    return NextResponse.json({ error: "Bad note" }, { status: 422 });
  }

  return serialized(async () => {
    const [history, notes] = await Promise.all([readHistory(), readNotes(id)]);
    const current = latestNotes(notes).get(body.n as number);
    const frozen = Boolean(history.testSets[id]?.frozenAt);
    const touchesTest = body.kind === "test" || current?.kind === "test";
    // A frozen set must stay the same set, or two runs were scored on
    // different events and cannot be compared.
    if (frozen && touchesTest) {
      return NextResponse.json({ error: "Test set is frozen" }, { status: 409 });
    }

    await appendNote({
      node: id,
      n: body.n as number,
      kind: body.kind as NoteKind,
      label: body.label,
      detector: body.detector,
      queue: body.queue,
      at: Date.now() / 1000,
    });
    return NextResponse.json({ ok: true });
  });
}
