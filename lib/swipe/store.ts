import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_SETTINGS,
  type LedgerEntry,
  type SwipeState,
} from "@/lib/swipe/types";

// Disk store for the swipe page. Server-only. ARGUS_SWIPE_DATA_DIR moves it;
// tests point it at a scratch folder.

export function swipeDir(): string {
  return process.env.ARGUS_SWIPE_DATA_DIR ?? path.join(process.cwd(), "data", "swipe");
}

const ledgerPath = () => path.join(swipeDir(), "ledger.jsonl");
const statePath = () => path.join(swipeDir(), "state.json");

let tail: Promise<unknown> = Promise.resolve();
/** One writer at a time within this server process. */
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

export async function readLedger(): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LedgerEntry);
    } catch {
      // torn last line after a hard stop
    }
  }
  return out;
}

export async function appendLedger(entries: LedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await fs.mkdir(swipeDir(), { recursive: true });
  await fs.appendFile(
    ledgerPath(),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
}

/** A state file that exists but cannot be parsed throws, never reads as empty. */
export async function readState(): Promise<SwipeState> {
  let raw: string;
  try {
    raw = await fs.readFile(statePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, settings: { ...DEFAULT_SETTINGS }, staging: [] };
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<SwipeState>;
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    staging: parsed.staging ?? [],
  };
}

export async function writeState(state: SwipeState): Promise<void> {
  await fs.mkdir(swipeDir(), { recursive: true });
  const target = statePath();
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, target);
}
