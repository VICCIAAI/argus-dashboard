"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useNodes } from "@/hooks/useNodes";
import { DashboardNav } from "@/components/DashboardNav";
import { NodePanel } from "@/components/NodePanel";

// Every configured node on one screen. The single-node pages (live,
// alerts, thermal) still follow the node picker; this one ignores it.
export default function DashboardPage() {
  const { status } = useAuth();
  const router = useRouter();
  const { nodes, selected, loaded } = useNodes();
  const [alertCounts, setAlertCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const reportAlerts = useCallback((nodeId: string, count: number) => {
    setAlertCounts((prev) =>
      prev[nodeId] === count ? prev : { ...prev, [nodeId]: count },
    );
  }, []);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          {status === "loading" ? "Checking session…" : "Redirecting…"}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex min-h-screen w-full flex-1 flex-col px-6 py-6 ${
        nodes.length > 1 ? "max-w-[1800px]" : "max-w-6xl"
      }`}
    >
      {/* The Alerts tab opens the picked node, so its badge counts that node. */}
      <DashboardNav
        title="Security console"
        alertCount={selected ? alertCounts[selected] : undefined}
      />

      {nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-xs tracking-widest text-muted uppercase">
            {loaded ? "Could not load the node list" : "Loading nodes…"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-start gap-4">
          {nodes.map((node) => (
            <NodePanel key={node.id} node={node} onAlertCount={reportAlerts} />
          ))}
        </div>
      )}
    </div>
  );
}
