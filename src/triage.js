// Explainable AI triage: a multinomial Naive Bayes classifier for category,
// ITIL impact x urgency matrix for priority, and skill + workload scoring for
// technician recommendation. Runs fully offline — no external model calls —
// so every prediction is reproducible and auditable.
import { tokenize, jaccard } from './util.js';
import { CATEGORIES, EXAMPLES } from './seed.js';

/** ITIL 4 style priority matrix: impact (1 high..3 low) x urgency (1..3). */
export function priorityMatrix(impact, urgency) {
  return ['P1', 'P2', 'P3', 'P3', 'P4'][impact + urgency - 2];
}

const IMPACT_HIGH = ['all', 'everyone', 'nobody', 'department', 'outage', 'entire', 'whole', 'multiple', 'floor', 'building', 'team', 'branch', 'server'];
const IMPACT_MED = ['team', 'several', 'group', 'shared', 'site'];
const URGENCY_HIGH = ['urgent', 'asap', 'down', 'outage', 'blocked', 'cannot', 'cant', 'unable', 'immediately', 'critical', 'emergency', 'month-end', 'deadline', 'stolen', 'malware', 'phishing', 'leak', 'clicked'];
const URGENCY_MED = ['slow', 'error', 'fail', 'crash', 'not working', 'intermittent', 'drop', 'locked'];

export class Classifier {
  constructor(examples = EXAMPLES) {
    this.counts = {};
    this.totals = {};
    this.docs = {};
    this.vocab = new Set();
    this.n = 0;
    for (const [label, title, desc] of examples) this.learn(label, `${title} ${desc}`);
  }

  learn(label, text) {
    const toks = tokenize(text);
    this.counts[label] ??= {};
    this.totals[label] ??= 0;
    this.docs[label] = (this.docs[label] || 0) + 1;
    this.n++;
    for (const t of toks) {
      this.counts[label][t] = (this.counts[label][t] || 0) + 1;
      this.totals[label]++;
      this.vocab.add(t);
    }
  }

  predict(text) {
    const toks = tokenize(text);
    const V = this.vocab.size;
    const scores = Object.keys(this.counts).map((label) => {
      let lp = Math.log(this.docs[label] / this.n);
      const evidence = [];
      for (const t of toks) {
        const c = this.counts[label][t] || 0;
        lp += Math.log((c + 1) / (this.totals[label] + V));
        if (c) evidence.push(t);
      }
      return { label, lp, evidence };
    });
    const max = Math.max(...scores.map((s) => s.lp));
    const z = scores.reduce((a, s) => a + Math.exp(s.lp - max), 0);
    for (const s of scores) s.p = Math.exp(s.lp - max) / z;
    scores.sort((a, b) => b.p - a.p);
    return scores;
  }
}

function scoreLevel(text, high, med) {
  const lower = ` ${text.toLowerCase()} `;
  const hits = (list) => list.filter((w) => lower.includes(w.includes(' ') ? w : ` ${w}`));
  const h = hits(high);
  if (h.length) return { level: 1, evidence: h };
  const m = hits(med);
  if (m.length) return { level: 2, evidence: m };
  return { level: 3, evidence: [] };
}

/** Recommend a technician in the group, balancing skills against open workload. */
export function recommendTechnician(category, technicians, tickets) {
  const group = CATEGORIES[category]?.group;
  const open = (id) => tickets.filter((t) => t.assignee === id && !t.resolvedAt).length;
  const ranked = technicians
    .filter((t) => t.group === group || t.skills.includes(category))
    .map((t) => {
      const load = open(t.id);
      const skill = t.skills[0] === category ? 2 : t.skills.includes(category) ? 1 : 0;
      return { id: t.id, name: t.name, group: t.group, openTickets: load, score: +(skill * 2 + (t.group === group ? 1 : 0) - load * 0.35).toFixed(2) };
    })
    .sort((a, b) => b.score - a.score);
  return ranked;
}

/** Find open tickets that look like duplicates of the incoming text. */
export function findDuplicates(text, tickets, { requesterEmail, now = Date.now(), threshold = 0.34 } = {}) {
  const toks = tokenize(text);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const best = new Map();
  for (const t of tickets) {
    if (t.resolvedAt || t.mergedInto || now - Date.parse(t.createdAt) >= 7 * 864e5) continue;
    let sim = jaccard(toks, tokenize(`${t.title} ${t.description}`));
    if (requesterEmail && t.requester?.email === requesterEmail) sim += 0.1;
    // Children of a major incident roll up to the parent, so new reports join the incident.
    const target = t.parentId && byId.get(t.parentId) ? byId.get(t.parentId) : t;
    if (target.majorIncident) sim += 0.08;
    if (sim > (best.get(target.id)?.similarity ?? -1)) {
      best.set(target.id, { id: target.id, title: target.title, status: target.status, majorIncident: !!target.majorIncident, similarity: +Math.min(1, sim).toFixed(2) });
    }
  }
  return [...best.values()]
    .filter((d) => d.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

/**
 * Full triage of an incoming request. Returns predictions with confidence and
 * human-readable reasons, ready to be gated by the AI governance policy.
 */
export function triage({ title = '', description = '', requester } = {}, ctx) {
  const text = `${title} ${description}`;
  const ranked = ctx.classifier.predict(text);
  const top = ranked[0];
  const impact = scoreLevel(text, IMPACT_HIGH, IMPACT_MED);
  // Security events always carry at least medium impact.
  if (top.label === 'Security' && impact.level > 2) { impact.level = 2; impact.evidence = ['security event']; }
  const urgency = scoreLevel(text, URGENCY_HIGH, URGENCY_MED);
  const priority = priorityMatrix(impact.level, urgency.level);
  const techs = recommendTechnician(top.label, ctx.technicians, ctx.tickets);
  const meta = CATEGORIES[top.label];

  return {
    category: {
      value: top.label,
      confidence: +top.p.toFixed(2),
      alternatives: ranked.slice(1, 3).map((s) => ({ value: s.label, confidence: +s.p.toFixed(2) })),
      reason: top.evidence.length ? `Matched terms: ${[...new Set(top.evidence)].slice(0, 6).join(', ')}` : 'No strong terms — low confidence',
    },
    priority: {
      value: priority,
      impact: impact.level,
      urgency: urgency.level,
      confidence: +(0.55 + 0.15 * (impact.evidence.length > 0) + 0.15 * (urgency.evidence.length > 0)).toFixed(2),
      reason: `Impact ${impact.level} (${impact.evidence.join(', ') || 'single user'}) x Urgency ${urgency.level} (${urgency.evidence.join(', ') || 'no time pressure'})`,
    },
    assignment: {
      group: meta.group,
      department: meta.department,
      technician: techs[0] || null,
      alternatives: techs.slice(1, 3),
      confidence: +Math.min(0.95, top.p * 0.9 + 0.05).toFixed(2),
      reason: techs[0] ? `${techs[0].name}: skill match, ${techs[0].openTickets} open tickets` : 'No technician available',
    },
    duplicates: findDuplicates(text, ctx.tickets, { requesterEmail: requester?.email, now: ctx.now }),
    knowledge: ctx.searchKb(text, 3),
  };
}
