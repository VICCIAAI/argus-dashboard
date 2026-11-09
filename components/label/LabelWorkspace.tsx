"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BulkGrid } from "@/components/label/BulkGrid";
import { LabelProgress } from "@/components/label/LabelProgress";
import { SnapshotImage } from "@/components/label/SnapshotImage";
import { NodeSignIn } from "@/components/NodeSignIn";
import { ApiError, fetchSamples, writeLabel } from "@/lib/api";
import { computeHints, shuffleKey } from "@/lib/fl/hints";
import {
  LABEL_NAMES,
  ROUTINE_CLASSES,
  type LabelName,
  type NoteKind,
  type OperatorNote,
  type RoutineClass,
  type Sample,
} from "@/lib/fl/types";
import { formatEpoch } from "@/lib/format";

type Item = Sample & { n: number };
type Destination = "train" | "test";
type Order = "random" | "likely" | "time";

interface Pending {
  item: Item;
  label: LabelName;
  due: number;
  batch: number;
}

type Undo =
  | { kind: "train"; batch: number; items: Item[] }
  | { kind: "note"; item: Item; was: NoteKind };

/**
 * How long a training label waits on the console before going to the node.
 * The node has no way to clear a label, so this window is the only true
 * undo. Anything already sent can be changed but not removed.
 */
const HOLD_MS = 6_000;

/** Stops a double tap from labelling the next event sight unseen. */
const MIN_VIEW_MS = 350;

const BUTTON =
  "rounded border border-border px-3 py-2 font-mono text-xs tracking-[0.1em] text-muted uppercase transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
const TOGGLE_ON = "bg-surface-raised text-foreground";
const TOGGLE_OFF = "text-muted hover:text-foreground";

function routineLabel(cls: RoutineClass): LabelName {
  return `routine_${cls}` as LabelName;
}

function detectorClass(item: Item): RoutineClass | null {
  return ROUTINE_CLASSES.includes(item.features.class as RoutineClass)
    ? (item.features.class as RoutineClass)
    : null;
}

async function postNote(body: Record<string, unknown>) {
  const res = await fetch("/api/fl/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Could not save (${res.status})`);
  }
}

export function LabelWorkspace({
  nodeId,
  nodeName,
}: {
  nodeId: string;
  nodeName: string;
}) {
  const [samples, setSamples] = useState<Item[]>([]);
  const [synthetic, setSynthetic] = useState(0);
  const [notes, setNotes] = useState<Map<number, OperatorNote>>(() => new Map());
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [order, setOrder] = useState<Order>("random");
  const [view, setView] = useState<"single" | "bulk">("single");
  const [destination, setDestination] = useState<Destination>("train");
  const [showSkipped, setShowSkipped] = useState(false);

  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef<Pending[]>([]);
  const [undoStack, setUndoStack] = useState<Undo[]>([]);
  const [relabel, setRelabel] = useState<Item | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failures, setFailures] = useState<Pending[]>([]);
  const [halted, setHalted] = useState<string | null>(null);
  const haltedRef = useRef(false);

  const [seenN, setSeenN] = useState<number | null>(null);
  const [noPictureN, setNoPictureN] = useState<number | null>(null);
  const shownAtRef = useRef(0);
  const batchRef = useRef(0);
  const [choice, setChoice] = useState<{ n: number; cls: RoutineClass } | null>(null);

  // --- Load -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await fetchSamples(nodeId, 1);
        const full = await fetchSamples(nodeId, first.stats.total + 50);
        const noteRes = await fetch(
          `/api/fl/notes?node=${encodeURIComponent(nodeId)}`,
          { cache: "no-store" },
        );
        if (noteRes.status === 401) throw new ApiError("sign in", 401);
        const noteBody = (await noteRes.json()) as {
          notes: OperatorNote[];
          frozenAt: number | null;
        };
        if (cancelled) return;

        const real = full.samples.filter(
          (row): row is Item => row.n !== null && !row.meta.synthetic,
        );
        setSamples(real);
        setSynthetic(full.samples.filter((row) => row.meta.synthetic).length);
        setNotes(new Map(noteBody.notes.map((note) => [note.n, note])));
        setFrozenAt(noteBody.frozenAt);
        setPhase("ready");
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setPhase("signin");
          return;
        }
        setLoadError(`Could not read ${nodeName}. Check it is online, then retry.`);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId, nodeName, reloadTick]);

  // --- Writing labels -------------------------------------------------
  const replacePending = useCallback((next: Pending[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const send = useCallback(
    async (entry: Pending, keepalive: boolean) => {
      // Once one label has come back wrong, nothing more goes out.
      if (haltedRef.current) {
        setFailures((old) => [...old, entry]);
        return;
      }
      try {
        const result = await writeLabel(nodeId, entry.item.n, entry.label, keepalive);
        // The Pis run different branches. Reading back what the node says
        // it stored catches a mismatch on the first label, not the 200th.
        if (result.label && result.label !== entry.label) {
          haltedRef.current = true;
          setHalted(
            `${nodeName} stored event ${entry.item.n} as ${result.label}, not ${entry.label}. Labeling stopped so nothing else is written wrongly.`,
          );
          return;
        }
        setSamples((old) =>
          old.map((row) =>
            row.n === entry.item.n ? { ...row, label: entry.label } : row,
          ),
        );
        void postNote({
          node: nodeId,
          n: entry.item.n,
          kind: "train",
          label: entry.label,
          detector: entry.item.features.class,
        }).catch(() => undefined);
      } catch {
        setFailures((old) => [...old, entry]);
      }
    },
    [nodeId, nodeName],
  );

  const flushDue = useCallback(
    (all: boolean, keepalive: boolean) => {
      const now = Date.now();
      const due = pendingRef.current.filter((entry) => all || entry.due <= now);
      if (due.length === 0) return;
      replacePending(pendingRef.current.filter((entry) => !due.includes(entry)));
      for (const entry of due) void send(entry, keepalive);
    },
    [replacePending, send],
  );

  useEffect(() => {
    if (pending.length === 0) return;
    const wait = Math.max(0, pending[0].due - Date.now());
    const timer = setTimeout(() => flushDue(false, false), wait);
    return () => clearTimeout(timer);
  }, [pending, flushDue]);

  // Leaving the page must not lose a label the operator already gave.
  useEffect(() => {
    const onHide = () => flushDue(true, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushDue(true, true);
    };
  }, [flushDue]);

  // --- Queue ----------------------------------------------------------
  const hints = useMemo(() => computeHints(samples), [samples]);
  const pendingIds = useMemo(
    () => new Set(pending.map((entry) => entry.item.n)),
    [pending],
  );

  const queue = useMemo(() => {
    const open = samples.filter((row) => {
      if (row.label !== null || pendingIds.has(row.n)) return false;
      const note = notes.get(row.n);
      if (!note) return true;
      if (note.kind === "skip") return showSkipped;
      return false;
    });
    const score = (row: Item) => hints.get(row.n)?.score ?? 0;
    if (order === "time") return open.sort((a, b) => a.t - b.t);
    if (order === "likely") {
      return open
        .filter((row) => score(row) > 0)
        .sort((a, b) => score(b) - score(a) || shuffleKey(a.n) - shuffleKey(b.n));
    }
    return open.sort((a, b) => shuffleKey(a.n) - shuffleKey(b.n));
  }, [samples, notes, hints, order, pendingIds, showSkipped]);

  const current: Item | null = relabel ?? queue[0] ?? null;
  const currentN = current?.n ?? null;
  const defaultCls = current ? detectorClass(current) : null;
  const cls = choice && choice.n === currentN ? choice.cls : defaultCls;
  const seen = seenN !== null && seenN === currentN;
  const noPicture = noPictureN !== null && noPictureN === currentN;
  const canLabel = seen && !halted;

  const skippedCount = useMemo(
    () =>
      [...notes.values()].filter(
        (note) =>
          note.kind === "skip" &&
          samples.some((row) => row.n === note.n && row.label === null),
      ).length,
    [notes, samples],
  );
  const likelyCount = useMemo(
    () =>
      samples.filter(
        (row) =>
          row.label === null &&
          !notes.has(row.n) &&
          (hints.get(row.n)?.score ?? 0) > 0,
      ).length,
    [samples, notes, hints],
  );

  const counts = useMemo(() => {
    const out = Object.fromEntries(LABEL_NAMES.map((name) => [name, 0])) as Record<
      LabelName,
      number
    >;
    for (const row of samples) if (row.label) out[row.label] += 1;
    return out;
  }, [samples]);

  const testItems = useMemo(
    () => [...notes.values()].filter((note) => note.kind === "test"),
    [notes],
  );
  const testAnomalies = testItems.filter((note) => note.label === "anomaly").length;

  const bulkItems = useMemo(
    () =>
      queue.filter(
        (row) => (hints.get(row.n)?.score ?? 0) === 0 && detectorClass(row) !== null,
      ),
    [queue, hints],
  );

  // --- Actions --------------------------------------------------------
  const setNoteLocal = useCallback((item: Item, kind: NoteKind, label?: LabelName) => {
    setNotes((old) => {
      const next = new Map(old);
      if (kind === "cleared") next.delete(item.n);
      else
        next.set(item.n, {
          node: "",
          n: item.n,
          kind,
          label,
          detector: item.features.class,
          at: Date.now() / 1000,
        });
      return next;
    });
  }, []);

  const writeNote = useCallback(
    (item: Item, kind: NoteKind, label?: LabelName) => {
      setNoteLocal(item, kind, label);
      postNote({
        node: nodeId,
        n: item.n,
        kind,
        label,
        detector: item.features.class,
        queue: order,
      }).catch((err: Error) => {
        setNoteLocal(item, "cleared");
        setMessage(err.message);
      });
    },
    [nodeId, order, setNoteLocal],
  );

  const applyLabel = useCallback(
    (item: Item, label: LabelName) => {
      setMessage(null);
      shownAtRef.current = Date.now();
      if (destination === "test" && !relabel) {
        writeNote(item, "test", label);
        setUndoStack((old) => [...old, { kind: "note", item, was: "test" }]);
        return;
      }
      batchRef.current += 1;
      const batch = batchRef.current;
      replacePending([
        ...pendingRef.current,
        { item, label, due: Date.now() + HOLD_MS, batch },
      ]);
      setUndoStack((old) => [...old, { kind: "train", batch, items: [item] }]);
      setRelabel(null);
    },
    [destination, relabel, replacePending, writeNote],
  );

  const confirmBulk = useCallback(
    (selected: Item[]) => {
      setMessage(null);
      batchRef.current += 1;
      const batch = batchRef.current;
      const due = Date.now() + HOLD_MS;
      const added = selected.flatMap((item) => {
        const detector = detectorClass(item);
        return detector
          ? [{ item, label: routineLabel(detector), due, batch }]
          : [];
      });
      replacePending([...pendingRef.current, ...added]);
      setUndoStack((old) => [
        ...old,
        { kind: "train", batch, items: added.map((entry) => entry.item) },
      ]);
    },
    [replacePending],
  );

  const skip = useCallback(
    (item: Item) => {
      setMessage(null);
      if (relabel) {
        // Leaving a saved label as it is, nothing to record.
        setRelabel(null);
        return;
      }
      writeNote(item, "skip");
      setUndoStack((old) => [...old, { kind: "note", item, was: "skip" }]);
    },
    [relabel, writeNote],
  );

  const notObject = useCallback(
    (item: Item) => {
      setMessage(null);
      writeNote(item, "not_object");
      setUndoStack((old) => [...old, { kind: "note", item, was: "not_object" }]);
    },
    [writeNote],
  );

  const undo = useCallback(() => {
    const top = undoStack[undoStack.length - 1];
    if (!top) {
      setMessage("Nothing to undo.");
      return;
    }
    setUndoStack((old) => old.slice(0, -1));

    if (top.kind === "note") {
      writeNote(top.item, "cleared");
      setMessage(`Event ${top.item.n} is back in the queue.`);
      return;
    }

    const stillHeld = pendingRef.current.filter((entry) => entry.batch === top.batch);
    replacePending(pendingRef.current.filter((entry) => entry.batch !== top.batch));
    if (stillHeld.length === top.items.length) {
      setMessage("Undone. Nothing was sent to the node.");
      return;
    }
    const sent = top.items.filter(
      (item) => !stillHeld.some((entry) => entry.item.n === item.n),
    );
    if (sent.length === 1) {
      setRelabel(samples.find((row) => row.n === sent[0].n) ?? sent[0]);
      setMessage(
        "Already saved on the node, which cannot clear a label. Pick the right label, or Skip to keep it.",
      );
    } else {
      setMessage(
        `${sent.length} of these were already saved on the node and cannot be cleared.`,
      );
    }
  }, [undoStack, samples, writeNote, replacePending]);

  const onLabelKey = useCallback(
    (label: "routine" | "anomaly") => {
      if (!current || !canLabel) return;
      if (Date.now() - shownAtRef.current < MIN_VIEW_MS) return;
      if (label === "anomaly") applyLabel(current, "anomaly");
      else if (cls) applyLabel(current, routineLabel(cls));
    },
    [applyLabel, canLabel, cls, current],
  );

  useEffect(() => {
    if (view !== "single" || phase !== "ready") return;
    const onKey = (event: KeyboardEvent) => {
      // A held key auto-repeats; that must never label a run of events.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest("input,textarea,select")) return;
      const key = event.key.toLowerCase();
      if (key === "r") onLabelKey("routine");
      else if (key === "a") onLabelKey("anomaly");
      else if (key === "s" && current) skip(current);
      else if (key === "x" && current && canLabel && !relabel) notObject(current);
      else if (key === "u") undo();
      else if (["1", "2", "3", "4"].includes(key) && currentN !== null) {
        setChoice({ n: currentN, cls: ROUTINE_CLASSES[Number(key) - 1] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canLabel, current, currentN, notObject, onLabelKey, phase, relabel, skip, undo, view]);

  const retryFailures = useCallback(() => {
    const failed = failures;
    setFailures([]);
    for (const entry of failed) void send(entry, false);
  }, [failures, send]);

  const freeze = useCallback(async () => {
    setMessage(null);
    const res = await fetch("/api/fl/testset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: nodeId, action: "freeze" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setFrozenAt(Date.now() / 1000);
      setDestination("train");
      setMessage("Test set frozen. Baseline measured for the live model.");
    } else {
      setMessage(data.error ?? "Could not freeze the test set.");
      if (res.status === 502) setFrozenAt(Date.now() / 1000);
    }
  }, [nodeId]);

  // --- Render ---------------------------------------------------------
  if (phase === "signin") {
    return (
      <div className="rounded border border-border bg-surface">
        <NodeSignIn
          nodeId={nodeId}
          nodeName={nodeName}
          onSignedIn={() => {
            setPhase("loading");
            setReloadTick((tick) => tick + 1);
          }}
        />
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <p className="rounded border border-border bg-surface p-10 text-center font-mono text-xs tracking-widest text-muted uppercase">
        Reading {nodeName}…
      </p>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded border border-danger/30 bg-danger/10 p-6 font-mono text-xs text-danger">
        <p>{loadError}</p>
        <button
          type="button"
          className={`${BUTTON} mt-3`}
          onClick={() => {
            setPhase("loading");
            setReloadTick((tick) => tick + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const hint = current ? hints.get(current.n) : undefined;
  const heldBack = destination === "test" && !relabel;

  return (
    <div className="flex flex-col gap-4">
      <LabelProgress
        counts={counts}
        pending={pending.length}
        totalEvents={samples.length}
        synthetic={synthetic}
      />

      {halted && (
        <div className="rounded border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          {halted}
        </div>
      )}

      {failures.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-xs text-danger">
          {failures.length} label{failures.length === 1 ? "" : "s"} did not reach the node.
          <button type="button" onClick={retryFailures} className={BUTTON}>
            Retry
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="font-mono text-xs text-accent">
          {message}
        </p>
      )}
      {pending.length > 0 && (
        <p role="status" className="font-mono text-[11px] text-muted">
          Saving {pending.length} to {nodeName} in a few seconds. Press U to undo.
        </p>
      )}

      {view === "bulk" ? (
        <BulkGrid items={bulkItems} nodeId={nodeId} onConfirm={confirmBulk} />
      ) : !current ? (
        <p className="rounded border border-border bg-surface p-10 text-center font-mono text-xs text-muted">
          {order === "likely"
            ? "No unlabelled events have a hint right now."
            : "Queue is empty. Refresh to pick up new events."}
        </p>
      ) : (
        <section className="grid gap-4 rounded border border-border bg-surface p-4 lg:grid-cols-[1fr_300px]">
          <div>
            <SnapshotImage
              key={current.n}
              sample={current}
              nodeId={nodeId}
              size="large"
              onSeen={() => {
                shownAtRef.current = Date.now();
                setSeenN(current.n);
              }}
              onFailed={() => setNoPictureN(current.n)}
            />
          </div>

          <div className="flex flex-col gap-3 font-mono text-xs">
            <p className="text-[11px] text-muted">
              Goes to{" "}
              <span className="text-foreground">
                {heldBack ? "the test set, on this console" : `${nodeName} training data`}
              </span>
            </p>
            {relabel && (
              <p className="rounded border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">
                Saved as {relabel.label ?? "a label"}. Changing it overwrites the
                node&apos;s copy.
              </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Event</dt>
              <dd className="text-foreground">#{current.n}</dd>
              <dt className="text-muted">Detector</dt>
              <dd className="text-foreground">
                {current.features.class} ·{" "}
                {Math.round(current.features.confidence * 100)}%
              </dd>
              <dt className="text-muted">Time</dt>
              <dd className="text-foreground">{formatEpoch(current.t)}</dd>
              {current.meta.duration_s !== undefined && (
                <>
                  <dt className="text-muted">In view</dt>
                  <dd className="text-foreground">
                    {current.meta.duration_s.toFixed(1)} s
                  </dd>
                </>
              )}
            </dl>

            {hint && hint.reasons.length > 0 && (
              <ul className="rounded border border-border bg-surface-raised p-2 text-[11px] text-foreground">
                {hint.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            <div>
              <p className="mb-1 text-[11px] text-muted">
                Routine class, from the detector. Press 1 to 4 to correct it.
              </p>
              <div className="grid grid-cols-2 gap-1">
                {ROUTINE_CLASSES.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    disabled={!canLabel}
                    onClick={() => setChoice({ n: current.n, cls: name })}
                    className={`rounded border px-2 py-1.5 text-[11px] uppercase disabled:opacity-40 ${cls === name ? "border-accent text-foreground" : "border-border text-muted"}`}
                  >
                    {index + 1} {name}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={!canLabel || !cls}
              onClick={() => onLabelKey("routine")}
              className="rounded bg-accent py-3 font-semibold tracking-[0.15em] text-background uppercase transition-opacity disabled:opacity-40"
            >
              Routine (R)
            </button>
            <button
              type="button"
              disabled={!canLabel}
              onClick={() => onLabelKey("anomaly")}
              className="rounded border border-danger bg-danger/10 py-3 font-semibold tracking-[0.15em] text-danger uppercase transition-colors hover:bg-danger/20 disabled:opacity-40"
            >
              Anomaly (A)
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BUTTON} onClick={() => skip(current)}>
                Skip (S)
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={!canLabel || Boolean(relabel)}
                onClick={() => notObject(current)}
              >
                No object (X)
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-muted">
              {noPicture
                ? "No picture, so this event cannot be labelled. Skip it."
                : heldBack
                  ? "Held on this console for the test set. Nothing goes to the node."
                  : "No object: the detector saw nothing real. Recorded on the console, never used for training."}
            </p>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex items-center gap-1 rounded border border-border bg-surface p-1">
          <legend className="sr-only">Queue order</legend>
          {(
            [
              ["random", "Random"],
              ["likely", `Likely anomalies (${likelyCount})`],
              ["time", "Oldest first"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrder(value)}
              className={`rounded px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase ${order === value ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              {name}
            </button>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1 rounded border border-border bg-surface p-1">
          <legend className="sr-only">View</legend>
          {(["single", "bulk"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={value === "bulk" && destination === "test"}
              onClick={() => setView(value)}
              className={`rounded px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase disabled:opacity-40 ${view === value ? TOGGLE_ON : TOGGLE_OFF}`}
            >
              {value === "single" ? "One at a time" : "Bulk confirm"}
            </button>
          ))}
        </fieldset>

        <button
          type="button"
          className={BUTTON}
          onClick={() => setShowSkipped((value) => !value)}
          disabled={skippedCount === 0 && !showSkipped}
        >
          {showSkipped ? "Hide skipped" : `Skipped (${skippedCount})`}
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={undoStack.length === 0}
          onClick={undo}
        >
          Undo (U)
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => setReloadTick((tick) => tick + 1)}
        >
          Refresh
        </button>
        <span className="font-mono text-[11px] text-muted">{queue.length} in queue</span>
      </div>

      {order === "likely" && (
        <p className="font-mono text-[11px] text-muted">
          Sorted by camera data only, never the model. A hint is a reason to
          look, not a label. Labelling only these skews the training mix, so
          also label from Random.
        </p>
      )}

      <section className="rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] tracking-widest text-muted uppercase">
              Labels go to
            </p>
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDestination("train")}
                className={`rounded px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase ${destination === "train" ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                Training (on node)
              </button>
              <button
                type="button"
                disabled={frozenAt !== null}
                onClick={() => {
                  setDestination("test");
                  setView("single");
                }}
                className={`rounded px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase disabled:opacity-40 ${destination === "test" ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                Test set (console only)
              </button>
            </div>
          </div>
          <div className="max-w-md text-right font-mono text-[11px] leading-relaxed text-muted">
            Test set: {testItems.length} events, {testAnomalies} anomalies
            {frozenAt ? ", frozen." : ", not frozen."}
            <br />
            Never sent to the node, so no round can train on it. This is what
            shows whether rounds really improve anything.
            {!frozenAt && (
              <>
                <br />
                <button
                  type="button"
                  onClick={freeze}
                  disabled={testItems.length === 0}
                  className="mt-1 text-accent underline-offset-2 hover:underline disabled:opacity-40"
                >
                  Freeze test set and measure baseline
                </button>
              </>
            )}
          </div>
        </div>
      </section>


    </div>
  );
}
