"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SwipeDeck } from "@/components/swipe/SwipeDeck";
import { useAuth } from "@/hooks/useAuth";
import { useNodes } from "@/hooks/useNodes";
import { loadReviewer, storeReviewer } from "@/lib/swipe/client";

// Phone-first labeling game. One event (or one group of near-duplicates) per
// card: right = anomaly, left = routine, up = unsure. Labels go to the node
// through its normal label route, marked as a person's review from the swipe
// screen, and to this console's ledger.
export default function SwipePage() {
  const { status } = useAuth();
  const router = useRouter();
  const { nodes, selected, loaded } = useNodes();
  const [picked, setPicked] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?from=/dashboard/swipe");
  }, [status, router]);

  // localStorage exists only in the browser, so this cannot be a lazy
  // initial state without a hydration mismatch.
  useEffect(() => {
    const name = loadReviewer();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReviewer(name);
    setDraft(name || "Gio");
  }, []);

  const activeId = picked ?? selected ?? nodes[0]?.id ?? null;
  const active = nodes.find((node) => node.id === activeId) ?? null;

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim().slice(0, 40);
    if (!name) return;
    storeReviewer(name);
    setReviewer(name);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-3 pb-8">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Link href="/dashboard" className="font-mono text-[10px] tracking-[0.3em] text-muted uppercase hover:text-accent">
            ARGUS ‹ console
          </Link>
          <h1 className="text-lg leading-tight font-semibold text-foreground">Swipe to label</h1>
        </div>
        {reviewer && (
          <button type="button" onClick={() => setReviewer("")} className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted" title="Change reviewer">
            {reviewer}
          </button>
        )}
      </header>

      {status !== "authenticated" || !loaded || reviewer === null ? (
        <p className="font-mono text-xs tracking-widest text-muted uppercase">
          {status === "unauthenticated" ? "Redirecting…" : "Checking session…"}
        </p>
      ) : !reviewer ? (
        <form onSubmit={saveName} className="mt-8 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <label className="text-sm text-foreground" htmlFor="reviewer">
            Who is swiping? Your name goes on every label you give.
          </label>
          <input
            id="reviewer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="rounded-lg border border-border bg-surface-raised px-3 py-3 text-base text-foreground outline-none focus:border-accent"
          />
          <button type="submit" className="rounded-full bg-accent py-3 font-semibold text-black">
            Start swiping
          </button>
        </form>
      ) : (
        <>
          {nodes.length > 1 && (
            <div role="tablist" aria-label="Node" className="mb-3 grid grid-flow-col gap-1 rounded-xl border border-border bg-surface p-1">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  role="tab"
                  aria-selected={node.id === activeId}
                  onClick={() => setPicked(node.id)}
                  className={`rounded-lg px-3 py-2 font-mono text-xs tracking-wider uppercase ${
                    node.id === activeId ? "bg-surface-raised text-foreground" : "text-muted"
                  }`}
                >
                  {node.name}
                </button>
              ))}
            </div>
          )}
          {active ? (
            <SwipeDeck key={`${active.id}:${reviewer}`} nodeId={active.id} nodeName={active.name} reviewer={reviewer} />
          ) : (
            <p className="font-mono text-xs text-muted">No nodes configured.</p>
          )}
        </>
      )}
    </div>
  );
}
