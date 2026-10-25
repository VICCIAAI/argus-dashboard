import { cookies } from "next/headers";
import { NODE_COOKIE_NAME, nodeById, type NodeConfig } from "@/lib/nodes";

/** The node this browser picked, for route handlers. Server-only. */
export async function selectedNode(): Promise<NodeConfig> {
  return nodeById((await cookies()).get(NODE_COOKIE_NAME)?.value);
}
