import type { Sample } from "@/lib/fl/types";

// "Worth a look" hints for finding rare anomalies in a long queue.
//
// Built only from what the camera recorded, never from the head's output:
// a label has to come from outside the model or the evaluation is circular
// (src/federated/store.py). A hint only changes the order events are shown
// in. Nothing is labelled because of one.

export interface Hint {
  score: number;
  reasons: string[];
}

const LONG_DWELL = 0.9;
const FAST = 0.9;
const RARE_SHARE = 0.05;

export function computeHints(samples: Sample[]): Map<number, Hint> {
  const hints = new Map<number, Hint>();
  if (samples.length === 0) return hints;

  const hourCount = new Map<number, number>();
  const classCount = new Map<string, number>();
  for (const sample of samples) {
    const hour = new Date(sample.t * 1000).getHours();
    hourCount.set(hour, (hourCount.get(hour) ?? 0) + 1);
    classCount.set(
      sample.features.class,
      (classCount.get(sample.features.class) ?? 0) + 1,
    );
  }

  for (const sample of samples) {
    if (sample.n === null) continue;
    const reasons: string[] = [];
    let score = 0;
    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(reason);
    };

    if (sample.features.dwell >= LONG_DWELL) add(3, "Stayed about 30 s or longer");
    if (sample.meta.stationary) add(2, "Barely moved");
    if (sample.features.speed >= FAST) add(1, "Moved unusually fast");

    const hour = new Date(sample.t * 1000).getHours();
    // One busy hour cannot make the others look rare.
    if (hourCount.size >= 4 && hourCount.get(hour)! / samples.length < RARE_SHARE / 2) {
      add(2, "Quiet hour on this camera");
    }
    if (
      classCount.size >= 2 &&
      classCount.get(sample.features.class)! / samples.length < RARE_SHARE
    ) {
      add(1, `${sample.features.class} is rare on this camera`);
    }

    hints.set(sample.n, { score, reasons });
  }
  return hints;
}

/** A stable shuffle: the same events come in the same order after a reload. */
export function shuffleKey(n: number): number {
  return Math.imul(n ^ 0x5bd1e995, 2654435761) >>> 0;
}
