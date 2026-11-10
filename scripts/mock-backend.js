// Local stand-in for Mohammed's real FastAPI backend (see the "Backend
// contract" section of CLAUDE.md / README). Not the real backend, not
// Python, not persisted anywhere — just enough to run the whole
// dashboard end to end while the real API doesn't exist yet.
//
// Accepts any username/password on login. Run alongside `npm run dev`:
//   npm run mock-backend
//
// For the federated pages, run one of these per pretend node:
//   MOCK_FL=1 MOCK_NODE_NAME="Mock A" MOCK_BACKEND_PORT=8101 node scripts/mock-backend.js
// and one aggregator stand-in:
//   MOCK_ROLE=flower MOCK_BACKEND_PORT=8190 node scripts/mock-backend.js
// MOCK_ROUND=1 adds a finished round, MOCK_SYNTHETIC=n adds synthetic rows.
// MOCK_LEGACY=n labels the first n rows as rule-derived, with no provenance.
// MOCK_OLD_NODE=1 behaves like a node from before label provenance.
// Everything these serve is invented for testing. Point a test console at
// them with its own ARGUS_FL_DATA_DIR, so none of it reaches real history.
const http = require("http");

const PORT = process.env.MOCK_BACKEND_PORT || 8000;
const ALLOWED_ORIGIN = process.env.MOCK_BACKEND_ORIGIN || "http://localhost:3000";
const MOCK_FL = process.env.MOCK_FL === "1";
const ROLE = process.env.MOCK_ROLE || "node";
const NODE_NAME = process.env.MOCK_NODE_NAME || "Mock";
const OLD_NODE = process.env.MOCK_OLD_NODE === "1";

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeMockJwt(username) {
  const header = base64url({ alg: "none", typ: "JWT" });
  const payload = base64url({
    sub: username || "operator",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  });
  return `${header}.${payload}.mock-signature`;
}

const events = [
  { id: 1, cls: "person", zone: "Front door", node: "Node A", ts: new Date(Date.now() - 45_000).toISOString(), status: "member", label: "Household member", confidence: 97, confirmed: 1 },
  { id: 2, cls: "person", zone: "Backyard", node: "Node B", ts: new Date(Date.now() - 180_000).toISOString(), status: "stranger", label: "Unrecognized person", confidence: 82, confirmed: 0 },
  { id: 3, cls: "vehicle", zone: "Driveway", node: "Node A", ts: new Date(Date.now() - 420_000).toISOString(), status: "na", label: "Vehicle", confidence: 91, confirmed: 0 },
  { id: 4, cls: "package", zone: "Front door", node: "Node A", ts: new Date(Date.now() - 900_000).toISOString(), status: "na", label: "Package delivery", confidence: 95, confirmed: 1 },
  { id: 5, cls: "animal", zone: "Backyard", node: "Node B", ts: new Date(Date.now() - 1_500_000).toISOString(), status: "na", label: "Animal", confidence: 76, confirmed: 0 },
];

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

// --- Federated fixtures ---------------------------------------------------

const LABELS = ["routine_person", "routine_vehicle", "routine_animal", "routine_package", "anomaly"];
const CLASSES = ["person", "person", "person", "person", "person", "person", "person", "person", "vehicle", "package"];

function seeded(i) {
  const x = Math.sin(i * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const samples = [];
const SAMPLE_COUNT = Number(process.env.MOCK_SAMPLES || 260);
for (let i = 1; i <= SAMPLE_COUNT; i += 1) {
  const r = seeded(i);
  const cls = CLASSES[Math.floor(seeded(i + 1000) * CLASSES.length)];
  const dwell = i % 13 === 0 ? 0.95 : Number((r * 0.6).toFixed(4));
  const left = Number((0.2 + seeded(i + 7) * 0.5).toFixed(4));
  const top = Number((0.2 + seeded(i + 8) * 0.4).toFixed(4));
  samples.push({
    id: `mock-${i}`,
    n: i,
    t: Date.now() / 1000 - (SAMPLE_COUNT - i) * 90,
    label: null,
    features: {
      class: cls,
      width: 0.2,
      height: 0.3,
      centre_x: left + 0.1,
      centre_y: top + 0.15,
      speed: Number((seeded(i + 2) * 0.5).toFixed(4)),
      dwell,
      confidence: Number((0.5 + seeded(i + 3) * 0.49).toFixed(4)),
    },
    meta: {
      snapshot: i % 40 === 0 ? undefined : `mock-${i}.jpg`,
      box: [left, top, left + 0.2, top + 0.3],
      track_id: i,
      duration_s: Number((dwell * 30).toFixed(3)),
      source: "camera",
      synthetic: false,
      stationary: dwell > 0.9,
    },
  });
}
// Rule-derived labels from before provenance: dwell says anomaly, the rest
// copy the detector. No provenance field, like a real node's existing rows.
for (let i = 0; i < Math.min(Number(process.env.MOCK_LEGACY || 0), samples.length); i += 1) {
  const row = samples[i];
  row.label = row.features.dwell >= 0.9 ? "anomaly" : `routine_${row.features.class}`;
}
for (let i = 0; i < Number(process.env.MOCK_SYNTHETIC || 0); i += 1) {
  const n = SAMPLE_COUNT + i + 1;
  samples.push({
    id: `syn-${n}`, n, t: Date.now() / 1000, label: "routine_person",
    features: { class: "person", width: 0.1, height: 0.2, centre_x: 0.5, centre_y: 0.5, speed: 0, dwell: 0.1, confidence: 0.9 },
    meta: { synthetic: true, site: "driveway" },
  });
}

function provenanceOf(row) {
  if (!row.label) return null;
  return row.prov ?? { origin: "machine", source: "legacy:rule-derived", reviewed: false };
}

function publicRow(row) {
  if (OLD_NODE) return row;
  const { prov, ...rest } = row;
  void prov;
  return { ...rest, provenance: provenanceOf(row) };
}

function provenanceCounts() {
  const out = { reviewed: 0, reviewed_blind: 0, reviewed_corrected: 0, reviewed_accepted: 0, reviewed_anomalies: 0, machine_unreviewed: 0 };
  const kinds = { blind: "reviewed_blind", correct: "reviewed_corrected", accept: "reviewed_accepted" };
  for (const row of samples) {
    const prov = provenanceOf(row);
    if (!prov) continue;
    if (!prov.reviewed) { out.machine_unreviewed += 1; continue; }
    out.reviewed += 1;
    if (kinds[prov.review]) out[kinds[prov.review]] += 1;
    if (row.label === "anomaly") out.reviewed_anomalies += 1;
  }
  return out;
}

function sampleStats() {
  const per = Object.fromEntries(LABELS.map((name) => [name, 0]));
  for (const row of samples) if (row.label) per[row.label] += 1;
  const labelled = samples.filter((row) => row.label).length;
  const stats = { total: samples.length, labelled, unlabelled: samples.length - labelled, per_label: per, path: "/mock/samples.jsonl" };
  return OLD_NODE ? stats : { ...stats, provenance: provenanceCounts() };
}

// Same shape as the node's suggest.py. Uncertain enough, for some rows, that
// a test can see the review order and the batch cut-off do something.
let suggestions = [];
let suggestedAt = null;

function makeSuggestions(exclude) {
  const skip = new Set(exclude);
  suggestedAt = Date.now() / 1000;
  suggestions = samples
    .filter((row) => !row.meta.synthetic && !skip.has(row.n) && !provenanceOf(row)?.reviewed)
    .map((row) => {
      const rule = row.features.class === "person" && row.features.dwell >= 0.9 ? "anomaly" : `routine_${row.features.class}`;
      return {
        n: row.n,
        id: row.id,
        label: rule,
        source: "rule:dwell>=0.9",
        confidence: null,
        uncertainty: seeded(row.n + 50) < 0.15 ? 0.45 : null,
        rule_label: rule,
        model_label: null,
        disagree: false,
        at: suggestedAt,
      };
    });
}

// Fixed "head" so a test can predict what the event feed reports.
const flaggedByHead = (n) => n % 13 === 0 || n % 29 === 0;

function eventOf(row) {
  const confirmed = row.label ? 1 : 0;
  const stranger = confirmed ? row.label === "anomaly" : flaggedByHead(row.n);
  return {
    id: row.n,
    cls: row.features.class,
    zone: "Mock zone",
    node: NODE_NAME,
    ts: new Date(row.t * 1000).toISOString(),
    status: stranger ? "stranger" : "na",
    label: stranger ? "Unusual for this site" : row.features.class,
    confidence: Math.round(row.features.confidence * 100),
    confirmed,
  };
}

function snapshotSvg(n, cls) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1b2a33"/><text x="20" y="40" fill="#9fb3bf" font-family="monospace" font-size="20">MOCK SNAPSHOT #${n} (${cls})</text></svg>`;
}

const MODEL_VERSION = process.env.MOCK_ROUND === "1" ? "fl-r1" : "untrained";
const GATE = {
  accepted: true,
  source: "federated",
  first_model: true,
  current: { loss: 1.6, accuracy: 0.2, balanced_accuracy: 0.2, anomaly_recall: 0 },
  candidate: { loss: 0.7, accuracy: 0.8, balanced_accuracy: 0.71, anomaly_recall: 0.6 },
  tolerance: 0.01,
  min_anomaly_recall: 0.5,
  val_samples: 40,
  at: Date.now() / 1000 - 60,
  version: 1,
  label: "fl-r1",
};
const ROUND_STARTED = Date.now() / 1000 - 200;

function roundStatus() {
  if (process.env.MOCK_ROUND !== "1") {
    return { running: false, exit_code: null, started: null, run_dir: null, result: null, log: [] };
  }
  return {
    running: false,
    exit_code: 0,
    started: ROUND_STARTED,
    run_dir: `/mock/fl_rounds/mock-${NODE_NAME.replace(/\s/g, "")}`,
    result: GATE,
    log: [
      JSON.stringify({ kind: "ready", train: 160, val: 40 }),
      JSON.stringify({ kind: "fit", round: 1, epochs: 12, secs: 3.1, loss: 0.82, acc: 0.74, bal_acc: 0.61 }),
      JSON.stringify({ kind: "global", round: 1, loss: 0.7, acc: 0.8, bal_acc: 0.71 }),
    ],
  };
}

function handleFlower(req, res, path) {
  if (req.method !== "GET") return send(res, 405, { error: "mock flower is read-only" });
  if (path === "/api/status") {
    return send(res, 200, { status: "running", fl_server_address: "0.0.0.0:8080", total_rounds: 1, current_round: 0, global_loss: 0, global_accuracy: 0, connected_clients: 0, model_version: 0, registered_nodes: 0 });
  }
  if (path === "/api/config") {
    return send(res, 200, { aggregation: "robust", local_epochs: 12, min_clients: 3, rounds: 1, batch_size: 16, learning_rate: 0.001 });
  }
  if (path === "/api/training/history") {
    if (process.env.MOCK_ROUND !== "1") return send(res, 200, []);
    return send(res, 200, [{
      round_num: 1,
      timestamp: new Date((ROUND_STARTED + 120) * 1000).toISOString(),
      global_loss: 0.7,
      global_accuracy: 0.8,
      num_clients: 3,
      duration_seconds: 120,
      model_version: 1,
      client_results: [{ client: "c1", node: "Mock A", loss: 0.8, accuracy: 0.7, samples: 160 }],
      aggregation: {
        accepted: ["Mock A"], rejected: ["Mock B"], accepted_count: 1, rejected_count: 1,
        consensus_applied: true, median_norm: 1.2, note: "trimmed mean over 1 updates",
        detail: [
          { node_id: "Mock A", accepted: true, reason: "accepted", norm: 1.1, cosine: 0.8 },
          { node_id: "Mock B", accepted: false, reason: "direction disagrees with consensus (cos=-0.210)", norm: 1.4, cosine: -0.21 },
        ],
      },
    }]);
  }
  return send(res, 404, { error: "not found" });
}

function handleFederated(req, res, path, query) {
  if (req.method === "GET" && path === "/api/status") {
    send(res, 200, { fps: 12, accelerator: "Mock", model_version: MODEL_VERSION, nodes_online: 1, node: NODE_NAME, samples: sampleStats() });
    return true;
  }
  if (req.method === "GET" && path === "/api/events") {
    const limit = Number(query.get("limit") || 50);
    const rows = samples.filter((row) => !row.meta.synthetic).slice(-limit).reverse();
    send(res, 200, rows.map(eventOf));
    return true;
  }
  if (req.method === "GET" && path === "/api/federated/samples") {
    const limit = Number(query.get("limit") || 50);
    send(res, 200, { stats: sampleStats(), samples: samples.slice(-limit).reverse().map(publicRow) });
    return true;
  }
  if (!OLD_NODE && req.method === "GET" && path === "/api/federated/suggestions") {
    const live = suggestions.filter((item) => {
      const row = samples.find((candidate) => candidate.n === item.n);
      return row && !provenanceOf(row)?.reviewed;
    });
    send(res, 200, { count: live.length, generated_at: suggestedAt, suggestions: live });
    return true;
  }
  if (!OLD_NODE && req.method === "POST" && path === "/api/federated/suggestions/generate") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const exclude = JSON.parse(body || "{}").exclude || [];
      makeSuggestions(exclude);
      send(res, 200, { generated: suggestions.length, suggested_anomalies: suggestions.filter((s) => s.label === "anomaly").length, excluded: exclude.length, model: null, generated_at: suggestedAt });
    });
    return true;
  }
  if (req.method === "GET" && path === "/api/federated/round") {
    send(res, 200, roundStatus());
    return true;
  }
  if (req.method === "GET" && path === "/api/federated/status") {
    send(res, 200, { enabled: false, running: false, interval_days: 14, detail: "Scheduler not started" });
    return true;
  }
  if (req.method === "GET" && path === "/api/federated/head") {
    send(res, 200, { params: 205445, features: 19, classes: LABELS, samples: sampleStats(), last_metrics: null, model: { version: MODEL_VERSION === "untrained" ? 0 : 1, label: MODEL_VERSION, last_decision: MODEL_VERSION === "untrained" ? null : GATE } });
    return true;
  }
  const snapshot = path.match(/^\/api\/events\/(\d+)\/snapshot$/);
  if (req.method === "GET" && snapshot) {
    const row = samples.find((item) => item.n === Number(snapshot[1]));
    if (!row || !row.meta.snapshot) {
      send(res, 404, { detail: "No snapshot for this event" });
      return true;
    }
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(snapshotSvg(row.n, row.features.class));
    return true;
  }
  const label = path.match(/^\/api\/events\/(\d+)\/label$/);
  if (req.method === "POST" && label) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const row = samples.find((item) => item.n === Number(label[1]));
      if (!row) return send(res, 404, { detail: "not found" });
      const payload = JSON.parse(body || "{}");
      if (payload.action !== "correct" || !LABELS.includes(payload.label)) {
        return send(res, 422, { detail: "mock expects correct + exact label" });
      }
      const review = OLD_NODE ? undefined : payload.review;
      if (!review && provenanceOf(row)?.reviewed) {
        return send(res, 409, { detail: "already reviewed by a person" });
      }
      if (review?.kind === "accept" && review.suggested_label !== payload.label) {
        return send(res, 422, { detail: "an accepted suggestion must match the label" });
      }
      if (review?.kind === "correct" && review.suggested_label === payload.label) {
        return send(res, 422, { detail: "a correction must differ from the suggestion" });
      }
      row.label = payload.label;
      row.prov = review
        ? { origin: review.kind === "accept" ? "machine" : "human", source: review.kind === "accept" ? review.suggested_source : "operator", reviewed: true, review: review.kind, suggested_label: review.suggested_label, suggested_source: review.suggested_source, via: review.via, at: Date.now() / 1000 }
        : { origin: "machine", source: "api:unattributed", reviewed: false, at: Date.now() / 1000 };
      const reply = { ok: true, id: row.n, label: row.label, labelled_total: sampleStats().labelled };
      send(res, 200, OLD_NODE ? reply : { ...reply, provenance: provenanceOf(row) });
    });
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://mock");

  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  if (ROLE === "flower") {
    handleFlower(req, res, url.pathname);
    return;
  }

  if (req.method === "POST" && req.url === "/api/login") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let username = "operator";
      try {
        username = JSON.parse(body || "{}").username || username;
      } catch {
        // malformed body — fall back to the default username
      }
      send(res, 200, { access_token: makeMockJwt(username) });
    });
    return;
  }

  if (MOCK_FL && handleFederated(req, res, url.pathname, url.searchParams)) return;

  if (req.method === "GET" && req.url === "/api/status") {
    send(res, 200, {
      fps: 24,
      accelerator: "Hailo-8",
      model_version: "fl-2026.09.10-r3",
      nodes_online: 2,
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/events") {
    send(res, 200, events);
    return;
  }

  if (req.method === "POST" && /^\/api\/events\/\d+\/label$/.test(req.url)) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      // Persist within the process only, so a Confirm on the alerts page
      // survives the next poll instead of springing back.
      const id = Number(req.url.split("/")[3]);
      const target = events.find((event) => event.id === id);
      if (target) {
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          // malformed body — treat as a bare confirm
        }
        if (payload.action === "confirm") target.confirmed = 1;
        if (payload.action === "correct" && payload.label) {
          target.label = payload.label;
        }
      }
      send(res, 200, { ok: true });
    });
    return;
  }

  // No fake video here. The camera endpoints belong to the node; the
  // live page renders its "camera unavailable" state against this, which
  // is the honest thing to show when there is no Pi on the other end.
  if (req.method === "GET" && /^\/api\/camera\/(stream|snapshot)/.test(req.url)) {
    send(res, 503, { error: "No camera on the mock backend — run against a node" });
    return;
  }

  send(res, 404, { error: "not found" });
});

// A trickle of new events, so the polling fallback and the alerts badge
// visibly do something without a node attached.
const ZONES = ["Front door", "Driveway", "Backyard", "Side gate"];
let nextId = events.length + 1;

setInterval(() => {
  const isAlert = Math.random() < 0.3;
  const cls = isAlert
    ? "person"
    : ["person", "vehicle", "package", "animal"][Math.floor(Math.random() * 4)];

  events.unshift({
    id: nextId++,
    cls,
    zone: ZONES[Math.floor(Math.random() * ZONES.length)],
    node: Math.random() < 0.5 ? "Node A" : "Node B",
    ts: new Date().toISOString(),
    status: isAlert ? "stranger" : "na",
    label: isAlert ? "Unusual for this site (person)" : cls[0].toUpperCase() + cls.slice(1),
    confidence: 70 + Math.floor(Math.random() * 30),
    confirmed: 0,
  });

  events.length = Math.min(events.length, 50);
}, 20_000).unref?.();

server.listen(PORT, () => {
  console.log(`Mock ARGUS backend listening on http://localhost:${PORT}`);
  console.log("Endpoints: POST /api/login, GET /api/status, GET /api/events, POST /api/events/:id/label");
  console.log("Camera endpoints answer 503 — the live feed needs a real node.");
});
