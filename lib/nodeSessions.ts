import { AUTH_COOKIE_NAME } from "@/lib/config";
import { configuredNodes, type NodeConfig } from "@/lib/nodes";

/** The node with exactly this id, or null. For ids sent by the browser. */
export function findNode(id: string): NodeConfig | null {
  return configuredNodes().find((node) => node.id === id) ?? null;
}

/**
 * Each node issues its own tokens and keeps them to itself, so a browser
 * holds one HttpOnly session cookie per node it has signed in to.
 */
export function sessionCookieName(nodeId: string): string {
  return `${AUTH_COOKIE_NAME}_${nodeId}`;
}

export function isSessionCookie(name: string): boolean {
  return name.startsWith(`${AUTH_COOKIE_NAME}_`);
}
