"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useEventFeed } from "@/hooks/useEventFeed";
import { StatusStrip } from "@/components/StatusStrip";
import { DashboardNav } from "@/components/DashboardNav";
import { FeedModeBadge } from "@/components/FeedModeBadge";
import { LiveFeed } from "@/components/LiveFeed";
import { EventList } from "@/components/EventList";
import { EventDetailPanel } from "@/components/EventDetailPanel";

// The camera and what the node is making of it, side by side — the view
// the demo runs on. Detection happens on the node; this page only shows
// the frames and the derived events, never stores either.
export default function LivePage() {
  const { status } = useAuth();
  const router = useRouter();
  const { events, mode, error, applyLabel } = useEventFeed();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center">
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          {status === "loading" ? "Checking session…" : "Redirecting…"}
        </p>
      </div>
    );
  }

  const alertCount = events.filter(
    (event) => event.status === "stranger" && !event.confirmed,
  ).length;
  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;
  // The stream is a wall of motion; the last few events are what says
  // whether the node is actually detecting anything in it.
  const recent = events.slice(0, 8);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col px-6 py-6">
      <DashboardNav title="Live feed" alertCount={alertCount} />

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <StatusStrip />
        </div>
        <FeedModeBadge mode={mode} />
      </div>

      {error && (
        <div className="mb-6 rounded border border-danger/30 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-h-[420px] flex-col gap-6">
          <LiveFeed />
          <div className="min-h-[220px] flex-1">
            <EventList
              events={recent}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        <div className="flex min-h-[420px] flex-col gap-4">
          <EventDetailPanel event={selectedEvent} onLabel={applyLabel} />
          <Link
            href="/dashboard/alerts"
            className="rounded border border-border bg-surface px-4 py-3 text-center font-mono text-[11px] tracking-[0.2em] text-muted uppercase transition-colors hover:border-accent hover:text-foreground"
          >
            {alertCount > 0 ? `Review ${alertCount} alerts` : "Alerts feed"}
          </Link>
        </div>
      </div>
    </div>
  );
}
