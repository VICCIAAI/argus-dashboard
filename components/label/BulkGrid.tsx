"use client";

import { useEffect, useMemo, useState } from "react";
import { SnapshotImage } from "@/components/label/SnapshotImage";
import type { Sample } from "@/lib/fl/types";

type Item = Sample & { n: number };

const PAGE_SIZE = 12;
/** Long enough that the button cannot be hit without the page being looked at. */
const MIN_LOOK_MS = 3_000;

/**
 * Confirm a page of routine events together. Every picture must have
 * rendered and stayed on screen before the button arms, and anything the
 * operator unticks goes back in the queue unlabelled. Events with a hint
 * are never offered here: those get looked at one at a time.
 */
export function BulkGrid({
  items,
  nodeId,
  onConfirm,
}: {
  items: Item[];
  nodeId: string;
  onConfirm: (selected: Item[]) => void;
}) {
  const page = useMemo(() => items.slice(0, PAGE_SIZE), [items]);
  const pageKey = page.map((item) => item.n).join(",");

  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const [armed, setArmed] = useState(false);
  const [lastKey, setLastKey] = useState(pageKey);

  // A new page starts over: nothing on it has been seen yet.
  if (lastKey !== pageKey) {
    setLastKey(pageKey);
    setExcluded(new Set());
    setSeen(new Set());
    setFailed(new Set());
    setArmed(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), MIN_LOOK_MS);
    return () => clearTimeout(timer);
  }, [pageKey]);

  if (page.length === 0) {
    return (
      <p className="rounded border border-border bg-surface p-8 text-center font-mono text-xs text-muted">
        Nothing left that can be bulk-confirmed. Events with a hint are
        reviewed one at a time.
      </p>
    );
  }

  const chosen = page.filter(
    (item) => !excluded.has(item.n) && !failed.has(item.n),
  );
  const allSeen = chosen.every((item) => seen.has(item.n));
  const ready = armed && allSeen && chosen.length > 0;

  return (
    <section className="rounded border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-muted">
          Look at each picture. Untick any that are not plainly routine, or
          whose class is wrong. Those stay unlabelled.
        </p>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onConfirm(chosen)}
          className="rounded bg-accent px-4 py-2 font-mono text-xs font-semibold tracking-[0.15em] text-background uppercase transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ready
            ? `Confirm ${chosen.length} as routine`
            : allSeen
              ? "Take a look first…"
              : "Loading pictures…"}
        </button>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {page.map((item) => {
          const isOut = excluded.has(item.n) || failed.has(item.n);
          return (
            <li key={item.n}>
              <label
                className={`block cursor-pointer overflow-hidden rounded border p-1 transition-colors ${
                  isOut ? "border-border opacity-40" : "border-accent/50"
                }`}
              >
                <SnapshotImage
                  sample={item}
                  nodeId={nodeId}
                  size="tile"
                  onSeen={() => setSeen((old) => new Set(old).add(item.n))}
                  onFailed={() => setFailed((old) => new Set(old).add(item.n))}
                />
                <span className="flex items-center justify-between gap-2 px-1 pt-1 font-mono text-[11px] text-foreground">
                  <span>
                    {item.features.class}{" "}
                    <span className="text-muted">#{item.n}</span>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={`Include event ${item.n} as routine ${item.features.class}`}
                    checked={!isOut}
                    disabled={failed.has(item.n)}
                    onChange={() =>
                      setExcluded((old) => {
                        const next = new Set(old);
                        if (next.has(item.n)) next.delete(item.n);
                        else next.add(item.n);
                        return next;
                      })
                    }
                  />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
