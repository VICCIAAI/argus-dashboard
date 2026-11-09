import { NextRequest, NextResponse } from "next/server";
import { NODE_COOKIE_NAME, nodeById } from "@/lib/nodes";
import { isSessionCookie, sessionCookieName } from "@/lib/nodeSessions";

// Reads the HttpOnly session cookies server-side to gate protected routes.
// The side-by-side view at /dashboard opens with a session on any node,
// and each panel asks for the rest. The single-node pages under it show
// the picked node, so they need a session on that one.
const PROTECTED_PREFIXES = ["/dashboard"];

// These pages cover several nodes and ask for each node's sign-in themselves.
const MULTI_NODE_PAGES = new Set([
  "/dashboard",
  "/dashboard/label",
  "/dashboard/federated",
]);

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!isProtected) return NextResponse.next();

  const hasSession =
    MULTI_NODE_PAGES.has(request.nextUrl.pathname)
      ? request.cookies.getAll().some((cookie) => isSessionCookie(cookie.name))
      : request.cookies.has(
          sessionCookieName(
            nodeById(request.cookies.get(NODE_COOKIE_NAME)?.value).id,
          ),
        );

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
