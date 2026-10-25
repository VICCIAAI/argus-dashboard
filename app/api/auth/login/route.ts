import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_SECURE } from "@/lib/config";
import { selectedNode } from "@/lib/selectedNode";

// FLAG (per CLAUDE.md): POST /api/login currently returns
// { access_token } in the JSON body, not a Set-Cookie header. Until
// Mohammed's backend sets the HttpOnly cookie itself, this route
// handler does it instead — the token passes through this server only
// and is never exposed to client-side JS. Once the backend sets the
// cookie natively, this proxy can just forward the response.
export async function POST(request: Request) {
  const credentials = await request.json();
  // Each node signs its own tokens, so log in to the one being viewed.
  const node = await selectedNode();

  let backendRes: Response;
  try {
    backendRes = await fetch(`${node.baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
  } catch {
    return NextResponse.json(
      { error: `Cannot reach ${node.name} at ${node.baseUrl}` },
      { status: 502 },
    );
  }

  if (!backendRes.ok) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: backendRes.status },
    );
  }

  const data = await backendRes.json();
  const token: string | undefined = data.access_token;

  if (!token) {
    return NextResponse.json(
      { error: "Backend did not return an access_token" },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: AUTH_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8h, adjust once we know the backend's JWT exp
  });

  return response;
}
