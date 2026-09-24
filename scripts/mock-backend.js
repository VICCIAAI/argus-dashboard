// Local stand-in for Mohammed's real FastAPI backend (see the "Backend
// contract" section of CLAUDE.md / README). Not the real backend, not
// Python, not persisted anywhere — just enough to run the whole
// dashboard end to end while the real API doesn't exist yet.
//
// Accepts any username/password on login. Run alongside `npm run dev`:
//   npm run mock-backend
const http = require("http");

const PORT = process.env.MOCK_BACKEND_PORT || 8000;
const ALLOWED_ORIGIN = process.env.MOCK_BACKEND_ORIGIN || "http://localhost:3000";

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

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
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
