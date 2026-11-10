// Shapes shared by the labeling screen, the federated page and their
// server routes. Sample / GateResult mirror the node's real JSON
// (src/federated/store.py recent(), model_state.accept_candidate()).

export const LABEL_NAMES = [
  "routine_person",
  "routine_vehicle",
  "routine_animal",
  "routine_package",
  "anomaly",
] as const;
export type LabelName = (typeof LABEL_NAMES)[number];

export const ROUTINE_CLASSES = ["person", "vehicle", "animal", "package"] as const;
export type RoutineClass = (typeof ROUTINE_CLASSES)[number];

/** rounds.py refuses a round below this many labelled rows on a node. */
export const MIN_LABELS_PER_NODE = 200;

export interface SampleFeatures {
  class: string;
  width: number;
  height: number;
  centre_x: number;
  centre_y: number;
  speed: number;
  dwell: number;
  confidence: number;
}

export interface SampleMeta {
  snapshot?: string;
  crop?: string;
  box?: [number, number, number, number];
  track_id?: number;
  frames?: number;
  duration_s?: number;
  source?: string;
  synthetic?: boolean;
  stationary?: boolean;
}

/** Who decided a label. Missing on nodes that predate provenance. */
export interface LabelProvenance {
  origin: "human" | "machine";
  source: string;
  reviewed: boolean;
  review?: "blind" | "correct" | "accept";
  suggested_label?: LabelName;
  suggested_source?: string;
  via?: string;
  at?: number;
}

export interface Sample {
  id: string;
  n: number | null;
  t: number;
  label: LabelName | null;
  provenance?: LabelProvenance | null;
  features: SampleFeatures;
  meta: SampleMeta;
}

export interface ProvenanceCounts {
  reviewed: number;
  reviewed_blind: number;
  reviewed_corrected: number;
  reviewed_accepted: number;
  reviewed_anomalies: number;
  machine_unreviewed: number;
}

/** The machine's guess for an event. Kept apart from labels on the node. */
export interface Suggestion {
  n: number;
  id: string;
  label: LabelName;
  source: string;
  confidence: number | null;
  uncertainty: number | null;
  rule_label: LabelName;
  model_label: LabelName | null;
  disagree: boolean;
  at: number;
}

export interface SuggestionsResponse {
  count: number;
  generated_at: number | null;
  suggestions: Suggestion[];
}

export interface GenerateResult {
  generated: number;
  suggested_anomalies: number;
  excluded: number;
  model: string | null;
  generated_at: number;
}

/** What the operator did on an event, sent with the label. */
export interface ReviewPayload {
  kind: "blind" | "correct" | "accept";
  suggested_label?: LabelName;
  suggested_source?: string;
  via?: string;
}

export interface SampleStats {
  total: number;
  labelled: number;
  unlabelled: number;
  per_label: Record<LabelName, number>;
  provenance?: ProvenanceCounts;
  path?: string;
}

export interface SamplesResponse {
  stats: SampleStats;
  samples: Sample[];
}

// --- Operator notes: decisions kept on the console, never sent to a node ---

/**
 * train = label already written to the node (kept as an audit trail).
 * test = label held back on the console, for the frozen test set.
 * skip = look at it later. not_object = the detector saw nothing real.
 * cleared = cancels the note before it.
 */
export type NoteKind = "train" | "test" | "skip" | "not_object" | "cleared";

export interface OperatorNote {
  node: string;
  n: number;
  kind: NoteKind;
  label?: LabelName;
  detector?: string;
  queue?: string;
  at: number;
}

// --- Federated history ---

export interface GateScore {
  loss: number;
  accuracy: number;
  balanced_accuracy: number;
  anomaly_recall: number | null;
}

export interface GateResult {
  accepted: boolean;
  source?: string;
  first_model?: boolean;
  current?: GateScore;
  candidate?: GateScore;
  tolerance?: number;
  loss_tolerance?: number;
  min_anomaly_recall?: number;
  val_samples?: number;
  at?: number;
  rounds?: number;
  run_dir?: string;
  version?: number;
  label?: string;
  reason?: string | null;
  exit_code?: number;
}

export interface FitLog {
  round: number;
  epochs: number;
  secs: number;
  loss: number;
  acc: number;
  bal_acc: number;
}

export interface GlobalLog {
  round: number;
  loss: number;
  acc: number;
  bal_acc: number;
}

export interface NodeRun {
  nodeId: string;
  nodeName: string;
  reportedName?: string;
  started: number;
  runDir: string;
  running: boolean;
  exitCode: number | null;
  trainSamples?: number;
  valSamples?: number;
  /** True when the round trained only on labels a person reviewed. */
  humanOnly?: boolean;
  labelsReviewed?: number;
  labelsMachine?: number;
  fits: FitLog[];
  globals: GlobalLog[];
  result: GateResult | null;
  syntheticRows?: number;
  capturedAt: number;
}

export interface ClientResult {
  client: string;
  node: string;
  loss: number;
  accuracy: number;
  samples: number;
}

export interface ScreeningDetail {
  node_id: string;
  accepted: boolean;
  reason: string;
  norm: number;
  cosine: number | null;
}

export interface Aggregation {
  accepted: string[];
  rejected: string[];
  consensus_applied: boolean;
  median_norm: number;
  note: string;
  detail: ScreeningDetail[];
}

export interface ServerRound {
  key: string;
  round_num: number;
  timestamp: string;
  global_loss: number;
  global_accuracy: number;
  num_clients: number;
  client_results: ClientResult[];
  duration_seconds: number;
  model_version: number;
  aggregation: Aggregation | null;
}

export interface FlowerConfig {
  aggregation?: string;
  local_epochs?: number;
  min_clients?: number;
  rounds?: number;
  batch_size?: number;
  learning_rate?: number;
}

export interface RunRecord {
  id: string;
  startedAt: number;
  nodes: NodeRun[];
  serverRounds: ServerRound[];
  serverConfig?: FlowerConfig;
}

/** One scoring of a node's live head against its frozen test set. */
export interface TestMeasurement {
  node: string;
  at: number;
  modelVersion: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Labelled on the node since freezing, so no longer unseen. Excluded. */
  contaminated: number;
  /** No longer returned by the node. Excluded. */
  missing: number;
}

export interface TestSetState {
  frozenAt: number | null;
}

export interface HistoryFile {
  version: 1;
  runs: RunRecord[];
  measurements: TestMeasurement[];
  testSets: Record<string, TestSetState>;
}

// --- Pre-flight ---

export interface DetectorClassStat {
  confirmed: number;
  corrected: number;
}

export interface DetectorQuality {
  byClass: Record<string, DetectorClassStat>;
  notObject: number;
}

export interface PreflightNode {
  id: string;
  name: string;
  online: boolean;
  needsSignIn: boolean;
  error?: string;
  reportedName?: string;
  accelerator?: string;
  modelVersion?: string;
  total?: number;
  /** Everything the node counts, which would include any synthetic rows. */
  labelledOnNode?: number;
  /** Real camera rows only. Null when the rows could not be read. */
  realLabelled: number | null;
  realAnomalies: number | null;
  /** Labels a person looked at. Null when the rows could not be read. */
  labelsReviewed: number | null;
  labelsMachine: number | null;
  reviewedAnomalies: number | null;
  /** False when the node's code predates provenance, so all count as machine. */
  provenanceReported: boolean | null;
  perLabel?: Partial<Record<LabelName, number>>;
  syntheticRows: number | null;
  roundRunning?: boolean;
  scheduler?: { enabled: boolean; server?: string; nextDueAt?: string };
  flwrHandChecked: string | null;
  detector: DetectorQuality | null;
  testSet: {
    size: number;
    anomalies: number;
    frozenAt: number | null;
  };
}

export interface PreflightServer {
  up: boolean;
  error?: string;
  status?: {
    status: string;
    current_round: number;
    connected_clients: number;
    registered_nodes: number;
    model_version: number;
    total_rounds: number;
  };
  config?: FlowerConfig;
  /** Live TCP connections on :8080 from this machine's netstat. */
  establishedClients: number | null;
  flwrHandChecked: string | null;
}

export interface PreflightCheck {
  level: "blocker" | "warning";
  text: string;
}

export interface PreflightResponse {
  checkedAt: number;
  nodes: PreflightNode[];
  server: PreflightServer;
  checks: PreflightCheck[];
}

export interface HistoryResponse {
  history: HistoryFile;
  dataDir: string;
  errors: string[];
}
