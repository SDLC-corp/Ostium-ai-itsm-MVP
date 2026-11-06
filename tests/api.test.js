import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Ostium } from '../src/service.js';
import { createApiHandler } from '../src/api.js';

async function withServer(opts, fn) {
  const app = new Ostium({ file: null });
  const handler = createApiHandler(app, opts);
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x')));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/v2`;
  try { await fn(base); } finally { server.close(); }
}

test('REST API: create incident, fetch, patch, comment', () =>
  withServer({ apiKey: '' }, async (base) => {
    const res = await fetch(`${base}/incidents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'ERP application error on save', description: 'purchase orders fail' }) });
    assert.equal(res.status, 201);
    const t = await res.json();
    assert.match(t.id, /^INC-/);
    assert.equal(t.category, 'Software');
    const got = await (await fetch(`${base}/tickets/${t.id}`)).json();
    assert.equal(got.sla.policyId, 'P3');
    const patched = await (await fetch(`${base}/tickets/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress', assignee: 'tech-07' }) })).json();
    assert.equal(patched.assigneeName, 'Tom Nguyen');
    const c = await (await fetch(`${base}/tickets/${t.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'On it' }) })).json();
    assert.ok(c.firstResponseAt);
  }));

test('REST API: errors are JSON with proper status codes', () =>
  withServer({ apiKey: '' }, async (base) => {
    assert.equal((await fetch(`${base}/tickets/NOPE`)).status, 404);
    assert.equal((await fetch(`${base}/tickets`, { method: 'POST', body: '{bad json' })).status, 400);
    assert.equal((await fetch(`${base}/tickets`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  }));

test('REST API: API key required for writes when configured', () =>
  withServer({ apiKey: 'secret' }, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const body = JSON.stringify({ title: 'x' });
    assert.equal((await fetch(`${base}/tickets`, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(`${base}/tickets`, { method: 'POST', body, headers: { 'x-api-key': 'secret' } })).status, 201);
  }));

test('REST API: rate limiting returns 429', () =>
  withServer({ apiKey: '', rateLimit: 3 }, async (base) => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/health`)).status);
    assert.ok(codes.includes(429));
  }));

test('REST API: CSV export and triage preview', () =>
  withServer({ apiKey: '' }, async (base) => {
    const csv = await fetch(`${base}/export/tickets.csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const p = await (await fetch(`${base}/triage`, { method: 'POST', body: JSON.stringify({ title: 'Cannot connect to VPN', description: 'gateway unreachable for everyone' }) })).json();
    assert.equal(p.category.value, 'Network');
    assert.ok(p.duplicates.some((d) => d.majorIncident));
  }));
