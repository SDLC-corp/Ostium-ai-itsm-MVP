import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessMinutes, businessMinutesBetween, slaStatus } from '../src/sla.js';
import { CALENDARS } from '../src/seed.js';

const biz = CALENDARS.find((c) => c.id === 'us-business');
const always = CALENDARS.find((c) => c.id === '24x7');

test('24x7 calendar counts wall-clock minutes', () => {
  const start = Date.parse('2026-11-07T10:00:00Z'); // a Saturday
  assert.equal(addBusinessMinutes(start, 240, always), start + 240 * 60000);
});

test('business calendar skips nights and weekends (America/New_York)', () => {
  // Friday 2026-11-06 16:00 EST (21:00Z) + 2 business hours → Monday 09:00 EST (14:00Z)
  const due = addBusinessMinutes(Date.parse('2026-11-06T21:00:00Z'), 120, biz);
  assert.equal(new Date(due).toISOString(), '2026-11-09T14:00:00.000Z');
});

test('business calendar skips holidays (Thanksgiving)', () => {
  // Wed 2026-11-25 16:00 EST + 2h → Thu 26 and Fri 27 are holidays → Mon 30 09:00 EST
  const due = addBusinessMinutes(Date.parse('2026-11-25T21:00:00Z'), 120, biz);
  assert.equal(new Date(due).toISOString(), '2026-11-30T14:00:00.000Z');
});

test('DST transition is handled (EDT → EST on 2026-11-01)', () => {
  // Fri 2026-10-30 08:00 EDT is 12:00Z; Mon 2026-11-02 08:00 EST is 13:00Z
  const due = addBusinessMinutes(Date.parse('2026-10-30T12:00:00Z'), 9 * 60, biz);
  assert.equal(new Date(due).toISOString(), '2026-10-30T21:00:00.000Z');
  const next = addBusinessMinutes(Date.parse('2026-10-30T12:00:00Z'), 9 * 60 + 30, biz);
  assert.equal(new Date(next).toISOString(), '2026-11-02T13:30:00.000Z');
});

test('pauses are excluded from elapsed business time', () => {
  const a = '2026-11-09T14:00:00Z', b = '2026-11-09T18:00:00Z'; // Mon 09:00-13:00 EST
  assert.equal(businessMinutesBetween(a, b, biz), 240);
  const pauses = [{ start: '2026-11-09T15:00:00Z', end: '2026-11-09T16:00:00Z' }];
  assert.equal(businessMinutesBetween(a, b, biz, pauses), 180);
});

test('slaStatus reports at-risk, breach and escalation levels', () => {
  const policy = { id: 'P1', responseMinutes: 15, resolutionMinutes: 240 };
  const created = Date.parse('2026-11-09T10:00:00Z');
  const t = { createdAt: new Date(created).toISOString(), pauses: [], firstResponseAt: null, resolvedAt: null };
  assert.equal(slaStatus(t, policy, always, created + 60 * 60000).state, 'on_track');
  const risk = slaStatus(t, policy, always, created + 200 * 60000);
  assert.equal(risk.state, 'at_risk');
  assert.equal(risk.escalation.level, 2);
  const breach = slaStatus(t, policy, always, created + 300 * 60000);
  assert.equal(breach.state, 'breached');
  assert.equal(breach.escalation.level, 3);
});

test('open pause marks the SLA as paused and extends the due date', () => {
  const policy = { id: 'P1', responseMinutes: 15, resolutionMinutes: 240 };
  const created = Date.parse('2026-11-09T10:00:00Z');
  const t = { createdAt: new Date(created).toISOString(), firstResponseAt: null, resolvedAt: null, pauses: [{ start: new Date(created + 60 * 60000).toISOString(), end: null }] };
  const s = slaStatus(t, policy, always, created + 120 * 60000);
  assert.equal(s.state, 'paused');
  assert.equal(s.resolution.pausedMinutes, 60);
  assert.equal(s.resolution.dueAt, new Date(created + 300 * 60000).toISOString());
});
