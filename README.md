# ARGUS Dashboard

Frontend for **ARGUS**, a two-node, privacy-preserving AI home security
system (senior design). Each camera is a Raspberry Pi 5 node doing
on-device detection and face recognition; nodes personalize a shared
model via federated learning. No video, face crop, or embedding ever
leaves the property — this dashboard only ever sees the derived event
data (class, zone, confidence, labels), never raw footage.

This repo is the **dashboard, alerting, and event-labeling UI** only —
not the detection pipeline, not federated learning, and not the
backend/API/database (see [Backend contract](#backend-contract) for
what this frontend expects from that backend).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4

## What's here

- **Auth** — login form → JWT issued by the backend → stored as an
  **HttpOnly cookie** (never touches client-side JS or `localStorage`).
  A route guard (`proxy.ts`) reads the cookie server-side to gate
  `/dashboard`.
- **Side-by-side console** (`/dashboard`) — every node in `ARGUS_NODES`
  on one screen, and the landing page after login. Each panel fetches
  and fails on its own and shows:
  - the node's MJPEG camera stream;
  - **status**: FPS, accelerator, model version and SoC temperature,
    with connecting / online / offline / sign-in-needed states;
  - **recent events**, flagging `stranger` detections in red. Clicking
    one opens the shared detail panel as an overlay, with **Confirm** /
    **Correct** wired to `POST /api/events/{id}/label` on that node, and
    "Back to live view" (or Esc) closes it while the streams keep running.
- **Per-node sessions** — each node issues its own tokens, so the
  browser holds one HttpOnly cookie per node (`argus_session_<node id>`).
  The login page signs in to the picked node; a panel without a session
  shows its own sign-in form for that node. A password is only sent to
  the node named on the form and is never stored. The single-node pages
  need a session on the picked node.
- **Live feed** (`/dashboard/live`) — the node's MJPEG camera stream
  (`GET /api/camera/stream`) beside the last few detections, so you can
  watch a detection happen and label it in the same view. The camera
  panel has its own connecting / streaming / no-signal states and a
  retry, since the stream fails independently of the rest of the page.
- **Alerts feed** (`/dashboard/alerts`) — only what the node flagged
  (`status: "stranger"`, the head's "unusual for this site" call).
  Unreviewed alerts sort above reviewed ones whatever their timestamp,
  with the event's stored still (`GET /api/events/{id}/snapshot`) when
  the node kept one, and the same Confirm / Correct actions. A badge in
  the nav carries the unreviewed count across all three pages.
- **Live push** — `connectEventsSocket()` is now actually called (see
  `hooks/useEventFeed.ts`): events arrive on `WS /ws/events`, and a
  socket that never opens or dies falls back to polling `/api/events`
  every 5s. The mode badge says which is in effect — "live push" is
  never shown for a poll.
- **Authenticated proxy** (`app/api/argus/[...path]/route.ts`) — the JWT
  is an HttpOnly cookie on the *dashboard's* origin, so a client-side
  fetch to the node can't carry it, and every real route sits behind
  `require_auth`. Browser calls go to `/api/argus/<suffix>` on this
  origin; the route reads that node's cookie server-side and adds
  `Authorization: Bearer` on the way out. `?node=<id>` picks the node
  (an id from `ARGUS_NODES`, never a URL); without it, the node picked
  in the nav is used. Allowlisted paths only —
  status, events, labels, event stills, camera stream/snapshot — and
  it's what makes an `<img>` able to show an authenticated MJPEG stream
  at all.
- **Label events** (`/dashboard/label`) — per-node queue of unlabelled real
  events with their stills. Routine or Anomaly in one tap or key (R, A, 1 to
  4 for the class, S skip, X no object, U undo), plus a bulk view that only
  arms once every picture has rendered. A label waits 6 s on the console
  before it goes to the node, because the node cannot clear one. Labels
  are sent as `correct` with an exact label name, and the node's reply is
  checked. A separate **test set** stays on the console, is never sent to
  the node, and is frozen to measure each model.
- **Federated** (`/dashboard/federated`) — pre-flight read of real state,
  whether things are improving on the frozen test set, per-node gate
  charts, run history. Starts nothing: the proxy allowlist contains no
  round or bootstrap route.
- **Federated history on disk** — `data/federated/history.json` and
  `operator-notes.jsonl` (gitignored; `ARGUS_FL_DATA_DIR` moves them).
  The aggregator and the nodes do not keep this, so leave the Federated
  page open during a round. Flower's REST address is
  `ARGUS_FLOWER_API`, default `http://localhost:8090`.
- **Design system** — dark, deliberately non-adaptive theme (see
  `app/globals.css`): near-black background, monospace for
  timestamps/data, a single teal accent reserved for "live" status,
  red reserved for actual security alerts (stranger events, offline
  state) — not used as decoration.
- **A throwaway mock backend** (`scripts/mock-backend.js`) so the whole
  app runs before Mohammed's real FastAPI backend exists. It is
  **not** the real backend — no persistence, hardcoded sample events,
  accepts any username/password.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # adjust if your backend isn't on :8000
```

Run the app and a backend side by side — two terminals:

```bash
# Terminal 1 — mock backend (skip this once the real backend exists;
# just point NEXT_PUBLIC_API_BASE_URL at it instead)
npm run mock-backend

# Terminal 2 — the dashboard
npm run dev
```

Open `http://localhost:3000`. Any username/password works against the
mock backend.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Where the FastAPI backend (real or mock) lives. |
| `ARGUS_NODES` | unset | Nodes for the nav's node picker, `Name=URL` comma separated (e.g. `Node A=http://10.0.0.140:8000,Node B=http://10.0.0.128:8000`). Server-side only: the proxy reaches a node by its id in this list, never a URL from the browser. Unset = one node at `NEXT_PUBLIC_API_BASE_URL`. |
| `NEXT_PUBLIC_WS_EVENTS_URL` | derived from the above | Override if the WS endpoint lives somewhere else. |
| `AUTH_COOKIE_SECURE` | `false` | Set to `true` only once the device serves HTTPS. See the comment in `lib/config.ts` — this is a deliberate LAN-vs-TLS decision, not a build-mode side effect. |

## Backend contract

The frontend is built against this contract (FastAPI, JWT auth,
SQLite) — implement against this shape and no frontend changes should
be needed:

- `POST /api/login` → `{ access_token }` — expected to move to a
  `Set-Cookie` response once the backend sets the HttpOnly cookie
  itself; until then, `app/api/auth/login/route.ts` sets it on the
  backend's behalf.
- `GET /api/status` → `{ fps, accelerator, model_version, nodes_online }`
- `GET /api/events` → array of event records
- `POST /api/events/{id}/label` → `{ action: "confirm" | "correct", label? }`
- `WS /ws/events` → live-pushed event objects, same shape as below
- `GET /api/camera/stream` → `multipart/x-mixed-replace` MJPEG
- `GET /api/camera/snapshot` → `image/jpeg`
- `GET /api/events/{id}/snapshot` → `image/jpeg`, 404 when the event has
  no stored still

All of these except the WS endpoint are reached through
`/api/argus/<suffix>` rather than directly, so they carry the session
token — see "Authenticated proxy" above.

Event record:

```json
{
  "id": 1,
  "cls": "person",
  "zone": "Front door",
  "node": "Node A",
  "ts": "2026-09-13T20:13:04Z",
  "status": "member",
  "label": "Household member",
  "confidence": 97,
  "confirmed": 0
}
```

`cls`: `person | vehicle | package | animal` · `status`: `member | stranger | na`

## Project layout

```
app/
  login/            login page
  dashboard/        side-by-side console (home)
  dashboard/live/   camera stream + recent detections
  dashboard/alerts/ flagged events only, with stills
  api/auth/         login/logout/session route handlers (cookie logic lives here)
  api/argus/        server-side proxy to the node, adds the bearer token
  page.tsx          "/" — pure auth-state redirect, not a real page
components/
  NodePanel.tsx     one node on the side-by-side console
  NodeSignIn.tsx    a panel's sign-in form for its node
  StatusStrip.tsx, EventList.tsx, EventDetailPanel.tsx, StatusDot.tsx
  DashboardNav.tsx  shared header/nav, carries the alert count
  LiveFeed.tsx      MJPEG panel + its own failure states
  FeedModeBadge.tsx says whether events are pushed or polled
  dev/TestOfflineToggle.tsx   ← see "Known gaps" below
hooks/
  useEventFeed.ts   WS feed with a polling fallback, shared by all pages
  useNodeHealth.ts  one panel's status and temperature polling
lib/
  api.ts            typed client for the backend contract above
  AuthContext.tsx   global auth state (session status only, never the JWT)
  config.ts         API base URL, cookie name/security flag
  format.ts         timestamp formatting
hooks/
  useAuth.ts
proxy.ts            server-side route guard (Next 16's renamed middleware)
scripts/
  mock-backend.js   dev-only backend stand-in, see above
```

## Known gaps / next steps

- **WS auth is unenforced.** The node's `/ws/events` takes no token
  today, so the live socket connects straight to the backend origin
  rather than through the proxy. If that endpoint ever requires auth,
  the socket needs the same server-side hop the REST calls now take.
- **No alert notifications.** The alerts feed has to be open to be
  seen; nothing pushes to the operator when the page is closed.
- **`components/dev/TestOfflineToggle.tsx` is a QA aid, not a
  feature.** It fakes the offline status-strip look without touching
  the real connection, for visual testing. Nothing wires it in since
  `/dashboard` became the side-by-side view; any place it's wired in
  is marked `// TEST ONLY — remove before final build` — grep for that
  string before shipping.
- **HTTPS is an open decision, not solved.** `AUTH_COOKIE_SECURE`
  defaults to `false` (LAN-only HTTP). If this ever needs to run
  behind TLS, or if the two nodes end up exposed on separate hosts
  instead of one shared address, the cookie/CORS setup here will need
  revisiting — see the comment in `lib/config.ts`.
- **Mock vs. real backend.** `scripts/mock-backend.js` answers 503 on
  the camera endpoints — there is no fake video, so the live page shows
  its "camera unavailable" state unless you point at a real node. It
  keeps labels only in memory, and invents an event every 20s so the
  polling fallback visibly does something. Swapping in the real backend is
  just pointing `NEXT_PUBLIC_API_BASE_URL` at it — no frontend code
  changes required as long as it matches the contract above.

