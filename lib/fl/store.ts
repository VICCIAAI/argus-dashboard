import { promises as fs } from "fs";
import path from "path";
import type { HistoryFile, OperatorNote } from "@/lib/fl/types";

// Disk store for the federated page. Server-only.
//
// The aggregator keeps its round history in memory and a node keeps only
// its latest round, so a restart on either side erases the evidence. The
// console copies each result here the moment it sees one, and this is the
// copy that lasts. ARGUS_FL_DATA_DIR moves it; tests point it elsewhere so
// fixtures can never land in the real history.

export function dataDir(): string {
  return (
    process.env.ARGUS_FL_DATA_DIR ?? path.join(process.cwd(), "data", "federated")
  );
}

const historyPath = () => path.join(dataDir(), "history.json");
const notesPath = () => path.join(dataDir(), "operator-notes.jsonl");

const EMPTY: HistoryFile = { version: 1, runs: [], measurements: [], testSets: {} };

/** One writer at a time within this server process. */
let tail: Promise<unknown> = Promise.resolve();
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

/**
 * A file that exists but cannot be parsed throws rather than reading as
 * empty. Reading it as empty would overwrite the history on the next save.
 */
export async function readHistory(): Promise<HistoryFile> {
  let raw: string;
  try {
    raw = await fs.readFile(historyPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY);
    }
    throw err;
  }
  return { ...structuredClone(EMPTY), ...(JSON.parse(raw) as HistoryFile) };
}

export async function writeHistory(history: HistoryFile): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const target = historyPath();
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(history, null, 2), "utf8");
  await fs.copyFile(target, `${target}.bak`).catch(() => undefined);
  await fs.rename(temp, target);
}

export async function readNotes(node?: string): Promise<OperatorNote[]> {
  let raw: string;
  try {
    raw = await fs.readFile(notesPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const notes: OperatorNote[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      notes.push(JSON.parse(line) as OperatorNote);
    } catch {
      // A torn last line after a hard stop; the rest is still good.
    }
  }
  return node ? notes.filter((note) => note.node === node) : notes;
}

export async function appendNote(note: OperatorNote): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.appendFile(notesPath(), `${JSON.stringify(note)}\n`, "utf8");
}

/** The note in force for each event: the latest, unless it was cleared. */
export function latestNotes(notes: OperatorNote[]): Map<number, OperatorNote> {
  const latest = new Map<number, OperatorNote>();
  for (const note of notes) {
    if (note.kind === "cleared") latest.delete(note.n);
    else latest.set(note.n, note);
  }
  return latest;
}
