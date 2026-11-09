"use client";

import { useCallback, useEffect, useState } from "react";
import type { NodeOption } from "@/lib/nodes";

interface NodesResponse {
  nodes: NodeOption[];
  selected: string;
}

/** The configured nodes and the one this browser is on (GET /api/nodes). */
export async function fetchNodes(): Promise<NodesResponse | null> {
  try {
    const res = await fetch("/api/nodes", { cache: "no-store" });
    return res.ok ? ((await res.json()) as NodesResponse) : null;
  } catch {
    return null;
  }
}

export function useNodes() {
  const [data, setData] = useState<NodesResponse | null>(null);
  const [switching, setSwitching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchNodes().then((result) => {
      if (cancelled) return;
      setData(result);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Switch nodes. Every page, the camera stream and the event socket were
   * opened against the old node, so a full reload is the one switch that
   * cannot leave a stale stream or socket behind.
   */
  const select = useCallback(async (id: string) => {
    setSwitching(true);
    const res = await fetch("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      setSwitching(false);
    }
  }, []);

  return {
    nodes: data?.nodes ?? [],
    selected: data?.selected ?? null,
    loaded,
    switching,
    select,
  };
}
