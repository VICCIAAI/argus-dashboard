import type { LabelName, ReviewPayload, Sample, Suggestion } from "@/lib/fl/types";

// The rules for the review queue. A suggestion is the machine's guess and
// never a label: it only changes the order events are shown in and what one
// keypress does. Anything written while one is on screen says so.

/** A routine suggestion less sure than this is looked at on its own. */
export const BATCH_MAX_UNCERTAINTY = 0.2;

export function isReviewed(row: Pick<Sample, "provenance">): boolean {
  return row.provenance?.reviewed === true;
}

/** Suggested anomalies and anything the proposers argue over are never batched. */
export function isBatchable(suggestion: Suggestion): boolean {
  if (suggestion.label === "anomaly" || suggestion.disagree) return false;
  return (
    suggestion.uncertainty === null ||
    suggestion.uncertainty <= BATCH_MAX_UNCERTAINTY
  );
}

/** Suggested anomalies first, then least certain first. Rule-only ties stay last. */
export function compareForReview(a: Suggestion, b: Suggestion): number {
  const anomaly = Number(b.label === "anomaly") - Number(a.label === "anomaly");
  if (anomaly !== 0) return anomaly;
  return (b.uncertainty ?? -1) - (a.uncertainty ?? -1);
}

/** How this decision relates to what was on screen when it was made. */
export function reviewFor(
  label: LabelName,
  shown: Suggestion | null,
  via: string,
): ReviewPayload {
  if (!shown) return { kind: "blind", via };
  return {
    kind: shown.label === label ? "accept" : "correct",
    suggested_label: shown.label,
    suggested_source: shown.source,
    via,
  };
}

/** A class the detector proposed, confirmed in a batch without a suggestion. */
export function detectorReview(label: LabelName, via: string): ReviewPayload {
  return {
    kind: "accept",
    suggested_label: label,
    suggested_source: "detector:class",
    via,
  };
}
