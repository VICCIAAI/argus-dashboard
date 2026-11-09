import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSessionCookie } from "@/lib/nodeSessions";

// Reads the HttpOnly cookies server-side and reports auth state — the
// client never touches a raw token. Real nodes issue opaque tokens with
// no readable expiry, so those count until the cookie lapses and the node
// itself says otherwise (the proxy passes its 401 back). A JWT, as the
// mock backend issues, is only decoded to check expiry; verifying its
// signature needs the backend's secret, which the frontend doesn't have.
function isExpired(token: string): boolean {
  if (token.split(".").length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8"),
    );
    if (typeof payload.exp !== "number") return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export async function GET() {
  const authenticated = (await cookies())
    .getAll()
    .some((cookie) => isSessionCookie(cookie.name) && !isExpired(cookie.value));

  return NextResponse.json({ authenticated });
}
