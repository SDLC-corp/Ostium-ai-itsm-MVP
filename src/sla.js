// SLA engine: business-hours-aware timers with time zones, holidays,
// pause rules (e.g. "Pending - awaiting customer") and multi-stage escalation.
import { MIN, toTs } from './util.js';

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();

function partsInTz(ts, timeZone) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] };
}

function tzOffset(ts, timeZone) {
  const p = partsInTz(ts, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}

/** Convert a wall-clock time in `timeZone` to a UTC timestamp (DST-safe). */
export function zonedToUtc(y, m, d, h, mi, timeZone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffset(guess, timeZone);
  let ts = guess - off;
  const off2 = tzOffset(ts, timeZone);
  if (off2 !== off) ts = guess - off2;
  return ts;
}

/** Yields working windows [start, end) at or after `from`, in UTC ms. */
export function* windowsFrom(from, cal) {
  if (cal.always) {
    yield [from, Infinity];
    return;
  }
  const p = partsInTz(from, cal.timeZone);
  const holidays = new Set(cal.holidays || []);
  for (let i = 0; i < 3660; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hours = cal.hours[day.getUTCDay()];
    if (!hours || holidays.has(key)) continue;
    const ws = zonedToUtc(y, m, d, hours[0], 0, cal.timeZone);
    const we = zonedToUtc(y, m, d, hours[1], 0, cal.timeZone);
    if (we <= from) continue;
    yield [Math.max(ws, from), we];
  }
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Business minutes between a and b, excluding paused intervals. */
export function businessMinutesBetween(a, b, cal, pauses = []) {
  a = toTs(a); b = toTs(b);
  if (b <= a) return 0;
  let total = 0;
  for (const [ws, we] of windowsFrom(a, cal)) {
    if (ws >= b) break;
    const s = ws, e = Math.min(we, b);
    let w = e - s;
    for (const p of pauses) w -= overlap(s, e, toTs(p.start), toTs(p.end));
    total += Math.max(0, w);
    if (we >= b) break;
  }
  return total / MIN;
}

/** Timestamp reached after spending `minutes` of business time from `start`. */
export function addBusinessMinutes(start, minutes, cal) {
  let remaining = minutes * MIN;
  for (const [ws, we] of windowsFrom(toTs(start), cal)) {
    if (we - ws >= remaining) return ws + remaining;
    remaining -= we - ws;
  }
  throw new Error('SLA horizon exceeded');
}

export const DEFAULT_ESCALATION = [
  { at: 0.5, level: 1, notify: 'Assignee' },
  { at: 0.75, level: 2, notify: 'Team lead' },
  { at: 1.0, level: 3, notify: 'Service owner' },
];

/**
 * Compute live SLA state for a ticket.
 * state: met | breached | paused | at_risk | on_track
 */
export function slaStatus(ticket, policy, cal, now = Date.now(), escalation = DEFAULT_ESCALATION) {
  const created = toTs(ticket.createdAt);
  const pauses = (ticket.pauses || []).map((p) => ({ start: toTs(p.start), end: p.end ? toTs(p.end) : now }));
  const paused = (ticket.pauses || []).some((p) => !p.end);
  const respEnd = ticket.firstResponseAt ? toTs(ticket.firstResponseAt) : now;
  const resEnd = ticket.resolvedAt ? toTs(ticket.resolvedAt) : now;

  const responseElapsed = businessMinutesBetween(created, respEnd, cal);
  const resolutionElapsed = businessMinutesBetween(created, resEnd, cal, pauses);
  const pausedMinutes = pauses.reduce((acc, p) => acc + businessMinutesBetween(p.start, Math.min(p.end, resEnd), cal), 0);

  const response = {
    targetMinutes: policy.responseMinutes,
    elapsedMinutes: Math.round(responseElapsed),
    dueAt: new Date(addBusinessMinutes(created, policy.responseMinutes, cal)).toISOString(),
    met: ticket.firstResponseAt ? responseElapsed <= policy.responseMinutes : null,
  };
  const pct = resolutionElapsed / policy.resolutionMinutes;
  let state;
  if (ticket.resolvedAt) state = pct <= 1 ? 'met' : 'breached';
  else if (pct > 1) state = 'breached';
  else if (paused) state = 'paused';
  else if (pct >= 0.75) state = 'at_risk';
  else state = 'on_track';

  const reached = escalation.filter((e) => pct >= e.at);
  const level = ticket.resolvedAt ? 0 : reached.length ? reached[reached.length - 1].level : 0;

  return {
    policyId: policy.id,
    calendarId: cal.id,
    state,
    percentUsed: Math.round(pct * 100),
    response,
    resolution: {
      targetMinutes: policy.resolutionMinutes,
      elapsedMinutes: Math.round(resolutionElapsed),
      remainingMinutes: Math.round(policy.resolutionMinutes - resolutionElapsed),
      pausedMinutes: Math.round(pausedMinutes),
      dueAt: new Date(addBusinessMinutes(created, policy.resolutionMinutes + pausedMinutes, cal)).toISOString(),
    },
    escalation: {
      level,
      notify: level ? escalation.find((e) => e.level === level).notify : null,
    },
  };
}
