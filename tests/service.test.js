import test from 'node:test';
import assert from 'node:assert/strict';
import { Ostium } from '../src/service.js';
import { priorityMatrix } from '../src/triage.js';
import { instantiate, completeStep } from '../src/workflow.js';

const fresh = () => new Ostium({ file: null });

test('ITIL priority matrix', () => {
  assert.equal(priorityMatrix(1, 1), 'P1');
  assert.equal(priorityMatrix(1, 2), 'P2');
  assert.equal(priorityMatrix(2, 2), 'P3');
  assert.equal(priorityMatrix(3, 3), 'P4');
});

test('AI triage classifies common requests', () => {
  const app = fresh();
  const cases = {
    'Outlook not receiving email': 'Email & Collaboration',
    'Printer on 3rd floor keeps jamming': 'Hardware',
    'I clicked a link in a phishing email': 'Security',
    'Need password reset, account locked': 'Access & Identity',
    'Air conditioning broken in the office': 'Facilities',
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(app.previewTriage({ title: text }).category.value, expected, text);
});

test('outage language raises priority to P1', () => {
  const app = fresh();
  const p = app.previewTriage({ title: 'Network outage', description: 'Entire department cannot work, urgent' });
  assert.equal(p.priority.value, 'P1');
});

test('governance: auto applies category, approve keeps priority pending until accepted', () => {
  const app = fresh();
  const t = app.createTicket({ title: 'Outlook not syncing email', description: 'urgent, cannot send email to the whole team' });
  assert.equal(t.category, 'Email & Collaboration');
  assert.equal(t.ai.category.decision, 'auto_applied');
  assert.equal(t.ai.priority.decision, 'pending');
  assert.equal(t.priority, 'P3'); // provisional until a person approves
  const after = app.decideAi(t.id, 'priority', 'accept', 'lead.agent');
  assert.equal(after.priority, t.ai.priority.value);
  const audit = app.db.audit.at(-1);
  assert.equal(audit.action, 'ai.accepted');
  assert.equal(audit.detail.acceptedBy, 'lead.agent');
  assert.throws(() => app.decideAi(t.id, 'priority', 'accept', 'x'), /already/);
});

test('governance modes are validated and switchable', () => {
  const app = fresh();
  assert.throws(() => app.setGovernance({ priority: 'yolo' }), /Mode/);
  app.setGovernance({ priority: 'auto', assignment: 'auto' });
  const t = app.createTicket({ title: 'Laptop battery will not charge' });
  assert.equal(t.ai.priority.decision, 'auto_applied');
  assert.ok(t.assignee, 'technician auto-assigned');
  assert.equal(t.status, 'open');
});

test('duplicate of an active major incident is linked as a child and resolves with it', () => {
  const app = fresh();
  app.setGovernance({ merge: 'auto' });
  const major = app.db.tickets.find((t) => t.majorIncident);
  const t = app.createTicket({ title: 'Cannot connect to VPN', description: 'VPN client says the gateway is unreachable' });
  assert.equal(t.parentId, major.id);
  app.updateTicket(major.id, { status: 'resolved' }, 'agent');
  assert.ok(app.ticket(t.id).resolvedAt, 'child resolved with parent');
  assert.equal(app.db.banners.filter((b) => b.ticketId === major.id && b.active).length, 0);
});

test('pending status pauses SLA and a requester reply resumes it', () => {
  const app = fresh();
  const t = app.createTicket({ title: 'Install Adobe Acrobat' });
  app.updateTicket(t.id, { status: 'pending' }, 'agent');
  assert.equal(app.view(app.ticket(t.id)).sla.state, 'paused');
  const v = app.addComment(t.id, { body: 'Here is the info', role: 'requester' }, 'requester');
  assert.equal(v.status, 'in_progress');
  assert.ok(app.ticket(t.id).pauses[0].end);
});

test('omnichannel intake normalises email and Teams messages', () => {
  const app = fresh();
  const e = app.intake('email', { from: 'a@b.gov', subject: 'Excel crashes', body: 'Excel crashes on the budget workbook' });
  assert.equal(e.channel, 'email');
  assert.equal(e.requester.email, 'a@b.gov');
  const m = app.intake('teams', { user: 'Sam', text: 'Teams audio not working. No sound on headset.' });
  assert.equal(m.title, 'Teams audio not working');
  assert.throws(() => app.intake('fax', {}), /Unsupported/);
});

test('catalog request runs a conditional, parallel workflow to completion', () => {
  const app = fresh();
  const t = app.requestCatalogItem('cat-laptop', { assetTag: 'LT-1', reason: 'Damaged', estimatedCost: 900 }, { name: 'A' }, 'u');
  const step = (id) => app.ticket(t.id).workflow.steps.find((s) => s.id === id);
  assert.equal(step('mgr').status, 'active');
  app.workflowStep(t.id, 'mgr', 'approve', 'manager');
  assert.equal(step('fin').status, 'skipped', 'finance approval skipped under $1,500');
  app.workflowStep(t.id, 'procure', 'done', 'tech');
  const done = app.workflowStep(t.id, 'migrate', 'done', 'tech');
  assert.equal(done.workflow.status, 'completed');
  assert.equal(done.status, 'resolved');
});

test('workflow rejection cancels downstream steps', () => {
  const wf = instantiate([{ id: 'a', type: 'approval' }, { id: 'b', type: 'task', dependsOn: ['a'] }], {});
  completeStep(wf, 'a', 'reject', 'boss', {});
  assert.equal(wf.status, 'rejected');
  assert.equal(wf.steps[1].status, 'cancelled');
});

test('catalog validation rejects missing required fields', () => {
  const app = fresh();
  assert.throws(() => app.requestCatalogItem('cat-purchase', { item: 'Chairs' }, {}, 'u'), /required/);
});

test('KB draft from resolved ticket requires approval to publish', () => {
  const app = fresh();
  const t = app.db.tickets.find((x) => x.resolvedAt && !x.mergedInto);
  const a = app.kbDraft(t.id, 'agent');
  assert.equal(a.status, 'draft');
  assert.equal(app.publishArticle(a.id, 'kb.owner').status, 'published');
});

test('CMDB impact maps a CI to the services it supports', () => {
  const app = fresh();
  const r = app.impact('ci-fw-core-01');
  assert.deepEqual(r.impactedServices.map((s) => s.id).sort(), ['svc-erp', 'svc-vpn']);
});

test('metrics are computed', () => {
  const m = fresh().metrics();
  assert.ok(m.totals.all > 50);
  assert.ok(m.slaCompliance > 50 && m.slaCompliance <= 100);
  assert.equal(m.trend.length, 14);
  assert.ok(m.mttrHours > 0);
});

test('CSV export has a header and one row per ticket', () => {
  const app = fresh();
  const lines = app.exportCsv().split('\n');
  assert.match(lines[0], /^id,type,title/);
  assert.equal(lines.length, app.db.tickets.length + 1);
});
