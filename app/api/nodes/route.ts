import { NextResponse } from "next/server";
import { configuredNodes, NODE_COOKIE_NAME, toOption } from "@/lib/nodes";
import { selectedNode } from "@/lib/selectedNode";

// The node picker's API: GET lists the configured nodes and which one
// this browser is on; POST switches. The choice is a cookie holding an
// id from ARGUS_NODES, so the proxy never trusts a URL from the browser.

export const dynamic = "force-dynamic";

export async function GET() {
  const selected = await selectedNode();
  return NextResponse.json({
    nodes: configuredNodes().map(toOption),
    selected: selected.id,
  });
}

export async function POST(request: Request) {
  let id: unknown;
  try {
    id = (await request.json()).id;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const node = configuredNodes().find((candidate) => candidate.id === id);
  if (!node) {
    return NextResponse.json({ error: `Unknown node: ${String(id)}` }, { status: 404 });
  }

  const response = NextResponse.json({ selected: node.id });
  response.cookies.set(NODE_COOKIE_NAME, node.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
