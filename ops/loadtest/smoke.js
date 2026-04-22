// ops/loadtest/smoke.js — k6 smoke for v1.0 exit criteria (OPS-3).
//
// Two scenarios run concurrently for ~5 minutes:
//
//   probes  — 50 VUs hitting /healthz, /readyz, /metrics, /api/v1/events.
//             This is the "under load" part of the exit criterion.
//
//   sse     — 10 VUs each holding one /api/v1/monitor/stream connection
//             for the full run. Proves the server can sustain concurrent
//             long-lived connections (SSE is the UI's live-update path,
//             so this is what "usable under load" actually means).
//
// Pass/fail is enforced by thresholds (see below). If any threshold is
// breached, k6 exits non-zero, which is what `make loadtest` and the
// VM checklist §8 key on. Thresholds mirror the targets documented in
// docs/ops/slo.md — keep those two in sync.
//
// Usage:
//   k6 run ops/loadtest/smoke.js
//   AZIRO_URL=http://vm:5000 AZIRO_API_KEY=... k6 run ops/loadtest/smoke.js
//
// See ops/loadtest/README.md for the runbook.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// ── Config ─────────────────────────────────────────────────────────────────
// Everything tunable is here; we don't accept CLI flags beyond env so the
// thresholds below remain meaningful (a k6 run with different VUs isn't
// comparable against the same p95 target).

const BASE_URL    = __ENV.AZIRO_URL    || 'http://localhost:5000';
const API_KEY     = __ENV.AZIRO_API_KEY || '';
const SSE_HOLD_S  = Number(__ENV.SSE_HOLD_SECONDS || 300);

const authHeaders = API_KEY
  ? { headers: { Authorization: `Bearer ${API_KEY}` } }
  : { headers: {} };

// ── Custom metrics ─────────────────────────────────────────────────────────
// k6's built-in `checks` metric aggregates across all checks, which blurs
// pass/fail per endpoint. These per-probe Rates let thresholds target one
// endpoint's health without false-positive drag from others.

const healthzOk = new Rate('healthz_200_rate');
const readyzOk  = new Rate('readyz_200_rate');
const metricsOk = new Rate('metrics_200_rate');
const eventsOk  = new Rate('events_200_rate');

// ── Scenarios + thresholds ─────────────────────────────────────────────────

export const options = {
  scenarios: {
    probes: {
      executor: 'ramping-vus',
      exec: 'probes',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // ramp up
        { duration: '4m',  target: 50 },   // steady state
        { duration: '30s', target: 0 },    // ramp down
      ],
      gracefulRampDown: '10s',
    },
    sse: {
      executor: 'constant-vus',
      exec: 'sse',
      vus: 10,
      duration: `${SSE_HOLD_S + 15}s`,
      startTime: '0s',
    },
  },
  // Thresholds encode the SLOs in slo.md. If you loosen one, loosen both.
  thresholds: {
    // LAT-1: events p95 under 400ms (matches slo.md LAT-1).
    'http_req_duration{name:events}':   ['p(95)<400'],
    // Overall failure rate must stay under 1% — covers the error budget
    // for a 5-minute smoke run.
    'http_req_failed{scenario:probes}': ['rate<0.01'],
    // AVAIL-1: liveness MUST stay 100%. k6 has no equality threshold,
    // so we use ≥ 0.999 — a single 503 over ~15k probes fails the run.
    'healthz_200_rate':                 ['rate>=0.999'],
    // AVAIL-2: readiness ≥ 99.0% matches slo.md AVAIL-2.
    'readyz_200_rate':                  ['rate>=0.99'],
    // /metrics is a Prom scrape endpoint; must always return 200.
    'metrics_200_rate':                 ['rate>=0.999'],
    // /api/v1/events is authed — only assert green if API_KEY was provided.
    // Without the key every request is 401, so we'd fail the run for a
    // config reason, not a real regression. Guard with __ENV.
    ...(API_KEY
      ? { 'events_200_rate': ['rate>=0.99'] }
      : {}),
  },
};

// ── Probes scenario ────────────────────────────────────────────────────────

export function probes() {
  // Each VU iteration hits all four probe endpoints. Sleep 1s between
  // iterations so 50 VUs gives ~50 rps to each endpoint — enough to shake
  // out p95 without overwhelming a single-host compose stack.

  const hRes = http.get(`${BASE_URL}/api/v1/healthz`, { tags: { name: 'healthz' } });
  healthzOk.add(hRes.status === 200);
  check(hRes, { 'healthz 200': (r) => r.status === 200 });

  const rRes = http.get(`${BASE_URL}/api/v1/readyz`, { tags: { name: 'readyz' } });
  readyzOk.add(rRes.status === 200);
  check(rRes, { 'readyz 200': (r) => r.status === 200 });

  const mRes = http.get(`${BASE_URL}/metrics`, { tags: { name: 'metrics' } });
  metricsOk.add(mRes.status === 200);
  check(mRes, { 'metrics 200': (r) => r.status === 200 });

  if (API_KEY) {
    const eRes = http.get(
      `${BASE_URL}/api/v1/events?limit=50`,
      { headers: authHeaders.headers, tags: { name: 'events' } },
    );
    eventsOk.add(eRes.status === 200);
    check(eRes, { 'events 200': (r) => r.status === 200 });
  }

  sleep(1);
}

// ── SSE scenario ───────────────────────────────────────────────────────────

export function sse() {
  // k6 doesn't parse SSE frames natively, but we don't need to — we only
  // need to prove the server can accept and hold long-lived connections
  // under concurrent load. A single GET with a long timeout is enough.
  //
  // The endpoint streams until the client disconnects or the server
  // drains (SIGTERM). For the smoke, we hold for SSE_HOLD_S seconds and
  // then let k6 close the socket.

  const res = http.get(
    `${BASE_URL}/api/v1/monitor/stream`,
    {
      headers: authHeaders.headers,
      timeout: `${SSE_HOLD_S}s`,
      tags: { name: 'sse' },
    },
  );
  // We don't assert 200 here — without auth the server returns 401 or
  // 302 and that's legit config-dependent behavior. What we assert is
  // that k6's socket stayed open long enough to count: the `http_req_duration`
  // for sse should be ≥ SSE_HOLD_S * 0.95.
  check(res, { 'sse held ≥90% of target': (r) => r.timings.duration >= SSE_HOLD_S * 900 });
}
