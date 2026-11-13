"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSwipeState, loadReviewer, stagingAction } from "@/lib/swipe/client";
import { applyStaging } from "@/lib/swipe/staging";
import type { StagingSession } from "@/lib/swipe/types";
import type { NodeOption } from "@/lib/nodes";

// Big per-node Start / Stop staging buttons. While a node is staging, the
// team acts out suspicious behaviour and everything that node records is
// labelled anomaly with provenance staged, applied every few seconds while
// this panel is open and once more on Stop.

const APPLY_EVERY_MS = 8_000;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function StagingPanel({ nodes }: { nodes: NodeOption[] }) {
  const [sessions, setSessions] = useState<StagingSession[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now() / 1000);
  const applying = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const state = await fetchSwipeState(null, "");
      setSessions(state.staging);
    } catch {
      // signed out or console restarting; the next tick retries
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now() / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const open = useCallback(
    (nodeId: string) => sessions.find((s) => s.node === nodeId && s.stop === null) ?? null,
    [sessions],
  );

  const runApply = useCallback(async (session: StagingSession) => {
    if (applying.current.has(session.id)) return;
    applying.current.add(session.id);
    try {
      const result = await applyStaging(session, loadReviewer());
      if (result.failed > 0) {
        setMessage((m) => ({
          ...m,
          [session.node]: `${result.failed} event(s) could not be labelled; will retry.`,
        }));
      }
      await refresh();
    } catch (err) {
      setMessage((m) => ({ ...m, [session.node]: (err as Error).message }));
    } finally {
      applying.current.delete(session.id);
    }
  }, [refresh]);

  // Label new events while a session is on.
  useEffect(() => {
    const live = sessions.filter((s) => s.stop === null);
    if (live.length === 0) return;
    const timer = setInterval(() => {
      for (const session of live) void runApply(session);
    }, APPLY_EVERY_MS);
    return () => clearInterval(timer);
  }, [sessions, runApply]);

  const start = async (node: NodeOption) => {
    setBusy(node.id);
    setMessage((m) => ({ ...m, [node.id]: "" }));
    try {
      await stagingAction({ node: node.id, action: "start", by: loadReviewer() || "team" });
      await refresh();
    } catch (err) {
      setMessage((m) => ({
        ...m,
        [node.id]: (err as Error).message.includes("401")
          ? `Sign in to ${node.name} first.`
          : (err as Error).message,
      }));
    } finally {
      setBusy(null);
    }
  };

  const stop = async (node: NodeOption) => {
    setBusy(node.id);
    try {
      const session = await stagingAction({ node: node.id, action: "stop" });
      if (session) await runApply(session);
      await refresh();
      const done = (await fetchSwipeState(null, "")).staging.find((s) => s.id === session?.id);
      setMessage((m) => ({
        ...m,
        [node.id]: done ? `Staging stopped. ${done.tagged.length} event(s) labelled anomaly (staged).` : "Staging stopped.",
      }));
    } catch (err) {
      setMessage((m) => ({ ...m, [node.id]: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs tracking-[0.25em] text-muted uppercase">Staging mode</h2>
        <p className="text-xs text-muted">
          Act out suspicious behaviour while it is on: every event the node records is labelled
          anomaly (provenance: staged). Auto-stops after 30 min.
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        {nodes.map((node) => {
          const session = open(node.id);
          const on = session !== null;
          return (
            <div key={node.id} className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy === node.id}
                onClick={() => (on ? stop(node) : start(node))}
                className={`flex min-h-20 flex-col items-center justify-center rounded-lg border-2 px-4 py-3 text-lg font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                  on
                    ? "animate-pulse border-danger bg-danger/15 text-danger"
                    : "border-accent/60 bg-surface-raised text-foreground hover:border-accent"
                }`}
              >
                <span>{on ? `Stop staging · ${node.name}` : `Start staging · ${node.name}`}</span>
                {on && (
                  <span className="mt-1 font-mono text-sm">
                    REC {clock(now - session.start)} · {session.tagged.length} tagged
                  </span>
                )}
              </button>
              {message[node.id] && <p className="text-xs text-muted">{message[node.id]}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
