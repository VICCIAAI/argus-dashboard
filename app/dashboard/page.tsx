"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useEventFeed } from "@/hooks/useEventFeed";
import { StatusStrip } from "@/components/StatusStrip";
import { DashboardNav } from "@/components/DashboardNav";
import { FeedModeBadge } from "@/components/FeedModeBadge";
import { EventList } from "@/components/EventList";
import { EventDetailPanel } from "@/components/EventDetailPanel";
import { TestOfflineToggle } from "@/components/dev/TestOfflineToggle"; // TEST ONLY — remove before final build

export default function DashboardPage() {
  const { status } = useAuth();
  const router = useRouter();
  // Events now arrive on /ws/events where the node supports it, falling
  // back to polling — the one-time fetch this page used to do is gone.
  const { events, mode, error, loading, applyLabel } = useEventFeed();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [simulateOffline, setSimulateOffline] = useState(false); // TEST ONLY — remove before final build

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

  const selectedEvent = events.find((event) => event.id === selectedId) ?? null;
  const alertCount = events.filter(
    (event) => event.status === "stranger" && !event.confirmed,
  ).length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col px-6 py-6">
      <DashboardNav title="Security console" alertCount={alertCount} />

      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <StatusStrip forceOffline={simulateOffline} />
        </div>
        <FeedModeBadge mode={simulateOffline ? "offline" : mode} />
        {/* TEST ONLY — remove before final build */}
        <TestOfflineToggle active={simulateOffline} onToggle={setSimulateOffline} />
      </div>

      {simulateOffline && (
        <div className="mb-6 rounded border border-danger/30 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          ⚠ Live connection lost — showing last known data only.
        </div>
      )}

      {error && (
        <div className="mb-6 rounded border border-danger/30 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          {error}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-h-[420px]">
          {loading ? (
            <div className="flex h-full items-center justify-center rounded border border-border bg-surface">
              <p className="font-mono text-xs tracking-widest text-muted uppercase">
                Loading events…
              </p>
            </div>
          ) : (
            <EventList
              events={events}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <div className="flex min-h-[420px] flex-col gap-4">
          <EventDetailPanel event={selectedEvent} onLabel={applyLabel} />
          <div className="grid grid-cols-2 gap-3">
            <Link
              href="/dashboard/live"
              className="rounded border border-border bg-surface px-4 py-3 text-center font-mono text-[11px] tracking-[0.2em] text-muted uppercase transition-colors hover:border-accent hover:text-foreground"
            >
              Live feed
            </Link>
            <Link
              href="/dashboard/alerts"
              className={`rounded border bg-surface px-4 py-3 text-center font-mono text-[11px] tracking-[0.2em] uppercase transition-colors hover:border-accent hover:text-foreground ${
                alertCount > 0
                  ? "border-danger/40 text-danger"
                  : "border-border text-muted"
              }`}
            >
              {alertCount > 0 ? `Alerts (${alertCount})` : "Alerts"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
