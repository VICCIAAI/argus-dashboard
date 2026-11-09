// Small-sample arithmetic for the federated page. Every rate on that page
// is shown with its n and an interval, so a figure from a handful of
// events cannot be quoted as if it were solid.

export interface Interval {
  p: number;
  low: number;
  high: number;
}

/** Wilson 95% score interval. Null when there is nothing to measure. */
export function wilson(k: number, n: number, z = 1.96): Interval | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type TrendKind =
  | "none"
  | "too-few"
  | "improving"
  | "regressing"
  | "flat"
  | "unclear";

export interface TrendVerdict {
  kind: TrendKind;
  text: string;
}

export interface CountPoint {
  name: string;
  k: number;
  n: number;
}

/** Below this many events a rate moves too far on one event to compare. */
export const MIN_N_FOR_VERDICT = 10;

/**
 * Compare the latest measurement with the first.
 *
 * "Improving" and "regressing" require the two 95% intervals not to
 * overlap: a conservative test, chosen because a false "it improved" is
 * the expensive mistake on a project with this few labels.
 */
export function trendVerdict(
  points: CountPoint[],
  higherIsBetter: boolean,
): TrendVerdict {
  const measured = points.filter((point) => point.n > 0);
  if (measured.length === 0) {
    return { kind: "none", text: "No measurements yet" };
  }
  if (measured.length === 1) {
    return {
      kind: "none",
      text: `Baseline only (n=${measured[0].n}). Needs a measured run to compare.`,
    };
  }

  const first = measured[0];
  const last = measured[measured.length - 1];
  if (first.n < MIN_N_FOR_VERDICT || last.n < MIN_N_FOR_VERDICT) {
    return {
      kind: "too-few",
      text: `Too few events to compare (n=${first.n} then n=${last.n})`,
    };
  }

  const a = wilson(first.k, first.n)!;
  const b = wilson(last.k, last.n)!;
  const change = `${pct(a.p)} to ${pct(b.p)}, n=${first.n} then n=${last.n}`;
  const up = b.low > a.high;
  const down = b.high < a.low;

  if (up || down) {
    const better = up === higherIsBetter;
    return {
      kind: better ? "improving" : "regressing",
      text: `${better ? "Improving" : "Regressing"}: ${change}`,
    };
  }
  if (measured.length >= 3) {
    return { kind: "flat", text: `Stagnating, no clear change: ${change}` };
  }
  return { kind: "unclear", text: `No clear change yet: ${change}` };
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
