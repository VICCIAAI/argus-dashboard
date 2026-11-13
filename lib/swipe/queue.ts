import { shuffleKey } from "@/lib/fl/hints";
import { isReviewed } from "@/lib/fl/review";
import {
  ROUTINE_CLASSES,
  type LabelName,
  type ReviewPayload,
  type RoutineClass,
  type Sample,
} from "@/lib/fl/types";
import {
  FIRST_LOCATION_DAY,
  HOME_LOCATION_DAY,
  type DateWindow,
} from "@/lib/swipe/types";

// Builds the swipe deck. Pure: no fetches, no clocks unless passed in.
//
// Lanes
//   uncertain  the model's least sure events first (entropy, or anomaly
//              probability nearest 0.5). Its guess is shown.
//   random     about 1 in 10 cards, drawn at random for calibration. The
//              guess is hidden, so these are blind labels: an honest check
//              of the model and of the reviewer.
//   spot       a few machine auto-labels, shown with the machine's label, so
//              a person keeps checking the auto-labeler.
//
// Never shown: test-set events (held back on the console, never pre-filled
// or suggested), events a person already reviewed, events already decided
// on this console.

export type Item = Sample & { n: number };
export type Lane = "uncertain" | "random" | "spot";

/** One row of GET /api/federated/scores (new node code only). */
export interface ScoreRow {
  n: number;
  t: number;
  label: LabelName | null;
  reviewed: boolean;
  source: string | null;
  model_label?: LabelName;
  confidence?: number;
  p_anomaly?: number;
  entropy?: number;
  margin?: number;
}

export interface Guess {
  label: LabelName;
  /** model:<version>, rule:dwell>=0.9, or the auto-labeler's source. */
  source: string;
  confidence: number | null;
}

export interface Card {
  key: string;
  lane: Lane;
  lead: Item;
  members: Item[];
  /** Null on random cards: shown blind. */
  guess: Guess | null;
  uncertainty: number;
  /** How the uncertainty was measured. */
  basis: "model" | "heuristic";
}

export interface DeckInput {
  samples: Item[];
  scores: Map<number, ScoreRow> | null;
  modelVersion: string | null;
  testSet: Set<number>;
  /** Events labelled on the old label page (console notes). */
  doneElsewhere: Set<number>;
  /** Events decided on this console: label, or null for a skip and when. */
  decided: Map<number, { label: string | null; at: number }>;
  /** False on old node code: it does not say which labels a person gave. */
  provenanceReported: boolean;
  window: { since: number | null; until: number | null };
  randomShare: number;
  spotShare: number;
  /** Changes the random draw; the day number keeps it stable within a day. */
  seed: number;
  now: number;
}

export const RULE_DWELL = 0.9;
const RULE_SOURCE = `rule:dwell>=${RULE_DWELL}`;
/** A skip hides an event for this long. */
const SKIP_HIDE_S = 12 * 3600;
/** Near-duplicates: same class, this close in time and position. */
const GROUP_GAP_S = 20;
const GROUP_TRACK_GAP_S = 60;
const GROUP_MAX_DIST = 0.12;
const GROUP_MAX_SIZE = 25;

function localMidnight(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() / 1000;
}

/** Epoch bounds for a date window, in the viewer's local time. */
export function windowBounds(window: DateWindow): { since: number | null; until: number | null } {
  if (window === "first") {
    return { since: localMidnight(FIRST_LOCATION_DAY), until: localMidnight(HOME_LOCATION_DAY) };
  }
  if (window === "home") return { since: localMidnight(HOME_LOCATION_DAY), until: null };
  return { since: null, until: null };
}

export function detectorClass(item: Sample): RoutineClass {
  return ROUTINE_CLASSES.includes(item.features.class as RoutineClass)
    ? (item.features.class as RoutineClass)
    : "person";
}

/** What a swipe means for one event. */
export function labelFor(item: Sample, direction: "left" | "right"): LabelName {
  return direction === "right" ? "anomaly" : (`routine_${detectorClass(item)}` as LabelName);
}

function ruleGuess(item: Item): Guess {
  const anomaly = detectorClass(item) === "person" && item.features.dwell >= RULE_DWELL;
  return {
    label: anomaly ? "anomaly" : (`routine_${detectorClass(item)}` as LabelName),
    source: RULE_SOURCE,
    confidence: null,
  };
}

function modelGuess(score: ScoreRow | undefined, version: string | null): Guess | null {
  if (!score?.model_label || !version) return null;
  return { label: score.model_label, source: `model:${version}`, confidence: score.confidence ?? null };
}

/** 0 = sure, 1 = coin flip. */
function modelUncertainty(score: ScoreRow): number {
  const entropy = score.entropy ?? 0;
  const nearHalf = score.p_anomaly === undefined ? 0 : 1 - Math.abs(score.p_anomaly - 0.5) * 2;
  return Math.max(entropy, nearHalf);
}

/** Without model scores: how near the dwell rule's line, plus oddities. */
function heuristicUncertainty(item: Item): number {
  const near = 1 - Math.min(Math.abs(item.features.dwell - RULE_DWELL) / RULE_DWELL, 1);
  const odd = (item.meta.stationary ? 0.15 : 0) + (item.features.speed >= 0.9 ? 0.1 : 0);
  return Math.min(1, near * 0.85 + odd);
}

function isAuto(item: Item): boolean {
  return (item.provenance?.source ?? "").startsWith("auto:");
}

export function eligible(item: Item, input: DeckInput): boolean {
  if (input.testSet.has(item.n)) return false;
  if (item.meta.synthetic) return false;
  const { since, until } = input.window;
  if (since !== null && item.t < since) return false;
  if (until !== null && item.t >= until) return false;
  if (isReviewed(item)) return false;
  if (input.doneElsewhere.has(item.n)) return false;
  // Old node code: a label given on the label page keeps the operator's
  // words in meta; rule-derived labels have none.
  if (!input.provenanceReported && (item.meta as { operator_label?: string }).operator_label) {
    return false;
  }
  const decided = input.decided.get(item.n);
  if (decided) {
    if (decided.label !== null) return false;
    if (input.now - decided.at < SKIP_HIDE_S) return false;
  }
  return true;
}

function centreDistance(a: Item, b: Item): number {
  const dx = a.features.centre_x - b.features.centre_x;
  const dy = a.features.centre_y - b.features.centre_y;
  const ds = Math.abs(a.features.width - b.features.width) + Math.abs(a.features.height - b.features.height);
  return Math.hypot(dx, dy) + ds / 2;
}

function sameGroup(last: Item, next: Item): boolean {
  if (detectorClass(last) !== detectorClass(next)) return false;
  const gap = next.t - last.t;
  const sameTrack =
    last.meta.track_id !== undefined && last.meta.track_id === next.meta.track_id;
  if (sameTrack && gap <= GROUP_TRACK_GAP_S) return true;
  return gap <= GROUP_GAP_S && centreDistance(last, next) <= GROUP_MAX_DIST;
}

interface Scored {
  item: Item;
  guess: Guess;
  uncertainty: number;
}

/** Cluster near-duplicates. Only events with the same guess share a card. */
export function groupEvents(rows: Scored[]): Scored[][] {
  const sorted = [...rows].sort((a, b) => a.item.t - b.item.t);
  const groups: Scored[][] = [];
  for (const row of sorted) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (
      current &&
      last &&
      current.length < GROUP_MAX_SIZE &&
      last.guess.label === row.guess.label &&
      sameGroup(last.item, row.item)
    ) {
      current.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

function toCard(group: Scored[], lane: Lane, basis: Card["basis"]): Card {
  const lead = group.reduce((best, row) => (row.uncertainty > best.uncertainty ? row : best));
  return {
    key: `${lane}:${group.map((row) => row.item.n).join("-")}`,
    lane,
    lead: lead.item,
    members: group.map((row) => row.item),
    guess: lane === "random" ? null : lead.guess,
    uncertainty: lead.uncertainty,
    basis,
  };
}

export function buildDeck(input: DeckInput): Card[] {
  const basis: Card["basis"] = input.scores && input.modelVersion ? "model" : "heuristic";
  const open = input.samples.filter((item) => eligible(item, input));

  const spotPool: Card[] = [];
  const scored: Scored[] = [];
  for (const item of open) {
    if (isAuto(item)) {
      const label = item.label;
      if (!label) continue;
      spotPool.push({
        key: `spot:${item.n}`,
        lane: "spot",
        lead: item,
        members: [item],
        guess: {
          label,
          source: item.provenance?.source ?? "auto",
          confidence: item.provenance?.confidence ?? null,
        },
        uncertainty: 0,
        basis,
      });
      continue;
    }
    const score = input.scores?.get(item.n);
    const guess = modelGuess(score, input.modelVersion) ?? ruleGuess(item);
    const uncertainty =
      basis === "model" && score?.model_label ? modelUncertainty(score) : heuristicUncertainty(item);
    scored.push({ item, guess, uncertainty });
  }

  const groups = groupEvents(scored);
  const mix = (n: number) => shuffleKey(n ^ input.seed);

  // Calibration first claims its share at random, so the uncertain lane
  // cannot starve it of the easy events it exists to check.
  const randomCount = Math.round(groups.length * input.randomShare);
  const byRandom = [...groups].sort((a, b) => mix(a[0].item.n) - mix(b[0].item.n));
  const randomGroups = new Set(byRandom.slice(0, randomCount));
  const random = byRandom.slice(0, randomCount).map((g) => toCard(g, "random", basis));
  const uncertain = groups
    .filter((g) => !randomGroups.has(g))
    .map((g) => toCard(g, "uncertain", basis))
    .sort((a, b) => b.uncertainty - a.uncertainty || mix(a.lead.n) - mix(b.lead.n));
  const spots = spotPool.sort((a, b) => mix(a.lead.n) - mix(b.lead.n));

  const randomEvery = input.randomShare > 0 ? Math.max(2, Math.round(1 / input.randomShare)) : 0;
  const spotEvery = input.spotShare > 0 ? Math.max(2, Math.round(1 / input.spotShare)) : 0;
  // Spot checks sit between calibration slots (5, 25, 45 ... for the
  // defaults) so neither lane takes the other's place.
  const spotOffset = spotEvery ? Math.ceil((randomEvery || 2) / 2) % spotEvery : 0;
  const deck: Card[] = [];
  let r = 0;
  let s = 0;
  let u = 0;
  while (u < uncertain.length || r < random.length || s < spots.length) {
    const position = deck.length + 1;
    if (randomEvery && position % randomEvery === 0 && r < random.length) {
      deck.push(random[r++]);
    } else if (spotEvery && position % spotEvery === spotOffset && s < spots.length) {
      deck.push(spots[s++]);
    } else if (u < uncertain.length) {
      deck.push(uncertain[u++]);
    } else if (r < random.length) {
      deck.push(random[r++]);
    } else if (s < spots.length && spotEvery) {
      deck.push(spots[s++]);
    } else {
      break;
    }
  }
  return deck;
}

/** The review the node records for one event of a swiped card. */
export function reviewForSwipe(card: Card, label: LabelName, reviewer: string): ReviewPayload {
  const via = `swipe:${card.lane}${card.members.length > 1 ? ":group" : ""}`;
  if (!card.guess) return { kind: "blind", via, reviewer, source: "swipe" };
  return {
    kind: card.guess.label === label ? "accept" : "correct",
    suggested_label: card.guess.label,
    suggested_source: card.guess.source,
    via,
    reviewer,
    source: "swipe",
  };
}
