import type { LedgerEntry, ReviewerStats } from "@/lib/swipe/types";

// Shared by the server route and tests: no Node or browser APIs here.

export function dayKey(epochS: number): string {
  const d = new Date(epochS * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function previousDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime() / 1000);
}

/**
 * Entries still in force: an undo entry cancels the latest earlier entry
 * for the same node and event.
 */
export function effectiveEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const entry of entries) {
    if (entry.undo) {
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (out[i].node === entry.node && out[i].n === entry.n) {
          out.splice(i, 1);
          break;
        }
      }
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Swipes, not events: a group card is one swipe however many events it
 * labelled. Staging tags are not swipes and do not count.
 */
export function reviewerStats(
  entries: LedgerEntry[],
  reviewer: string,
  streakMin: number,
  now = Date.now() / 1000,
): ReviewerStats {
  const mine = effectiveEntries(entries).filter(
    (entry) => entry.source === "swipe" && entry.reviewer === reviewer,
  );
  const days: Record<string, number> = {};
  const seenSwipes = new Set<string>();
  const today = dayKey(now);
  let todayEvents = 0;
  let todayAnomalies = 0;

  for (const entry of mine) {
    const key = dayKey(entry.at);
    const swipeId = entry.group ? `${entry.node}:${entry.group}` : `${entry.node}:${entry.n}:${entry.at}`;
    if (!seenSwipes.has(swipeId)) {
      seenSwipes.add(swipeId);
      days[key] = (days[key] ?? 0) + 1;
    }
    if (key === today && entry.label) {
      todayEvents += 1;
      if (entry.label === "anomaly") todayAnomalies += 1;
    }
  }

  // Today counts toward the streak once it reaches the minimum; until then
  // the streak still stands on yesterday.
  let streak = 0;
  let key = (days[today] ?? 0) >= streakMin ? today : previousDay(today);
  while ((days[key] ?? 0) >= streakMin) {
    streak += 1;
    key = previousDay(key);
  }

  return {
    reviewer,
    today: days[today] ?? 0,
    todayEvents,
    todayAnomalies,
    streak,
    total: seenSwipes.size,
    days,
  };
}
