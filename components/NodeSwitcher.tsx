"use client";

import { useNodes } from "@/hooks/useNodes";

/**
 * Which camera the console is showing. Listed from ARGUS_NODES; with a
 * single node there is nothing to pick, so it renders as a plain label.
 */
export function NodeSwitcher() {
  const { nodes, selected, switching, select } = useNodes();

  if (nodes.length === 0) return null;

  const base =
    "rounded border border-border bg-surface px-3 py-2 font-mono text-xs tracking-[0.2em] uppercase";

  if (nodes.length === 1) {
    return <span className={`${base} text-muted`}>{nodes[0].name}</span>;
  }

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Node</span>
      <select
        value={selected ?? nodes[0].id}
        disabled={switching}
        onChange={(event) => void select(event.target.value)}
        className={`${base} text-foreground transition-colors hover:border-accent disabled:opacity-50`}
      >
        {nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.name}
          </option>
        ))}
      </select>
    </label>
  );
}
