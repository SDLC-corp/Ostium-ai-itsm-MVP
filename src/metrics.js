// Service desk analytics: SLA compliance, MTTR, first-contact resolution,
// backlog aging, CSAT, channel / department mix, AI acceptance and chargeback.
import { DAY, HOUR, round } from './util.js';

const COST_PER_TICKET = { P1: 180, P2: 95, P3: 45, P4: 25 }; // illustrative chargeback rates (USD)

export function computeMetrics(tickets, slaOf, audit, now = Date.now(), { days = 14 } = {}) {
  const live = tickets.filter((t) => !t.mergedInto);
  const resolved = live.filter((t) => t.resolvedAt);
  const open = live.filter((t) => !t.resolvedAt);
  const sla = new Map(live.map((t) => [t.id, slaOf(t)]));

  const mttrHours = resolved.length
    ? resolved.reduce((a, t) => a + (Date.parse(t.resolvedAt) - Date.parse(t.createdAt)), 0) / resolved.length / HOUR
    : 0;
  const fcr = resolved.filter((t) => !t.reassignments && t.comments.filter((c) => c.role === 'agent').length <= 2).length;
  const met = resolved.filter((t) => sla.get(t.id).state === 'met').length;
  const rated = resolved.filter((t) => t.csat);

  const aging = { '<1d': 0, '1-3d': 0, '3-7d': 0, '>7d': 0 };
  for (const t of open) {
    const age = (now - Date.parse(t.createdAt)) / DAY;
    aging[age < 1 ? '<1d' : age < 3 ? '1-3d' : age < 7 ? '3-7d' : '>7d']++;
  }

  const count = (list, key) => list.reduce((acc, t) => ((acc[key(t)] = (acc[key(t)] || 0) + 1), acc), {});

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now - i * DAY);
    start.setUTCHours(0, 0, 0, 0);
    const s = start.getTime(), e = s + DAY;
    trend.push({
      date: start.toISOString().slice(0, 10),
      created: live.filter((t) => { const c = Date.parse(t.createdAt); return c >= s && c < e; }).length,
      resolved: resolved.filter((t) => { const c = Date.parse(t.resolvedAt); return c >= s && c < e; }).length,
    });
  }

  const ai = audit.filter((a) => a.actor === 'ai' || a.action?.startsWith('ai.'));
  const accepted = ai.filter((a) => a.action === 'ai.accepted').length;
  const rejected = ai.filter((a) => a.action === 'ai.rejected').length;
  const auto = ai.filter((a) => a.action === 'ai.auto_applied').length;

  const chargeback = {};
  for (const t of live) chargeback[t.department] = (chargeback[t.department] || 0) + (COST_PER_TICKET[t.priority] || 0);

  return {
    generatedAt: new Date(now).toISOString(),
    totals: { all: live.length, open: open.length, resolved: resolved.length },
    slaCompliance: resolved.length ? round((met / resolved.length) * 100) : null,
    slaAtRisk: open.filter((t) => sla.get(t.id).state === 'at_risk').length,
    slaBreachedOpen: open.filter((t) => sla.get(t.id).state === 'breached').length,
    mttrHours: round(mttrHours),
    firstContactResolution: resolved.length ? round((fcr / resolved.length) * 100) : null,
    csat: rated.length ? round(rated.reduce((a, t) => a + t.csat, 0) / rated.length, 2) : null,
    backlogByPriority: count(open, (t) => t.priority),
    aging,
    byChannel: count(live, (t) => t.channel),
    byDepartment: count(live, (t) => t.department),
    byCategory: count(live, (t) => t.category),
    trend,
    ai: { accepted, rejected, autoApplied: auto, acceptanceRate: accepted + rejected ? round((accepted / (accepted + rejected)) * 100) : null },
    chargebackUsd: chargeback,
  };
}
