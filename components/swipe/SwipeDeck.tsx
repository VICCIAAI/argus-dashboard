"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeSignIn } from "@/components/NodeSignIn";
import { SwipeCardBody } from "@/components/swipe/SwipeCard";
import { ApiError, fetchSamples, writeLabel } from "@/lib/api";
import type { LabelName, OperatorNote } from "@/lib/fl/types";
import {
  appendLedger,
  autoLabel,
  fetchScores,
  fetchSwipeState,
  loadPoints,
  saveSettings,
  storePoints,
  type AutoLabelResult,
} from "@/lib/swipe/client";
import {
  buildDeck,
  labelFor,
  reviewForSwipe,
  windowBounds,
  type Card,
  type Item,
  type ScoreRow,
} from "@/lib/swipe/queue";
import { dayKey } from "@/lib/swipe/stats";
import type { DateWindow, ReviewerStats, SwipeSettings } from "@/lib/swipe/types";

type Direction = "left" | "right" | "up";

interface Swiped {
  id: number;
  card: Card;
  direction: Direction;
  labels: LabelName[] | null;
  points: number;
  due: number;
  sent: boolean;
}

/** A swipe waits this long before it goes to the node: the real undo window. */
const HOLD_MS = 4_000;
/** Stops a double flick from labelling the next card sight unseen. */
const MIN_VIEW_MS = 250;
const SWIPE_PX = 90;
const COMBO_GAP_S = 5;

const WINDOW_LABEL: Record<DateWindow, string> = {
  first: "First location (Nov 9)",
  home: "Home (Nov 11 on)",
  all: "All dates",
};

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}

export function SwipeDeck({
  nodeId,
  nodeName,
  reviewer,
}: {
  nodeId: string;
  nodeName: string;
  reviewer: string;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const bumpReload = () => {
    setPhase("loading");
    setReload((r) => r + 1);
  };
  const [settings, setSettings] = useState<SwipeSettings | null>(null);
  const [stats, setStats] = useState<ReviewerStats | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [deckInfo, setDeckInfo] = useState<{ basis: string; model: string | null; provenance: boolean; total: number; testHeld: number }>({ basis: "heuristic", model: null, provenance: false, total: 0, testHeld: 0 });
  const testSetRef = useRef<number[]>([]);

  const [history, setHistory] = useState<Swiped[]>([]);
  const historyRef = useRef<Swiped[]>([]);
  const idRef = useRef(0);
  const [toast, setToast] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [failed, setFailed] = useState<Swiped[]>([]);

  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const movedRef = useRef(false);
  const [exit, setExit] = useState<Direction | null>(null);
  // Both belong to one card; a new card starts collapsed and unseen.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [image, setImage] = useState<{ key: string; state: "seen" | "failed" } | null>(null);
  const shownAt = useRef(0);

  const [today] = useState(() => dayKey(Date.now() / 1000));
  const [points, setPoints] = useState(() => loadPoints(reviewer, today));
  const [combo, setCombo] = useState(0);
  const lastSwipeAt = useRef(0);
  const [celebrate, setCelebrate] = useState(false);
  const celebrated = useRef(false);
  const [showTools, setShowTools] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoLabelResult | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  // --- Load -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await fetchSwipeState(nodeId, reviewer);
        const first = await fetchSamples(nodeId, 1);
        const full = await fetchSamples(nodeId, first.stats.total + 50);
        const noteRes = await fetch(`/api/fl/notes?node=${encodeURIComponent(nodeId)}`, { cache: "no-store" });
        if (noteRes.status === 401) throw new ApiError("sign in", 401);
        const notes = ((await noteRes.json()) as { notes: OperatorNote[] }).notes;
        const bounds = windowBounds(state.settings.window);
        const scored = await fetchScores(nodeId, bounds.since, bounds.until);
        if (cancelled) return;

        const items = full.samples.filter((row): row is Item => row.n !== null && !row.meta.synthetic);
        const testSet = new Set(notes.filter((n) => n.kind === "test").map((n) => n.n));
        testSetRef.current = [...testSet];
        const doneElsewhere = new Set(
          notes.filter((n) => n.kind === "train" || n.kind === "not_object").map((n) => n.n),
        );
        const scores = scored ? new Map<number, ScoreRow>(scored.scores.map((s) => [s.n, s])) : null;
        const provenance = full.stats.provenance !== undefined;
        const deck = buildDeck({
          samples: items,
          scores,
          modelVersion: scored?.model ?? null,
          testSet,
          doneElsewhere,
          decided: new Map(state.decided.map((d) => [d.n, { label: d.label, at: d.at }])),
          provenanceReported: provenance,
          window: bounds,
          randomShare: state.settings.randomShare,
          spotShare: state.settings.spotShare,
          seed: Math.floor(Date.now() / 86_400_000),
          now: Date.now() / 1000,
        });
        setSettings(state.settings);
        setStats(state.stats);
        setCards(deck);
        setDeckInfo({
          basis: scored?.model ? "model" : "heuristic",
          model: scored?.model ?? null,
          provenance,
          total: deck.reduce((sum, card) => sum + card.members.length, 0),
          testHeld: testSet.size,
        });
        celebrated.current = (state.stats?.today ?? 0) >= state.settings.dailyGoal;
        setPhase("ready");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if ((err instanceof ApiError && err.status === 401) || (err as { status?: number }).status === 401) {
          setPhase("signin");
          return;
        }
        setError(`Could not read ${nodeName}. Check it is online, then retry.`);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nodeId, nodeName, reviewer, reload]);

  // --- Sending --------------------------------------------------------
  const send = useCallback(
    async (entry: Swiped, keepalive: boolean) => {
      const members = entry.card.members;
      if (!entry.labels) {
        await appendLedger(
          members.map((m) => ({ node: nodeId, n: m.n, label: null, source: "swipe" as const, reviewer, via: "swipe:skip", group: members.length > 1 ? entry.card.key : undefined })),
          keepalive,
        ).catch(() => undefined);
        return;
      }
      const okay: { n: number; label: LabelName; echoed: boolean }[] = [];
      let failures = 0;
      for (let i = 0; i < members.length; i += 1) {
        const label = entry.labels[i];
        try {
          const result = await writeLabel(nodeId, members[i].n, label, keepalive, reviewForSwipe(entry.card, label, reviewer));
          okay.push({ n: members[i].n, label, echoed: Boolean(result.provenance) });
        } catch (err) {
          // 409: a person already labelled it elsewhere. Theirs stands.
          if (!(err instanceof ApiError && err.status === 409)) failures += 1;
        }
      }
      if (okay.length > 0) {
        await appendLedger(
          okay.map((o) => ({
            node: nodeId,
            n: o.n,
            label: o.label,
            source: "swipe" as const,
            reviewer,
            via: `swipe:${entry.card.lane}`,
            group: members.length > 1 ? entry.card.key : undefined,
            nodeProvenance: o.echoed,
          })),
          keepalive,
        ).catch(() => undefined);
      }
      if (failures > 0) {
        setFailed((old) => [...old, entry]);
        setToast({ text: `${failures} label(s) did not reach ${nodeName}. Tap retry.`, tone: "bad" });
      }
    },
    [nodeId, nodeName, reviewer],
  );

  const flush = useCallback(
    (all: boolean, keepalive: boolean) => {
      const now = Date.now();
      for (const entry of historyRef.current) {
        if (!entry.sent && (all || entry.due <= now)) {
          entry.sent = true;
          void send(entry, keepalive);
        }
      }
    },
    [send],
  );

  useEffect(() => {
    const timer = setInterval(() => flush(false, false), 500);
    const onHide = () => flush(true, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      flush(true, true);
    };
  }, [flush]);

  // --- Swiping --------------------------------------------------------
  const current = cards[0] ?? null;
  const next = cards[1] ?? null;
  const goal = settings?.dailyGoal ?? 150;
  const todayCount = stats?.today ?? 0;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [current?.key]);
  const expanded = current !== null && expandedKey === current.key;
  const setExpanded = (fn: (e: boolean) => boolean) =>
    setExpandedKey(current && fn(expanded) ? current.key : null);
  const imageState = current && image?.key === current.key ? image.state : "loading";
  const setImageState = (state: "seen" | "failed") => {
    if (current) setImage({ key: current.key, state });
  };

  const commit = useCallback(
    (direction: Direction) => {
      if (!current || exit) return;
      if (Date.now() - shownAt.current < MIN_VIEW_MS) return;
      if (direction !== "up" && imageState === "failed") {
        setToast({ text: "No picture, so it can only be skipped.", tone: "info" });
        return;
      }
      const labels = direction === "up" ? null : current.members.map((m) => labelFor(m, direction));
      const nowS = Date.now() / 1000;
      const quick = nowS - lastSwipeAt.current <= COMBO_GAP_S;
      lastSwipeAt.current = nowS;
      const nextCombo = direction === "up" ? 0 : quick ? combo + 1 : 1;
      const multiplier = 1 + Math.min(nextCombo, 20) / 10;
      let earned = 0;
      if (labels) {
        earned = Math.round((10 + 3 * (current.members.length - 1)) * multiplier);
        if (current.lane === "spot" && current.guess && current.guess.label !== labels[0]) {
          earned += 30;
          setToast({ text: "Caught the machine out! +30", tone: "good" });
        } else if (current.lane === "random") {
          earned += 5;
        }
      }
      const entry: Swiped = {
        id: (idRef.current += 1),
        card: current,
        direction,
        labels,
        points: earned,
        due: Date.now() + HOLD_MS,
        sent: false,
      };
      historyRef.current = [...historyRef.current.slice(-49), entry];
      setHistory(historyRef.current);
      setCombo(nextCombo);
      setPoints((p) => {
        storePoints(reviewer, today, p + earned);
        return p + earned;
      });
      setStats((s) =>
        s ? { ...s, today: s.today + 1, todayEvents: s.todayEvents + (labels ? labels.length : 0) } : s,
      );
      vibrate(direction === "right" ? 25 : 12);
      setExit(direction);
      setDrag(null);
      setTimeout(() => {
        setCards((old) => old.filter((c) => c.key !== entry.card.key));
        setExit(null);
      }, 230);
      if (!celebrated.current && todayCount + 1 >= goal) {
        celebrated.current = true;
        setCelebrate(true);
      }
    },
    [current, exit, imageState, combo, reviewer, today, todayCount, goal],
  );

  const undo = useCallback(() => {
    const last = historyRef.current[historyRef.current.length - 1];
    if (!last || exit) {
      setToast({ text: "Nothing to undo.", tone: "info" });
      return;
    }
    historyRef.current = historyRef.current.slice(0, -1);
    setHistory(historyRef.current);
    setCards((old) => [last.card, ...old.filter((c) => c.key !== last.card.key)]);
    setPoints((p) => {
      storePoints(reviewer, today, Math.max(0, p - last.points));
      return Math.max(0, p - last.points);
    });
    setStats((s) =>
      s ? { ...s, today: Math.max(0, s.today - 1), todayEvents: Math.max(0, s.todayEvents - (last.labels?.length ?? 0)) } : s,
    );
    setCombo(0);
    if (last.sent) {
      void appendLedger(
        last.card.members.map((m) => ({ node: nodeId, n: m.n, label: null, source: "swipe" as const, reviewer, via: "swipe:undo", undo: true })),
      ).catch(() => undefined);
      setToast({
        text: last.labels ? "Already saved on the node. Swipe it again to change it." : "Skip undone.",
        tone: "info",
      });
    } else {
      setToast({ text: "Undone. Nothing was sent.", tone: "info" });
    }
  }, [exit, nodeId, reviewer, today]);

  const retry = useCallback(() => {
    const again = failed;
    setFailed([]);
    setToast(null);
    for (const entry of again) void send(entry, false);
  }, [failed, send]);

  // Keyboard on desktop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "ArrowRight") commit("right");
      else if (event.key === "ArrowLeft") commit("left");
      else if (event.key === "ArrowUp") commit("up");
      else if (event.key === "Backspace" || event.key.toLowerCase() === "z") undo();
      else if (event.key === " " && current && current.members.length > 1) {
        const key = current.key;
        setExpandedKey((k) => (k === key ? null : key));
      }
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo, current]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === "bad" ? 8000 : 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  // Touch and mouse drag.
  const onPointerDown = (event: React.PointerEvent) => {
    if (exit) return;
    dragStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    movedRef.current = false;
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start || start.id !== event.pointerId) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (!movedRef.current && Math.hypot(x, y) > 8) {
      movedRef.current = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (movedRef.current) setDrag({ x, y });
  };
  const onPointerUp = () => {
    const d = drag;
    dragStart.current = null;
    if (!movedRef.current || !d) {
      setDrag(null);
      return;
    }
    if (d.x > SWIPE_PX) commit("right");
    else if (d.x < -SWIPE_PX) commit("left");
    else if (d.y < -SWIPE_PX && Math.abs(d.y) > Math.abs(d.x)) commit("up");
    else setDrag(null);
  };
  const onClickCapture = (event: React.MouseEvent) => {
    // A drag that ends over a button must not also press it.
    if (movedRef.current) {
      event.stopPropagation();
      event.preventDefault();
      movedRef.current = false;
    }
  };

  // --- Tools ----------------------------------------------------------
  const changeSettings = async (patch: Partial<SwipeSettings>, reloadDeck = false) => {
    try {
      setSettings(await saveSettings(patch));
      if (reloadDeck) bumpReload();
    } catch (err) {
      setToast({ text: (err as Error).message, tone: "bad" });
    }
  };

  const runAuto = async (dryRun: boolean) => {
    if (!settings) return;
    setAutoBusy(true);
    try {
      const bounds = windowBounds(settings.window);
      const result = await autoLabel(nodeId, {
        threshold: settings.autoThreshold,
        exclude: testSetRef.current,
        since: bounds.since,
        until: bounds.until,
        dry_run: dryRun,
      });
      if (dryRun) setAutoPreview(result);
      else {
        setAutoPreview(null);
        setToast({ text: `Machine-labelled ${result.labelled} confident events. Spot checks will appear in the deck.`, tone: "good" });
        bumpReload();
      }
    } catch (err) {
      setToast({ text: (err as Error).message, tone: "bad" });
    } finally {
      setAutoBusy(false);
    }
  };

  const minutesLeft = useMemo(() => Math.max(0, Math.ceil(((goal - todayCount) * 3) / 60)), [goal, todayCount]);

  if (phase === "signin") {
    return (
      <div className="mx-auto w-full max-w-sm">
        <NodeSignIn nodeId={nodeId} nodeName={nodeName} onSignedIn={() => bumpReload()} />
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted">{error}</p>
        <button type="button" className="rounded border border-border px-4 py-2 text-sm" onClick={() => bumpReload()}>
          Retry
        </button>
      </div>
    );
  }
  if (phase === "loading" || !settings) {
    return <p className="py-10 text-center font-mono text-xs tracking-widest text-muted uppercase">Shuffling the deck…</p>;
  }

  const progress = Math.min(1, todayCount / goal);
  const dx = drag?.x ?? 0;
  const dy = drag?.y ?? 0;
  const exitTransform =
    exit === "right"
      ? "translate(130%, -10%) rotate(25deg)"
      : exit === "left"
        ? "translate(-130%, -10%) rotate(-25deg)"
        : exit === "up"
          ? "translate(0, -130%) scale(0.9)"
          : null;
  const transform = exitTransform ?? `translate(${dx}px, ${Math.min(dy, 40)}px) rotate(${dx / 18}deg)`;
  const rightness = Math.max(0, Math.min(1, dx / SWIPE_PX));
  const leftness = Math.max(0, Math.min(1, -dx / SWIPE_PX));
  const upness = Math.max(0, Math.min(1, -dy / SWIPE_PX)) * (Math.abs(dy) > Math.abs(dx) ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Score bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-foreground">
            <span className="text-muted">Today</span> {todayCount}/{goal}
          </span>
          <span className="flex items-center gap-3">
            {combo >= 3 && <span className="animate-bounce text-amber-300">x{(1 + Math.min(combo, 20) / 10).toFixed(1)} combo</span>}
            <span title="Daily streak">🔥 {stats?.streak ?? 0}</span>
            <span title="Points today" className="text-accent">★ {points}</span>
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-300 transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-muted">
          <span>{cards.length} cards left · {WINDOW_LABEL[settings.window]}</span>
          <span>{todayCount >= goal ? "Goal done 🎉" : `≈ ${minutesLeft} min to goal`}</span>
        </div>
      </div>

      {/* Card stack */}
      <div className="relative min-h-[420px] select-none" style={{ touchAction: "none" }}>
        {next && (
          <div className="absolute inset-x-0 top-0 scale-[0.96] overflow-hidden rounded-2xl border border-border bg-surface opacity-60" aria-hidden inert>
            <SwipeCardBody card={next} nodeId={nodeId} nodeName={nodeName} expanded={false} onToggleExpand={() => undefined} onImageState={() => undefined} />
          </div>
        )}
        {current ? (
          <div
            key={current.key}
            data-card="current"
            data-lead={current.lead.n}
            data-lane={current.lane}
            className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/50"
            style={{
              transform,
              transition: drag ? "none" : "transform 230ms cubic-bezier(.2,.8,.3,1), opacity 230ms",
              opacity: exit ? 0 : 1,
              cursor: drag ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClickCapture={onClickCapture}
          >
            <SwipeCardBody
              card={current}
              nodeId={nodeId}
              nodeName={nodeName}
              expanded={expanded}
              onToggleExpand={() => setExpanded((e) => !e)}
              onImageState={setImageState}
            />
            {/* Drag stamps */}
            <div className="pointer-events-none absolute top-10 left-4 -rotate-12 rounded-lg border-4 border-danger px-3 py-1 text-2xl font-black text-danger" style={{ opacity: exit === "right" ? 1 : rightness }}>
              ANOMALY
            </div>
            <div className="pointer-events-none absolute top-10 right-4 rotate-12 rounded-lg border-4 border-accent px-3 py-1 text-2xl font-black text-accent" style={{ opacity: exit === "left" ? 1 : leftness }}>
              ROUTINE
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-1/3 mx-auto w-fit rounded-lg border-4 border-foreground/70 px-3 py-1 text-2xl font-black text-foreground/80" style={{ opacity: exit === "up" ? 1 : upness }}>
              SKIP
            </div>
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center">
            <p className="text-3xl">🏁</p>
            <p className="text-sm text-foreground">Deck empty for {WINDOW_LABEL[settings.window].toLowerCase()}.</p>
            <p className="max-w-xs text-xs text-muted">Change the date filter below, or come back after the cameras record more.</p>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="grid grid-cols-4 gap-2">
        <button type="button" onClick={() => commit("left")} disabled={!current} className="flex flex-col items-center rounded-2xl border-2 border-accent/50 bg-accent/10 py-3 text-accent transition-transform active:scale-90 disabled:opacity-30" aria-label="Routine (left arrow)">
          <span className="text-2xl leading-none">←</span>
          <span className="mt-1 text-[11px] font-semibold">Routine</span>
        </button>
        <button type="button" onClick={() => commit("up")} disabled={!current} className="flex flex-col items-center rounded-2xl border-2 border-border bg-surface-raised py-3 text-muted transition-transform active:scale-90 disabled:opacity-30" aria-label="Skip or unsure (up arrow)">
          <span className="text-2xl leading-none">↑</span>
          <span className="mt-1 text-[11px] font-semibold">Unsure</span>
        </button>
        <button type="button" onClick={() => commit("right")} disabled={!current} className="flex flex-col items-center rounded-2xl border-2 border-danger/50 bg-danger/10 py-3 text-danger transition-transform active:scale-90 disabled:opacity-30" aria-label="Anomaly (right arrow)">
          <span className="text-2xl leading-none">→</span>
          <span className="mt-1 text-[11px] font-semibold">Anomaly</span>
        </button>
        <button type="button" onClick={undo} disabled={history.length === 0} className="flex flex-col items-center rounded-2xl border-2 border-border bg-surface py-3 text-foreground transition-transform active:scale-90 disabled:opacity-30" aria-label="Undo last swipe (Z)">
          <span className="text-2xl leading-none">↶</span>
          <span className="mt-1 text-[11px] font-semibold">Undo</span>
        </button>
      </div>
      <p className="hidden text-center font-mono text-[10px] text-muted sm:block">← routine · → anomaly · ↑ unsure · Z undo · space expands a group</p>

      {toast && (
        <div role="status" className={`fixed inset-x-4 bottom-6 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ${toast.tone === "good" ? "bg-accent text-black" : toast.tone === "bad" ? "bg-danger text-white" : "bg-surface-raised text-foreground"}`}>
          <span>{toast.text}</span>
          {failed.length > 0 && toast.tone === "bad" && (
            <button type="button" onClick={retry} className="rounded bg-black/20 px-2 py-1 font-semibold">Retry</button>
          )}
        </div>
      )}

      {celebrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setCelebrate(false)}>
          <div className="animate-[pop_400ms_ease-out] rounded-3xl border border-accent bg-surface p-8 text-center shadow-2xl">
            <p className="text-6xl">🎉</p>
            <p className="mt-3 text-xl font-bold text-foreground">Daily goal done!</p>
            <p className="mt-1 text-sm text-muted">{goal} swipes · ★ {points} · 🔥 streak {Math.max(stats?.streak ?? 0, 1)}</p>
            <p className="mt-3 text-xs text-muted">That is today&apos;s labeling. Keep going only if you feel like it.</p>
            <button type="button" className="mt-5 rounded-full bg-accent px-6 py-2 font-semibold text-black" onClick={() => setCelebrate(false)}>
              Nice
            </button>
          </div>
        </div>
      )}

      {/* Tools */}
      <div className="mt-2 rounded-xl border border-border bg-surface">
        <button type="button" onClick={() => setShowTools((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 font-mono text-xs tracking-wider text-muted uppercase">
          <span>Filters, goal and auto-label</span>
          <span>{showTools ? "▴" : "▾"}</span>
        </button>
        {showTools && (
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4 text-sm">
            <div>
              <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted uppercase">Dates in the deck</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-raised p-1">
                {(["first", "home", "all"] as DateWindow[]).map((w) => (
                  <button key={w} type="button" onClick={() => changeSettings({ window: w }, true)} className={`rounded-md px-2 py-2 text-xs ${settings.window === w ? "bg-accent text-black" : "text-muted"}`}>
                    {WINDOW_LABEL[w]}
                  </button>
                ))}
              </div>
              {settings.window !== "first" && settings.trainingRule !== "include-home" && (
                <p className="mt-2 rounded bg-amber-400/10 px-2 py-1.5 text-xs text-amber-300">
                  {settings.trainingRule === "pending"
                    ? "Gio has not decided yet whether home-location labels count for training. Labels you give here are saved and marked, but may be left out of the next round."
                    : "Training uses first-location data only. Home-location labels are saved but not trained on."}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                Training rule:{" "}
                <select value={settings.trainingRule} onChange={(e) => changeSettings({ trainingRule: e.target.value as SwipeSettings["trainingRule"] })} className="rounded border border-border bg-surface-raised px-1 py-0.5 text-foreground">
                  <option value="pending">waiting on Gio</option>
                  <option value="first-only">first location only</option>
                  <option value="include-home">include home location</option>
                </select>
              </p>
            </div>

            <label className="flex items-center justify-between gap-2">
              <span className="text-muted">Daily goal (swipes)</span>
              <input type="number" min={10} max={2000} defaultValue={settings.dailyGoal} onBlur={(e) => changeSettings({ dailyGoal: Number(e.target.value) })} className="w-24 rounded border border-border bg-surface-raised px-2 py-1 text-right text-foreground" />
            </label>

            <div>
              <p className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">Auto-label confident events</p>
              {deckInfo.basis === "model" ? (
                <>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-muted">Threshold</span>
                    <input type="number" step={0.01} min={0.5} max={0.999} defaultValue={settings.autoThreshold} onBlur={(e) => changeSettings({ autoThreshold: Number(e.target.value) })} className="w-24 rounded border border-border bg-surface-raised px-2 py-1 text-right text-foreground" />
                  </label>
                  <p className="mt-1 text-xs text-muted">
                    Unlabelled events in the current date filter that model {deckInfo.model} is at least {Math.round(settings.autoThreshold * 100)}% sure of get a machine label (never counted as human; test set untouched). A few come back as spot checks.
                  </p>
                  {autoPreview ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded bg-surface-raised px-3 py-2">
                      <span className="text-xs">{autoPreview.labelled} of {autoPreview.considered} would be machine-labelled.</span>
                      <span className="flex gap-2">
                        <button type="button" disabled={autoBusy || autoPreview.labelled === 0} onClick={() => runAuto(false)} className="rounded bg-accent px-3 py-1 text-xs font-semibold text-black disabled:opacity-40">Apply</button>
                        <button type="button" onClick={() => setAutoPreview(null)} className="rounded border border-border px-3 py-1 text-xs">Cancel</button>
                      </span>
                    </div>
                  ) : (
                    <button type="button" disabled={autoBusy} onClick={() => runAuto(true)} className="mt-2 rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40">
                      {autoBusy ? "Checking…" : "Preview auto-label"}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted">
                  {nodeName} runs older node code without model scores, so the deck is ordered by a dwell heuristic and auto-label is off. Deploying branch feat/swipe-label to the node turns both on.
                </p>
              )}
            </div>

            <p className="font-mono text-[10px] leading-relaxed text-muted">
              Order: {deckInfo.basis === "model" ? `model ${deckInfo.model} uncertainty` : "dwell heuristic"} · {Math.round(settings.randomShare * 100)}% random calibration (guess hidden) · {deckInfo.total} events in deck · {deckInfo.testHeld} test-set events held out ·{" "}
              {deckInfo.provenance ? "node records swipe provenance" : "node does not record provenance yet; the console ledger does"} · reviewer {reviewer}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
