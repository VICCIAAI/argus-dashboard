import type { LabelName } from "@/lib/fl/types";

// Shapes for the swipe page and its server routes.

/**
 * One decision, kept on the console as well as sent to the node. Old nodes
 * drop the provenance a console sends, so this ledger is the record of who
 * swiped what and when, whatever the node is running.
 */
export interface LedgerEntry {
  node: string;
  n: number;
  /** null for a skip. */
  label: LabelName | null;
  /** swipe = a person on the swipe page; staged = staging mode. */
  source: "swipe" | "staged";
  reviewer: string;
  at: number;
  /** The queue lane or staging session it came from. */
  via: string;
  /** Group card id, when one swipe labelled several events. */
  group?: string;
  /** Set on an entry that cancels an earlier one (undo). */
  undo?: boolean;
  /** False when the node did not echo provenance (older node code). */
  nodeProvenance?: boolean;
}

export type DateWindow = "first" | "home" | "all";

/** Gio's answer on whether home-location (11-11 on) labels count for training. */
export type TrainingRule = "pending" | "first-only" | "include-home";

export interface SwipeSettings {
  dailyGoal: number;
  /** Swipes on a day that keep the streak alive. */
  streakMin: number;
  autoThreshold: number;
  /** Share of cards drawn at random for calibration. */
  randomShare: number;
  /** Share of cards that are spot checks of machine labels. */
  spotShare: number;
  window: DateWindow;
  trainingRule: TrainingRule;
}

export interface StagingSession {
  id: string;
  node: string;
  start: number;
  stop: number | null;
  by: string;
  /** Events labelled anomaly from this session so far. */
  tagged: number[];
}

export interface SwipeState {
  version: 1;
  settings: SwipeSettings;
  staging: StagingSession[];
}

export interface ReviewerStats {
  reviewer: string;
  today: number;
  todayEvents: number;
  todayAnomalies: number;
  streak: number;
  total: number;
  /** Day keys (YYYY-MM-DD, console local time) with their swipe counts. */
  days: Record<string, number>;
}

/** The first location's day and the home location's first day (local). */
export const FIRST_LOCATION_DAY = "2026-11-09";
export const HOME_LOCATION_DAY = "2026-11-11";

export const DEFAULT_SETTINGS: SwipeSettings = {
  dailyGoal: 150,
  streakMin: 50,
  autoThreshold: 0.95,
  randomShare: 0.1,
  spotShare: 0.05,
  window: "first",
  trainingRule: "pending",
};
