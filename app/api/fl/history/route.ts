import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { capture } from "@/lib/fl/capture";
import { dataDir } from "@/lib/fl/store";
import type { HistoryResponse } from "@/lib/fl/types";
import { isSessionCookie } from "@/lib/nodeSessions";

// Reading the page is what records a round: each poll copies anything new
// from the aggregator and the nodes to disk (lib/fl/capture.ts, GET-only).

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  if (!jar.getAll().some((cookie) => isSessionCookie(cookie.name))) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { history, errors } = await capture();
    const body: HistoryResponse = { history, errors, dataDir: dataDir() };
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      {
        error: `History could not be read or saved: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      },
      { status: 500 },
    );
  }
}
