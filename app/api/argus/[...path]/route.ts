import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL, AUTH_COOKIE_NAME } from "@/lib/config";

// Server-side proxy to the ARGUS node's API.
//
// The JWT lives in an HttpOnly cookie on *this* origin, so client-side
// fetches to the backend origin never carry it — against the real node
// (every route there sits behind `require_auth`) that's a 401, and the
// mock backend only hid the problem by not checking. Everything the
// browser needs goes through here instead: same-origin request in,
// cookie read server-side, `Authorization: Bearer` added on the way
// out. The token still never reaches client JS.
//
// `/api/argus/<suffix>` maps to `<backend>/api/<suffix>`, allowlisted
// below — this is a proxy to specific endpoints, not an open relay to
// anything on the node.

const GET_ALLOWED = [
  /^status$/,
  /^events$/,
  /^events\/\d+\/snapshot$/,
  /^camera\/snapshot$/,
  /^camera\/stream$/,
];

const POST_ALLOWED = [/^events\/\d+\/label$/];

// The MJPEG stream is an open-ended response; nothing here may be cached
// or buffered into a static payload.
export const dynamic = "force-dynamic";

async function bearer(): Promise<string | null> {
  return (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

function forbidden(suffix: string) {
  return NextResponse.json(
    { error: `Path not proxied: /api/${suffix}` },
    { status: 403 },
  );
}

function unreachable() {
  return NextResponse.json(
    { error: `Cannot reach backend at ${API_BASE_URL}` },
    { status: 502 },
  );
}

/** Pass the upstream response straight through, body included. */
function passthrough(upstream: Response): NextResponse {
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "content-disposition"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Streams must not be buffered by an intermediary, or the first frame
  // only lands once the camera stops.
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/argus/[...path]">,
) {
  const suffix = (await ctx.params).path.join("/");
  if (!GET_ALLOWED.some((pattern) => pattern.test(suffix))) {
    return forbidden(suffix);
  }

  const token = await bearer();
  if (!token) return unauthorized();

  const query = request.nextUrl.search;

  try {
    const upstream = await fetch(`${API_BASE_URL}/api/${suffix}${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      // The browser closing the <img> should tear the camera stream down
      // rather than leave it running against the node.
      signal: request.signal,
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch {
    return unreachable();
  }
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/argus/[...path]">,
) {
  const suffix = (await ctx.params).path.join("/");
  if (!POST_ALLOWED.some((pattern) => pattern.test(suffix))) {
    return forbidden(suffix);
  }

  const token = await bearer();
  if (!token) return unauthorized();

  const body = await request.text();

  try {
    const upstream = await fetch(`${API_BASE_URL}/api/${suffix}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: request.signal,
      cache: "no-store",
    });
    return passthrough(upstream);
  } catch {
    return unreachable();
  }
}
