// Ostium core service: ticket lifecycle, omnichannel intake, AI governance,
// SLA, major incidents, catalog workflows, knowledge, CMDB and audit trail.
import fs from 'node:fs';
import path from 'node:path';
import { buildSeed, CATEGORIES, EXAMPLES } from './seed.js';
import { Classifier, triage as runTriage } from './triage.js';
import { slaStatus } from './sla.js';
import { searchKb, draftFromTicket } from './kb.js';
import { instantiate, completeStep } from './workflow.js';
import { computeMetrics } from './metrics.js';
import { csvEscape } from './util.js';

const STATUSES = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed'];
const AI_FIELDS = ['category', 'priority', 'assignment'];
const MODES = ['suggest', 'approve', 'auto'];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Ostium {
  /** @param {{file?: string|null, now?: () => number}} opts  file=null keeps everything in memory */
  constructor({ file = null, now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.db = null;
    if (file && fs.existsSync(file)) this.db = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (this.db) this.train();
    else this.reset(false);
  }

  // ---------- persistence ----------
  reset(log = true) {
    this.db = buildSeed(this.now());
    this.train();
    this.seedActivity();
    if (log) this.log('system', 'reset', 'database');
    this.save();
    return { ok: true, tickets: this.db.tickets.length };
  }

  save() {
    if (!this.file) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.db, null, 1));
    }, 50);
  }

  /** Run a few requests through the real intake + AI pipeline so a fresh demo has live AI history. */
  seedActivity() {
    const a = this.intake('email', { from: 'chris.walker@county.example', fromName: 'Chris Walker', subject: 'Outlook not syncing email', body: 'No new email since this morning, I cannot send invoices to vendors.' });
    this.decideAi(a.id, 'priority', 'accept', 'lead.agent');
    this.decideAi(a.id, 'assignment', 'accept', 'lead.agent');
    const b = this.intake('teams', { user: 'Linda Park', email: 'linda.park@county.example', text: 'Printer on the 4th floor keeps jamming. Error 13.A on the display.' });
    this.decideAi(b.id, 'priority', 'reject', 'lead.agent');
    this.intake('sms', { from: 'Kevin Brooks', text: 'I clicked a link in a phishing email and typed my password, urgent' });
    this.intake('virtual-agent', { summary: 'Cannot connect to VPN', transcript: 'VPN client says the gateway is unreachable, I am in finance and need it for month-end close', requester: { name: 'Chris Walker', email: 'chris.walker@county.example', department: 'Finance' } });
  }

  train() {
    this.classifier = new Classifier(EXAMPLES);
    // Continuous learning: human-confirmed categories become training data.
    for (const t of this.db.tickets) if (t.ai?.category?.decision === 'accepted') this.classifier.learn(t.category, `${t.title} ${t.description}`);
  }

  log(actor, action, target, detail = {}) {
    const entry = { id: `aud-${this.db.audit.length + 1}`, at: new Date(this.now()).toISOString(), actor, action, target, detail };
    this.db.audit.push(entry);
    return entry;
  }

  // ---------- lookups ----------
  get settings() { return this.db.settings; }

  ticket(id) {
    const t = this.db.tickets.find((x) => x.id === id);
    if (!t) throw new HttpError(404, `Ticket ${id} not found`);
    return t;
  }

  sla(t) {
    const policy = this.settings.slaPolicies.find((p) => p.id === t.priority) || this.settings.slaPolicies[2];
    const cal = this.settings.calendars.find((c) => c.id === policy.calendarId);
    return slaStatus(t, policy, cal, this.now());
  }

  view(t) {
    const tech = this.db.technicians.find((x) => x.id === t.assignee);
    return { ...t, assigneeName: tech?.name || null, sla: this.sla(t) };
  }

  listTickets({ status, priority, department, category, channel, assignee, q, open, sort = 'sla' } = {}) {
    let list = this.db.tickets.filter((t) => !t.mergedInto);
    if (status) list = list.filter((t) => status.split(',').includes(t.status));
    if (open === 'true') list = list.filter((t) => !t.resolvedAt);
    if (priority) list = list.filter((t) => priority.split(',').includes(t.priority));
    if (department) list = list.filter((t) => t.department === department);
    if (category) list = list.filter((t) => t.category === category);
    if (channel) list = list.filter((t) => t.channel === channel);
    if (assignee) list = list.filter((t) => t.assignee === assignee);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((t) => `${t.id} ${t.title} ${t.description} ${t.requester?.name}`.toLowerCase().includes(s));
    }
    const views = list.map((t) => this.view(t));
    const rank = { breached: 0, at_risk: 1, on_track: 2, paused: 3, met: 4 };
    if (sort === 'sla') views.sort((a, b) => rank[a.sla.state] - rank[b.sla.state] || a.sla.resolution.remainingMinutes - b.sla.resolution.remainingMinutes);
    else views.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return views;
  }

  triageContext() {
    return {
      classifier: this.classifier,
      technicians: this.db.technicians,
      tickets: this.db.tickets,
      now: this.now(),
      searchKb: (q, n) => searchKb(this.db.kb, q, n),
    };
  }

  previewTriage(input) {
    return runTriage(input, this.triageContext());
  }

  // ---------- intake ----------
  createTicket(input, actor = 'portal') {
    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    if (!title) throw new HttpError(400, 'title is required');
    const now = new Date(this.now()).toISOString();
    const requester = {
      name: input.requester?.name || 'Anonymous',
      email: input.requester?.email || null,
      department: input.requester?.department || null,
    };
    const prediction = runTriage({ title, description, requester }, this.triageContext());
    const id = `${input.type === 'request' ? 'REQ' : 'INC'}-${this.db.meta.nextId++}`;

    const t = {
      id, type: input.type === 'request' ? 'request' : 'incident', title, description,
      channel: input.channel || 'portal', requester,
      department: CATEGORIES.Software.department, category: 'Unclassified', impact: 2, urgency: 2, priority: 'P3',
      status: 'new', assignmentGroup: 'Service Desk', assignee: null,
      createdAt: now, updatedAt: now, firstResponseAt: null, resolvedAt: null,
      pauses: [], comments: [], links: [], parentId: null, reassignments: 0, csat: null,
      ai: {}, ciIds: input.ciIds || [], tags: input.tags || [],
    };
    if (description) t.comments.push({ id: `c-${id}-0`, author: requester.name, role: 'requester', public: true, body: description, at: now, channel: t.channel });

    // Explicit values (e.g. from a catalog form) win over AI.
    const explicit = { category: input.category, priority: input.priority, assignment: input.assignmentGroup };
    const suggestions = {
      category: { value: prediction.category.value, confidence: prediction.category.confidence, reason: prediction.category.reason, alternatives: prediction.category.alternatives },
      priority: { value: prediction.priority.value, impact: prediction.priority.impact, urgency: prediction.priority.urgency, confidence: prediction.priority.confidence, reason: prediction.priority.reason },
      assignment: { value: prediction.assignment.technician?.id || null, group: prediction.assignment.group, label: prediction.assignment.technician?.name, confidence: prediction.assignment.confidence, reason: prediction.assignment.reason },
    };
    // Category drives department/group even before assignment is decided.
    for (const field of AI_FIELDS) {
      if (explicit[field]) { this.applyField(t, field, field === 'assignment' ? { value: null, group: explicit[field] } : { value: explicit[field] }); continue; }
      const mode = this.settings.aiGovernance[field];
      const s = { ...suggestions[field], mode, decision: mode === 'auto' ? 'auto_applied' : mode === 'approve' ? 'pending' : 'suggested' };
      t.ai[field] = s;
      if (mode === 'auto') this.applyField(t, field, s);
      this.log('ai', mode === 'auto' ? 'ai.auto_applied' : 'ai.suggested', id, {
        field, mode, input: `${title} ${description}`.slice(0, 160), output: s.value, confidence: s.confidence, reason: s.reason,
      });
    }

    // Duplicate detection / merge into an active major incident.
    const dup = prediction.duplicates[0];
    if (dup && dup.similarity >= 0.5) {
      const mode = this.settings.aiGovernance.merge;
      t.ai.merge = { value: dup.id, similarity: dup.similarity, majorIncident: dup.majorIncident, mode, decision: mode === 'auto' ? 'auto_applied' : mode === 'approve' ? 'pending' : 'suggested', confidence: dup.similarity, reason: `Similar to ${dup.id} "${dup.title}"` };
      this.log('ai', mode === 'auto' ? 'ai.auto_applied' : 'ai.suggested', id, { field: 'merge', mode, output: dup.id, confidence: dup.similarity });
    }
    t.suggestedArticles = prediction.knowledge;
    this.db.tickets.push(t);
    if (t.ai.merge?.decision === 'auto_applied') this.merge(t.id, t.ai.merge.value, 'ai');
    this.log(actor, 'ticket.created', id, { channel: t.channel, priority: t.priority });
    this.save();
    return this.view(t);
  }

  /** Normalise inbound messages from email, Teams, SMS, chat or the virtual agent. */
  intake(channel, body = {}) {
    const map = {
      email: () => ({ title: body.subject, description: body.body, requester: { name: body.fromName || body.from, email: body.from } }),
      teams: () => ({ title: (body.text || '').split(/[.!?\n]/)[0].slice(0, 90), description: body.text, requester: { name: body.user, email: body.email } }),
      sms: () => ({ title: (body.text || '').slice(0, 70), description: body.text, requester: { name: body.from, email: null } }),
      chat: () => ({ title: (body.text || '').slice(0, 90), description: body.text, requester: body.requester }),
      'virtual-agent': () => ({ title: body.summary, description: body.transcript, requester: body.requester }),
      mobile: () => body,
      portal: () => body,
    };
    if (!map[channel]) throw new HttpError(400, `Unsupported channel ${channel}`);
    return this.createTicket({ ...map[channel](), channel }, `channel:${channel}`);
  }

  applyField(t, field, s) {
    if (field === 'category') {
      t.category = s.value;
      const meta = CATEGORIES[s.value];
      if (meta) { t.department = meta.department; if (!t.assignee) t.assignmentGroup = meta.group; }
    } else if (field === 'priority') {
      t.priority = s.value;
      if (s.impact) { t.impact = s.impact; t.urgency = s.urgency; }
    } else if (field === 'assignment') {
      if (s.group) t.assignmentGroup = s.group;
      if (s.value) { t.assignee = s.value; if (t.status === 'new') t.status = 'open'; }
    }
  }

  /** Human decision on an AI suggestion — logged with confidence and approver. */
  decideAi(id, field, decision, actor, override) {
    const t = this.ticket(id);
    const s = t.ai?.[field];
    if (!s) throw new HttpError(404, `No AI suggestion for ${field}`);
    if (!['accept', 'reject'].includes(decision)) throw new HttpError(400, 'decision must be accept or reject');
    if (['accepted', 'rejected', 'auto_applied'].includes(s.decision)) throw new HttpError(409, `Suggestion already ${s.decision}`);
    if (decision === 'accept') {
      const applied = override !== undefined ? { ...s, value: override } : s;
      if (field === 'merge') this.merge(id, applied.value, actor);
      else this.applyField(t, field, applied);
      s.decision = 'accepted';
      if (field === 'category') this.classifier.learn(t.category, `${t.title} ${t.description}`);
    } else s.decision = 'rejected';
    s.decidedBy = actor;
    s.decidedAt = new Date(this.now()).toISOString();
    t.updatedAt = s.decidedAt;
    this.log(actor, decision === 'accept' ? 'ai.accepted' : 'ai.rejected', id, { field, value: s.value, override, confidence: s.confidence, acceptedBy: actor });
    this.save();
    return this.view(t);
  }

  // ---------- lifecycle ----------
  updateTicket(id, patch, actor) {
    const t = this.ticket(id);
    const now = new Date(this.now()).toISOString();
    if (patch.status && patch.status !== t.status) {
      if (!STATUSES.includes(patch.status)) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
      const open = t.pauses.find((p) => !p.end);
      if (open && patch.status !== 'pending') open.end = now;
      if (patch.status === 'pending' && !open) t.pauses.push({ start: now, end: null, reason: patch.pauseReason || 'Awaiting requester' });
      if (['resolved', 'closed'].includes(patch.status) && !t.resolvedAt) { t.resolvedAt = now; t.firstResponseAt ||= now; }
      if (['new', 'open', 'in_progress', 'pending'].includes(patch.status) && t.resolvedAt) { t.resolvedAt = null; t.tags = [...new Set([...t.tags, 'reopened'])]; }
      this.log(actor, 'ticket.status', id, { from: t.status, to: patch.status });
      t.status = patch.status;
      if (t.majorIncident && t.resolvedAt) this.closeMajor(t, actor);
    }
    if (patch.assignee !== undefined && patch.assignee !== t.assignee) {
      if (t.assignee) t.reassignments++;
      this.log(actor, 'ticket.assigned', id, { from: t.assignee, to: patch.assignee });
      t.assignee = patch.assignee;
      const tech = this.db.technicians.find((x) => x.id === patch.assignee);
      if (tech) t.assignmentGroup = tech.group;
      if (t.status === 'new') t.status = 'open';
    }
    if (patch.priority && patch.priority !== t.priority) {
      this.log(actor, 'ticket.priority', id, { from: t.priority, to: patch.priority });
      t.priority = patch.priority;
    }
    if (patch.category && patch.category !== t.category) this.applyField(t, 'category', { value: patch.category });
    if (patch.csat) t.csat = Math.max(1, Math.min(5, Number(patch.csat)));
    t.updatedAt = now;
    this.save();
    return this.view(t);
  }

  addComment(id, { body, author, role = 'agent', public: isPublic = true }, actor) {
    const t = this.ticket(id);
    if (!body) throw new HttpError(400, 'body is required');
    const now = new Date(this.now()).toISOString();
    const c = { id: `c-${id}-${t.comments.length + 1}`, author: author || actor, role, public: isPublic, body, at: now };
    t.comments.push(c);
    if (role === 'agent' && !t.firstResponseAt) t.firstResponseAt = now;
    if (role === 'agent' && t.status === 'new') t.status = 'in_progress';
    // A requester reply resumes a paused SLA (two-way update).
    if (role === 'requester' && t.status === 'pending') return this.updateTicket(id, { status: 'in_progress' }, actor);
    t.updatedAt = now;
    this.save();
    return this.view(t);
  }

  merge(id, targetId, actor) {
    const t = this.ticket(id);
    const target = this.ticket(targetId);
    if (t.id === target.id) throw new HttpError(400, 'Cannot merge a ticket into itself');
    if (target.majorIncident) {
      // Link as a child of the major incident: it stays visible and resolves with the parent.
      t.parentId = target.id;
      t.status = target.status === 'new' ? 'open' : target.status;
      t.assignee = target.assignee;
      t.assignmentGroup = target.assignmentGroup;
      t.priority = target.priority;
      target.links = [...new Set([...(target.links || []), t.id])];
      this.log(actor, 'ticket.linked_to_major', t.id, { parent: target.id });
    } else {
      t.mergedInto = target.id;
      t.status = 'closed';
      t.resolvedAt ||= new Date(this.now()).toISOString();
      target.comments.push(...t.comments.map((c) => ({ ...c, id: `${c.id}-m`, mergedFrom: t.id })));
      target.links = [...new Set([...(target.links || []), t.id])];
      this.log(actor, 'ticket.merged', t.id, { into: target.id });
    }
    this.save();
    return this.view(t);
  }

  declareMajor(id, { childIds = [], banner } = {}, actor) {
    const t = this.ticket(id);
    t.majorIncident = true;
    t.priority = 'P1';
    t.tags = [...new Set([...t.tags, 'major-incident'])];
    for (const cid of childIds) if (cid !== id) this.merge(cid, id, actor);
    this.db.banners.push({ id: `ban-${this.db.banners.length + 1}`, ticketId: id, severity: 'critical', text: banner || `Major incident: ${t.title}. We are working on it.`, createdAt: new Date(this.now()).toISOString(), active: true });
    this.log(actor, 'major_incident.declared', id, { children: childIds });
    this.save();
    return this.view(t);
  }

  closeMajor(t, actor) {
    for (const b of this.db.banners) if (b.ticketId === t.id) b.active = false;
    for (const child of this.db.tickets.filter((x) => x.parentId === t.id && !x.resolvedAt)) {
      child.status = 'resolved';
      child.resolvedAt = t.resolvedAt;
      child.comments.push({ id: `c-${child.id}-mi`, author: 'Ostium', role: 'system', public: true, body: `Resolved with major incident ${t.id}.`, at: t.resolvedAt });
    }
    this.log(actor, 'major_incident.resolved', t.id, {});
  }

  // ---------- knowledge ----------
  kbDraft(id, actor) {
    const t = this.ticket(id);
    if (!t.resolvedAt) throw new HttpError(409, 'Only resolved tickets can be turned into articles');
    const mode = this.settings.aiGovernance.kbDraft;
    const a = draftFromTicket(t, `KB-${100 + this.db.kb.length}`);
    if (mode === 'auto') a.status = 'published';
    this.db.kb.push(a);
    this.log('ai', mode === 'auto' ? 'ai.auto_applied' : 'ai.suggested', a.id, { field: 'kbDraft', source: id, mode });
    this.save();
    return a;
  }

  publishArticle(kbId, actor) {
    const a = this.db.kb.find((x) => x.id === kbId);
    if (!a) throw new HttpError(404, 'Article not found');
    a.status = 'published';
    a.approvedBy = actor;
    this.log(actor, 'ai.accepted', kbId, { field: 'kbDraft', acceptedBy: actor });
    this.save();
    return a;
  }

  // ---------- catalog & workflow ----------
  requestCatalogItem(itemId, values = {}, requester, actor) {
    const item = this.db.catalog.find((c) => c.id === itemId);
    if (!item) throw new HttpError(404, 'Catalog item not found');
    for (const f of item.fields) {
      if (values[f.key] === undefined && f.default !== undefined) values[f.key] = f.default;
      if (f.required && (values[f.key] === undefined || values[f.key] === '')) throw new HttpError(400, `${f.label} is required`);
      if (f.type === 'number' && values[f.key] !== undefined) values[f.key] = Number(values[f.key]);
      if (f.type === 'checkbox') values[f.key] = values[f.key] === true || values[f.key] === 'true' || values[f.key] === 'on';
    }
    const summary = item.fields.map((f) => `${f.label}: ${values[f.key] ?? '—'}`).join('\n');
    const view = this.createTicket({
      type: 'request', channel: 'portal', title: `${item.name}${values.employeeName ? ` — ${values.employeeName}` : ''}`,
      description: summary, requester, category: item.category, priority: 'P3', assignmentGroup: CATEGORIES[item.category]?.group,
    }, actor);
    const t = this.ticket(view.id);
    t.catalogItem = item.id;
    t.form = values;
    t.workflow = instantiate(item.workflow, values);
    this.log(actor, 'workflow.started', t.id, { item: item.id });
    this.save();
    return this.view(t);
  }

  workflowStep(id, stepId, decision, actor) {
    const t = this.ticket(id);
    if (!t.workflow) throw new HttpError(400, 'Ticket has no workflow');
    completeStep(t.workflow, stepId, decision, actor, t.form || {});
    this.log(actor, 'workflow.step', id, { stepId, decision });
    if (t.workflow.status === 'completed') return this.updateTicket(id, { status: 'resolved' }, 'workflow');
    if (t.workflow.status === 'rejected') return this.updateTicket(id, { status: 'closed' }, 'workflow');
    if (t.status === 'new') t.status = 'in_progress';
    this.save();
    return this.view(t);
  }

  // ---------- CMDB ----------
  impact(assetId) {
    const a = this.db.assets.find((x) => x.id === assetId);
    if (!a) throw new HttpError(404, 'Asset not found');
    const services = this.db.assets.filter((s) => s.dependsOn?.includes(assetId));
    const ids = new Set([assetId, ...services.map((s) => s.id)]);
    const tickets = this.db.tickets.filter((t) => !t.resolvedAt && t.ciIds?.some((c) => ids.has(c))).map((t) => ({ id: t.id, title: t.title, priority: t.priority }));
    return { asset: a, impactedServices: services, dependencies: (a.dependsOn || []).map((d) => this.db.assets.find((x) => x.id === d)), openTickets: tickets };
  }

  // ---------- reporting ----------
  metrics(filter = {}) {
    let tickets = this.db.tickets;
    if (filter.department) tickets = tickets.filter((t) => t.department === filter.department);
    return computeMetrics(tickets, (t) => this.sla(t), this.db.audit, this.now());
  }

  setGovernance(patch, actor) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in this.settings.aiGovernance)) throw new HttpError(400, `Unknown AI action ${k}`);
      if (!MODES.includes(v)) throw new HttpError(400, `Mode must be one of ${MODES.join(', ')}`);
    }
    Object.assign(this.settings.aiGovernance, patch);
    this.log(actor, 'settings.ai_governance', 'settings', patch);
    this.save();
    return this.settings.aiGovernance;
  }

  exportCsv() {
    const cols = ['id', 'type', 'title', 'status', 'priority', 'category', 'department', 'channel', 'assignmentGroup', 'assignee', 'createdAt', 'firstResponseAt', 'resolvedAt', 'slaState', 'csat'];
    const rows = this.db.tickets.map((t) => {
      const v = { ...t, slaState: this.sla(t).state };
      return cols.map((c) => csvEscape(v[c])).join(',');
    });
    return [cols.join(','), ...rows].join('\n');
  }
}
