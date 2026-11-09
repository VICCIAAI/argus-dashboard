import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "@/lib/config";
import { isSessionCookie } from "@/lib/nodeSessions";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Every node's session, plus the single cookie older logins set.
  for (const { name } of (await cookies()).getAll()) {
    if (name === AUTH_COOKIE_NAME || isSessionCookie(name)) {
      response.cookies.delete(name);
    }
  }
  return response;
}
