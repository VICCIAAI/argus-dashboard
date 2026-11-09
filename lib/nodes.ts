import { API_BASE_URL } from "@/lib/config";

// The ARGUS cameras this dashboard can show.
//
// ARGUS_NODES is read server-side only, so the proxy can only ever reach
// a node listed here -- the node picked in the browser is an id into this
// list, never a URL, which keeps /api/argus from becoming an open relay:
//
//   ARGUS_NODES="Node A=http://10.0.0.140:8000,Node B=http://10.0.0.128:8000"
//
// Unset, the dashboard behaves as before: one node at
// NEXT_PUBLIC_API_BASE_URL.

export const NODE_COOKIE_NAME = "argus_node";

export interface NodeConfig {
  id: string;
  name: string;
  baseUrl: string;
}

/** What the browser is told about a node: no proxy-only details. */
export interface NodeOption {
  id: string;
  name: string;
  /** The node's /ws/events. The socket goes straight to the node. */
  wsUrl: string;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function configuredNodes(): NodeConfig[] {
  const raw = process.env.ARGUS_NODES?.trim();
  const nodes: NodeConfig[] = [];

  for (const entry of (raw ?? "").split(",")) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    const name = entry.slice(0, at).trim();
    const baseUrl = entry.slice(at + 1).trim().replace(/\/+$/, "");
    if (!name || !/^https?:\/\//.test(baseUrl)) continue;
    let id = slug(name) || `node-${nodes.length + 1}`;
    while (nodes.some((node) => node.id === id)) id += "-2";
    nodes.push({ id, name, baseUrl });
  }

  return nodes.length > 0
    ? nodes
    : [{ id: "node", name: "Node", baseUrl: API_BASE_URL }];
}

/** The node with this id, or the first one when the id is unknown. */
export function nodeById(id: string | null | undefined): NodeConfig {
  const nodes = configuredNodes();
  return nodes.find((node) => node.id === id) ?? nodes[0];
}

export function toOption(node: NodeConfig): NodeOption {
  return {
    id: node.id,
    name: node.name,
    wsUrl: node.baseUrl.replace(/^http/, "ws") + "/ws/events",
  };
}
