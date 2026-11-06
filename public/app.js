// Ostium web console — vanilla JS single-page app over the /api/v2 REST API.
const $view = document.getElementById('view');
const USER = 'demo.agent';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(`/api/v2${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-ostium-user': USER },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const fmtMin = (m) => {
  const neg = m < 0; m = Math.abs(Math.round(m));
  const h = Math.floor(m / 60), mm = m % 60;
  let s;
  if (m >= 1440) { const d = Math.floor(m / 540), rh = Math.floor((m % 540) / 60); s = `${d}bd${rh ? ` ${rh}h` : ''}`; } // 9h business day
  else if (h) s = `${h}h${mm ? ` ${mm}m` : ''}`;
  else s = `${mm}m`;
  return neg ? `-${s}` : s;
};
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const stateLabel = { breached: 'Breached', at_risk: 'At risk', on_track: 'On track', paused: 'Paused', met: 'Met' };
const slaColor = { breached: 'var(--bad)', at_risk: 'var(--warn)', on_track: 'var(--ok)', paused: 'var(--pause)', met: 'var(--ok)' };
const prio = (p) => `<span class="badge ${p}">${p}</span>`;
const slaBadge = (s) => `<span class="badge s-${s.state}">${stateLabel[s.state]}</span>`;
const meter = (s) => `<div class="meter" title="${s.percentUsed}% of SLA used"><span style="width:${Math.min(100, s.percentUsed)}%;background:${slaColor[s.state]}"></span></div>`;
const statusBadge = (s) => `<span class="badge">${esc(s.replace('_', ' '))}</span>`;
const channelIcon = { email: '✉️', teams: '💬', portal: '🌐', mobile: '📱', sms: '📟', chat: '🗨️', 'virtual-agent': '🤖' };

// ---------------- router ----------------
const routes = [
  [/^#\/dashboard$/, dashboard],
  [/^#\/queue$/, queue],
  [/^#\/ticket\/(.+)$/, ticketView],
  [/^#\/new$/, newRequest],
  [/^#\/catalog$/, catalog],
  [/^#\/catalog\/(.+)$/, catalogItem],
  [/^#\/kb$/, kb],
  [/^#\/kb\/(.+)$/, kbArticle],
  [/^#\/cmdb$/, cmdb],
  [/^#\/governance$/, governance],
];

async function render() {
  const hash = location.hash || '#/dashboard';
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', hash.startsWith(`#/${a.dataset.nav}`) || (a.dataset.nav === 'queue' && hash.startsWith('#/ticket')));
  const r = routes.find(([re]) => re.test(hash)) || routes[0];
  try {
    renderBanners();
    await r[1](...(hash.match(r[0]) || []).slice(1).map(decodeURIComponent));
  } catch (e) {
    $view.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', render);
// Keep SLA timers live on the dashboard and queue.
setInterval(() => { if (/^(#\/(dashboard|queue))?$/.test(location.hash)) render(); }, 60000);

async function renderBanners() {
  const banners = await api('/banners');
  document.getElementById('banners').innerHTML = banners.map((b) => `<div class="banner" role="status">🚨 <div><strong>Service alert.</strong> ${esc(b.text)} <a href="#/ticket/${b.ticketId}">${b.ticketId}</a></div></div>`).join('');
}

// ---------------- dashboard ----------------
async function dashboard() {
  const m = await api('/metrics');
  const kpi = (label, value, hint = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value ?? '—'}</div><div class="hint">${hint}</div></div>`;
  const bars = (obj) => {
    const max = Math.max(1, ...Object.values(obj));
    return `<div class="bars">${Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><span class="muted">${v}</span></div>`).join('')}</div>`;
  };
  const W = 640, H = 170, n = m.trend.length, bw = W / n;
  const max = Math.max(1, ...m.trend.flatMap((d) => [d.created, d.resolved]));
  const chart = `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Tickets created vs resolved per day">
    ${m.trend.map((d, i) => {
      const x = i * bw + 6, hc = (d.created / max) * H, hr = (d.resolved / max) * H;
      return `<rect x="${x}" y="${H - hc}" width="${bw / 2 - 5}" height="${hc}" rx="3" fill="var(--p3)"><title>${d.date}: ${d.created} created</title></rect>
              <rect x="${x + bw / 2 - 4}" y="${H - hr}" width="${bw / 2 - 5}" height="${hr}" rx="3" fill="var(--accent)"><title>${d.date}: ${d.resolved} resolved</title></rect>
              ${i % 2 === 0 ? `<text x="${x}" y="${H + 16}" font-size="10" fill="var(--muted)">${d.date.slice(5)}</text>` : ''}`;
    }).join('')}</svg>
    <div class="row muted" style="font-size:12px"><span class="chip" style="background:var(--p3);color:#fff">Created</span><span class="chip" style="background:var(--accent);color:#fff">Resolved</span></div>`;

  $view.innerHTML = `
    <header class="top"><div><h1>Service desk overview</h1><div class="sub">Live metrics across IT, HR, Facilities and Finance</div></div>
      <div class="row"><a class="btn" href="/api/v2/export/tickets.csv">⬇ Export CSV</a><a class="btn" href="#/new">＋ New request</a></div></header>
    <div class="grid kpis">
      ${kpi('Open tickets', m.totals.open, `${m.totals.resolved} resolved`)}
      ${kpi('SLA compliance', m.slaCompliance != null ? `${m.slaCompliance}%` : '—', 'Resolution SLA met')}
      ${kpi('At risk / breached', `${m.slaAtRisk} / ${m.slaBreachedOpen}`, 'Open tickets (predictive)')}
      ${kpi('MTTR', `${m.mttrHours}h`, 'Mean time to resolve')}
      ${kpi('First-contact resolution', m.firstContactResolution != null ? `${m.firstContactResolution}%` : '—')}
      ${kpi('CSAT', m.csat != null ? `${m.csat} / 5` : '—', 'Requester satisfaction')}
    </div>
    <div class="grid two" style="margin-top:14px">
      <div class="card"><h2>Created vs resolved — last 14 days</h2>${chart}</div>
      <div class="card"><h2>Backlog aging</h2>${bars(m.aging)}<h2 style="margin-top:16px">Backlog by priority</h2>${bars(m.backlogByPriority)}</div>
    </div>
    <div class="grid half" style="margin-top:14px">
      <div class="card"><h2>Intake by channel</h2>${bars(m.byChannel)}</div>
      <div class="card"><h2>Volume by department</h2>${bars(m.byDepartment)}</div>
      <div class="card"><h2>AI triage governance</h2>
        <p class="muted">Every AI action is logged with input, output, confidence and the approver.</p>
        <div class="grid kpis">${kpi('Auto-applied', m.ai.autoApplied)}${kpi('Accepted', m.ai.accepted)}${kpi('Rejected', m.ai.rejected)}${kpi('Acceptance', m.ai.acceptanceRate != null ? `${m.ai.acceptanceRate}%` : '—')}</div></div>
      <div class="card"><h2>Chargeback (illustrative, USD)</h2>${bars(m.chargebackUsd)}</div>
    </div>`;
}

// ---------------- queue ----------------
let queueFilter = { open: 'true' };
async function queue() {
  const qs = new URLSearchParams(Object.entries(queueFilter).filter(([, v]) => v)).toString();
  const list = await api(`/tickets?${qs}`);
  const sel = (key, opts, label) => `<select data-f="${key}" aria-label="${label}"><option value="">${label}</option>${opts.map((o) => `<option ${queueFilter[key] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  $view.innerHTML = `
    <header class="top"><div><h1>Unified queue</h1><div class="sub">Every channel, one queue — sorted by SLA risk</div></div><a class="btn" href="#/new">＋ New request</a></header>
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <input data-f="q" placeholder="Search tickets…" value="${esc(queueFilter.q || '')}" />
        ${sel('priority', ['P1', 'P2', 'P3', 'P4'], 'Any priority')}
        ${sel('department', ['IT', 'HR', 'Facilities', 'Finance'], 'Any department')}
        ${sel('channel', Object.keys(channelIcon), 'Any channel')}
        <label class="row" style="margin:0"><input type="checkbox" data-f="open" ${queueFilter.open ? 'checked' : ''}/> Open only</label>
        <span class="muted">${list.length} tickets</span>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th class="hide-sm">Category</th><th class="hide-sm">Assignee</th><th>SLA</th><th class="hide-sm">Due</th></tr></thead>
        <tbody>${list.map((t) => `<tr class="click" data-id="${t.id}">
          <td><div><strong>${t.id}</strong> ${t.majorIncident ? '<span class="badge P1">MAJOR</span>' : ''} ${t.parentId ? `<span class="badge">child of ${t.parentId}</span>` : ''}</div><div>${channelIcon[t.channel] || ''} ${esc(t.title)}</div><div class="muted" style="font-size:12px">${esc(t.requester?.name)} · ${ago(t.createdAt)}</div></td>
          <td>${prio(t.priority)}</td><td>${statusBadge(t.status)}</td>
          <td class="hide-sm">${esc(t.category)}<div class="muted" style="font-size:12px">${esc(t.assignmentGroup)}</div></td>
          <td class="hide-sm">${esc(t.assigneeName || '—')}</td>
          <td>${slaBadge(t.sla)}${meter(t.sla)}</td>
          <td class="hide-sm muted">${t.resolvedAt ? 'Resolved' : fmtMin(t.sla.resolution.remainingMinutes)}${t.sla.escalation.level ? `<div style="font-size:12px">⤴ L${t.sla.escalation.level} ${esc(t.sla.escalation.notify)}</div>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">No tickets match.</td></tr>'}</tbody></table></div>
    </div>`;
  $view.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => (location.hash = `#/ticket/${tr.dataset.id}`)));
  $view.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('change', () => { queueFilter[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? 'true' : '') : el.value; queue(); });
  });
}

// ---------------- ticket ----------------
async function ticketView(id) {
  const [t, techs] = await Promise.all([api(`/tickets/${id}`), api('/technicians')]);
  const s = t.sla;
  const aiRow = (field, label) => {
    const a = t.ai?.[field];
    if (!a) return '';
    const val = field === 'assignment' ? `${esc(a.label || '—')} <span class="muted">(${esc(a.group)})</span>` : field === 'merge' ? `${a.majorIncident ? 'Link to major incident' : 'Merge into'} <a href="#/ticket/${a.value}">${a.value}</a>` : esc(a.value);
    const actionable = ['pending', 'suggested'].includes(a.decision);
    return `<div class="ai-row"><strong>${label}</strong>
      <div>${val} <span class="conf">· ${Math.round(a.confidence * 100)}% confidence · mode: ${a.mode}</span><div class="conf">${esc(a.reason || '')}</div></div>
      <div>${actionable ? `<button class="small primary" data-ai="${field}" data-d="accept">Accept</button> <button class="small" data-ai="${field}" data-d="reject">Reject</button>` : `<span class="badge">${esc(a.decision.replace('_', ' '))}${a.decidedBy ? ` by ${esc(a.decidedBy)}` : ''}</span>`}</div></div>`;
  };
  const wf = t.workflow ? `<div class="card"><h2>Fulfilment workflow <span class="badge">${t.workflow.status}</span></h2><ul class="steps">${t.workflow.steps.map((st) => `
      <li><span class="dot ${st.status}"></span><div style="flex:1"><strong>${esc(st.name)}</strong><div class="muted" style="font-size:12px">${st.type} · ${esc(st.group)} · ${st.status}${st.completedBy ? ` by ${esc(st.completedBy)}` : ''}</div></div>
      ${st.status === 'active' ? (st.type === 'approval' ? `<button class="small primary" data-step="${st.id}" data-d="approve">Approve</button><button class="small danger" data-step="${st.id}" data-d="reject">Reject</button>` : `<button class="small primary" data-step="${st.id}" data-d="done">Complete</button>`) : ''}</li>`).join('')}</ul></div>` : '';

  $view.innerHTML = `
    <header class="top"><div><div class="row">${prio(t.priority)} ${statusBadge(t.status)} ${slaBadge(s)} ${t.majorIncident ? '<span class="badge P1">MAJOR INCIDENT</span>' : ''}</div>
      <h1 style="margin-top:6px">${t.id} · ${esc(t.title)}</h1>
      <div class="sub">${channelIcon[t.channel] || ''} via ${esc(t.channel)} · ${esc(t.requester?.name)} ${t.requester?.department ? `(${esc(t.requester.department)})` : ''} · opened ${ago(t.createdAt)}${t.parentId ? ` · child of <a href="#/ticket/${t.parentId}">${t.parentId}</a>` : ''}${t.mergedInto ? ` · merged into <a href="#/ticket/${t.mergedInto}">${t.mergedInto}</a>` : ''}</div></div>
      <a class="btn" href="#/queue">← Queue</a></header>
    <div class="grid two">
      <div class="grid">
        ${Object.keys(t.ai || {}).length ? `<div class="card ai"><h2>🤖 AI triage <span class="muted" style="font-weight:400">— people keep the decisions</span></h2>${aiRow('category', 'Category')}${aiRow('priority', 'Priority')}${aiRow('assignment', 'Assign to')}${aiRow('merge', 'Duplicate')}</div>` : ''}
        ${wf}
        <div class="card"><h2>Conversation</h2><ul class="timeline">${t.comments.map((c) => `<li><span class="who">${esc(c.author)}</span> <span class="badge">${c.role}</span> ${c.public ? '' : '<span class="badge">internal</span>'} <span class="muted">· ${ago(c.at)}</span><pre class="body">${esc(c.body)}</pre></li>`).join('') || '<li class="muted">No messages yet.</li>'}</ul>
          <label for="reply">Reply</label><textarea id="reply" placeholder="Write a reply (first agent reply stops the response SLA clock)"></textarea>
          <div class="row" style="margin-top:8px"><button class="primary" id="send">Send reply</button><button id="note">Add internal note</button><button id="asReq">Reply as requester</button></div></div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><h2>SLA · ${s.policyId}</h2>${meter(s)}
          <table style="margin-top:8px"><tr><td>Response</td><td>${s.response.met === null ? `due ${new Date(s.response.dueAt).toLocaleString()}` : s.response.met ? '✅ met' : '❌ missed'}</td></tr>
          <tr><td>Resolution</td><td>${t.resolvedAt ? (s.state === 'met' ? '✅ met' : '❌ breached') : `${fmtMin(s.resolution.remainingMinutes)} left`}<div class="muted" style="font-size:12px">due ${new Date(s.resolution.dueAt).toLocaleString()}</div></td></tr>
          <tr><td>Paused</td><td>${fmtMin(s.resolution.pausedMinutes)}</td></tr>
          <tr><td>Escalation</td><td>${s.escalation.level ? `Level ${s.escalation.level} → ${esc(s.escalation.notify)}` : 'None'}</td></tr>
          <tr><td>Calendar</td><td class="muted">${esc(s.calendarId)}</td></tr></table></div>
        <div class="card"><h2>Details</h2>
          <div class="field"><label>Status</label><select id="status">${['new', 'open', 'in_progress', 'pending', 'resolved', 'closed'].map((x) => `<option ${x === t.status ? 'selected' : ''} value="${x}">${x.replace('_', ' ')}</option>`).join('')}</select></div>
          <div class="field"><label>Priority</label><select id="priority">${['P1', 'P2', 'P3', 'P4'].map((x) => `<option ${x === t.priority ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label>Assignee</label><select id="assignee"><option value="">Unassigned</option>${techs.map((x) => `<option value="${x.id}" ${x.id === t.assignee ? 'selected' : ''}>${esc(x.name)} — ${esc(x.group)}</option>`).join('')}</select></div>
          <p class="muted" style="margin-top:10px">${esc(t.category)} · ${esc(t.department)} · ${esc(t.assignmentGroup)}</p>
          ${t.ciIds?.length ? `<p>CIs: ${t.ciIds.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p>` : ''}
          ${t.links?.length ? `<p>Linked: ${t.links.map((l) => `<a href="#/ticket/${l}">${l}</a>`).join(', ')}</p>` : ''}
        </div>
        ${(() => {
          const acts = [
            !t.majorIncident && !t.resolvedAt && !t.parentId ? '<button id="major" class="danger">🚨 Declare major incident</button>' : '',
            t.resolvedAt && !t.mergedInto ? '<button id="kbdraft">📝 Draft KB article (AI)</button>' : '',
            t.resolvedAt && !t.csat ? '<button id="csat">⭐ Record CSAT 5</button>' : '',
          ].join('');
          return acts ? `<div class="card"><h2>Actions</h2><div class="row">${acts}</div></div>` : '';
        })()}
        ${t.suggestedArticles?.length ? `<div class="card"><h2>Suggested articles</h2>${t.suggestedArticles.map((a) => `<div><a href="#/kb/${a.id}">${esc(a.title)}</a></div>`).join('')}</div>` : ''}
      </div>
    </div>`;

  const patch = async (body) => { await api(`/tickets/${id}`, { method: 'PATCH', body }); toast('Ticket updated'); ticketView(id); };
  document.getElementById('status').onchange = (e) => patch({ status: e.target.value });
  document.getElementById('priority').onchange = (e) => patch({ priority: e.target.value });
  document.getElementById('assignee').onchange = (e) => patch({ assignee: e.target.value || null });
  const comment = async (role, isPublic) => {
    const body = document.getElementById('reply').value.trim();
    if (!body) return;
    await api(`/tickets/${id}/comments`, { method: 'POST', body: { body, role, public: isPublic, author: role === 'requester' ? t.requester?.name : 'Demo Agent' } });
    ticketView(id);
  };
  document.getElementById('send').onclick = () => comment('agent', true);
  document.getElementById('note').onclick = () => comment('agent', false);
  document.getElementById('asReq').onclick = () => comment('requester', true);
  $view.querySelectorAll('[data-ai]').forEach((b) => (b.onclick = async () => { await api(`/tickets/${id}/ai/${b.dataset.ai}/${b.dataset.d}`, { method: 'POST', body: {} }); toast(`AI ${b.dataset.ai} ${b.dataset.d}ed — logged to audit`); ticketView(id); }));
  $view.querySelectorAll('[data-step]').forEach((b) => (b.onclick = async () => { await api(`/tickets/${id}/workflow/${b.dataset.step}`, { method: 'POST', body: { decision: b.dataset.d } }); ticketView(id); }));
  const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = fn; };
  on('major', async () => {
    const banner = prompt('Status banner text for affected users:', `We are aware of an issue: ${t.title}. Updates every 30 minutes.`);
    if (banner === null) return;
    await api(`/tickets/${id}/major-incident`, { method: 'POST', body: { banner } });
    toast('Major incident declared'); render();
  });
  on('kbdraft', async () => { const a = await api(`/tickets/${id}/kb-draft`, { method: 'POST' }); location.hash = `#/kb/${a.id}`; });
  on('csat', () => patch({ csat: 5 }));
}

// ---------------- new request (omnichannel simulator) ----------------
async function newRequest() {
  $view.innerHTML = `
    <header class="top"><div><h1>New request</h1><div class="sub">People ask where they already are — simulate any intake channel. AI suggests answers before you submit.</div></div></header>
    <div class="grid two">
      <div class="card">
        <div class="grid half">
          <div class="field"><label>Channel</label><select id="ch">${Object.keys(channelIcon).map((c) => `<option>${c}</option>`).join('')}</select></div>
          <div class="field"><label>Type</label><select id="type"><option value="incident">Incident — something is broken</option><option value="request">Request — I need something</option></select></div>
          <div class="field"><label>Your name</label><input id="name" value="Dana Whitfield" /></div>
          <div class="field"><label>Email</label><input id="email" value="dana.whitfield@county.example" /></div>
        </div>
        <label for="title">Subject</label><input id="title" style="width:100%" placeholder="e.g. VPN not connecting, whole finance team blocked" />
        <label for="desc">Describe the issue</label><textarea id="desc" placeholder="What happened? Who is affected? Any deadline?"></textarea>
        <div class="row" style="margin-top:10px"><button class="primary" id="submit">Submit request</button><span class="muted">Try: “I clicked a phishing link and entered my password”</span></div>
      </div>
      <div class="card ai" id="preview"><h2>🤖 Live AI triage</h2><p class="muted">Start typing to see category, priority, routing, duplicates and suggested articles.</p></div>
    </div>`;
  const $ = (i) => document.getElementById(i);
  let timer;
  const preview = async () => {
    const title = $('title').value, description = $('desc').value;
    if ((title + description).trim().length < 6) return;
    const p = await api('/triage', { method: 'POST', body: { title, description, requester: { email: $('email').value } } });
    $('preview').innerHTML = `<h2>🤖 Live AI triage</h2>
      <div class="ai-row"><strong>Category</strong><div>${esc(p.category.value)} <span class="conf">${Math.round(p.category.confidence * 100)}%</span><div class="conf">${esc(p.category.reason)}</div></div><span></span></div>
      <div class="ai-row"><strong>Priority</strong><div>${prio(p.priority.value)}<div class="conf">${esc(p.priority.reason)}</div></div><span></span></div>
      <div class="ai-row"><strong>Route to</strong><div>${esc(p.assignment.group)}<div class="conf">${esc(p.assignment.reason)}</div></div><span></span></div>
      ${p.duplicates.length ? `<h3 style="margin-top:12px">⚠️ Possible duplicates</h3>${p.duplicates.map((d) => `<div><a href="#/ticket/${d.id}">${d.id}</a> ${esc(d.title)} ${d.majorIncident ? '<span class="badge P1">MAJOR</span>' : ''} <span class="conf">${Math.round(d.similarity * 100)}% similar</span></div>`).join('')}` : ''}
      ${p.knowledge.length ? `<h3 style="margin-top:12px">💡 Try these first</h3>${p.knowledge.map((k) => `<div><a href="#/kb/${k.id}">${esc(k.title)}</a></div>`).join('')}` : ''}`;
  };
  ['title', 'desc'].forEach((i) => $(i).addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 300); }));
  $('submit').onclick = async () => {
    const ch = $('ch').value;
    const body = { type: $('type').value, title: $('title').value, description: $('desc').value, requester: { name: $('name').value, email: $('email').value } };
    try {
      const t = ch === 'email'
        ? await api('/intake/email', { method: 'POST', body: { from: body.requester.email, fromName: body.requester.name, subject: body.title, body: body.description } })
        : await api('/tickets', { method: 'POST', body: { ...body, channel: ch } });
      toast(`${t.id} created`);
      location.hash = `#/ticket/${t.id}`;
    } catch (e) { toast(e.message); }
  };
}

// ---------------- catalog ----------------
async function catalog() {
  const items = await api('/catalog');
  $view.innerHTML = `<header class="top"><div><h1>Service catalog</h1><div class="sub">Not just IT — every shared service, with approvals and automated fulfilment</div></div></header>
    <div class="tiles">${items.map((i) => `<div class="card tile" data-id="${i.id}"><div class="ico">${i.icon}</div><h3>${esc(i.name)}</h3><p class="muted">${esc(i.description)}</p><span class="chip">${esc(i.department)}</span><span class="chip">${i.workflow.length} workflow steps</span></div>`).join('')}</div>`;
  $view.querySelectorAll('.tile').forEach((el) => (el.onclick = () => (location.hash = `#/catalog/${el.dataset.id}`)));
}

async function catalogItem(id) {
  const item = (await api('/catalog')).find((i) => i.id === id);
  if (!item) throw new Error('Catalog item not found');
  const input = (f) => {
    const common = `id="f-${f.key}" name="${f.key}" ${f.required ? 'required' : ''}`;
    if (f.type === 'select') return `<select ${common}>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea ${common}></textarea>`;
    if (f.type === 'checkbox') return `<input type="checkbox" ${common} ${f.default ? 'checked' : ''} />`;
    return `<input type="${f.type}" ${common} value="${esc(f.default ?? '')}" />`;
  };
  $view.innerHTML = `<header class="top"><div><h1>${item.icon} ${esc(item.name)}</h1><div class="sub">${esc(item.description)}</div></div><a class="btn" href="#/catalog">← Catalog</a></header>
    <div class="grid two"><form class="card" id="form">${item.fields.map((f) => `<div class="field"><label for="f-${f.key}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input(f)}</div>`).join('')}
      <div style="margin-top:14px"><button class="primary" type="submit">Submit request</button></div></form>
      <div class="card"><h2>What happens next</h2><ul class="steps">${item.workflow.map((s) => `<li><span class="dot"></span><div><strong>${esc(s.name)}</strong><div class="muted" style="font-size:12px">${s.type} · ${esc(s.group)}${s.dependsOn?.length ? ` · after ${s.dependsOn.join(', ')}` : ''}${s.condition ? ` · only if ${s.condition.field} ${s.condition.op} ${s.condition.value}` : ''}</div></div></li>`).join('')}</ul></div></div>`;
  document.getElementById('form').onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of item.fields) { const el = document.getElementById(`f-${f.key}`); values[f.key] = f.type === 'checkbox' ? el.checked : el.value; }
    try {
      const t = await api(`/catalog/${id}/request`, { method: 'POST', body: { values, requester: { name: 'Dana Whitfield', email: 'dana.whitfield@county.example', department: 'Finance' } } });
      toast(`${t.id} submitted`);
      location.hash = `#/ticket/${t.id}`;
    } catch (err) { toast(err.message); }
  };
}

// ---------------- knowledge ----------------
async function kb() {
  const q = sessionStorage.getItem('kbq') || '';
  const list = await api(q ? `/kb?q=${encodeURIComponent(q)}` : '/kb');
  $view.innerHTML = `<header class="top"><div><h1>Knowledge base</h1><div class="sub">Semantic-style search · drafts generated from resolved tickets need approval</div></div></header>
    <div class="card"><input id="kbq" style="width:100%" placeholder="Search articles, e.g. “vpn error”, “teams audio”" value="${esc(q)}" />
    <table style="margin-top:10px"><thead><tr><th>Article</th><th>Category</th><th class="hide-sm">Audience</th><th>Status</th></tr></thead><tbody>
    ${list.map((a) => `<tr class="click" data-id="${a.id}"><td><strong>${a.id}</strong> ${esc(a.title)}</td><td>${esc(a.category)}</td><td class="hide-sm">${esc(a.audience)}</td><td>${a.status ? `<span class="badge ${a.status === 'draft' ? 's-at_risk' : 's-met'}">${a.status}</span>` : `<span class="muted">relevance ${a.score}</span>`}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No articles found.</td></tr>'}
    </tbody></table></div>`;
  const input = document.getElementById('kbq');
  input.onchange = () => { sessionStorage.setItem('kbq', input.value); kb(); };
  $view.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => (location.hash = `#/kb/${tr.dataset.id}`)));
}

async function kbArticle(id) {
  const a = await api(`/kb/${id}`);
  $view.innerHTML = `<header class="top"><div><div class="row"><span class="badge ${a.status === 'draft' ? 's-at_risk' : 's-met'}">${a.status}</span><span class="chip">${esc(a.category)}</span><span class="chip">${esc(a.audience)}</span><span class="muted">v${a.version} · ${a.views} views</span></div><h1 style="margin-top:6px">${esc(a.title)}</h1>
    ${a.sourceTicket ? `<div class="sub">AI draft from <a href="#/ticket/${a.sourceTicket}">${a.sourceTicket}</a></div>` : ''}</div><a class="btn" href="#/kb">← Knowledge base</a></header>
    <div class="card"><pre class="body">${esc(a.body)}</pre>${a.status === 'draft' ? '<div style="margin-top:14px"><button class="primary" id="pub">Approve &amp; publish</button></div>' : ''}</div>`;
  const pub = document.getElementById('pub');
  if (pub) pub.onclick = async () => { await api(`/kb/${id}/publish`, { method: 'POST' }); toast('Published'); kbArticle(id); };
}

// ---------------- CMDB ----------------
async function cmdb() {
  const assets = await api('/assets');
  $view.innerHTML = `<header class="top"><div><h1>Assets &amp; CMDB</h1><div class="sub">Configuration items mapped to the business services they support</div></div></header>
    <div class="grid two"><div class="card"><table><thead><tr><th>Item</th><th>Type</th><th class="hide-sm">Owner</th><th class="hide-sm">Notes</th></tr></thead><tbody>
    ${assets.map((a) => `<tr class="click" data-id="${a.id}"><td><strong>${esc(a.name)}</strong><div class="muted" style="font-size:12px">${a.id}</div></td><td>${esc(a.type)}</td><td class="hide-sm">${esc(a.owner)}</td>
      <td class="hide-sm muted">${a.seatsTotal ? `${a.seatsUsed}/${a.seatsTotal} seats · renews ${a.renewal}` : a.warrantyEnd ? `Warranty to ${a.warrantyEnd}` : esc(a.location || '')}</td></tr>`).join('')}
    </tbody></table></div><div class="card" id="impact"><h2>Impact analysis</h2><p class="muted">Select an item to see which services and open tickets it affects.</p></div></div>`;
  $view.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = async () => {
    const r = await api(`/assets/${tr.dataset.id}/impact`);
    document.getElementById('impact').innerHTML = `<h2>Impact: ${esc(r.asset.name)}</h2>
      <h3>Business services affected</h3>${r.impactedServices.map((s) => `<span class="chip">${esc(s.name)}</span>`).join('') || '<p class="muted">None</p>'}
      ${r.dependencies.length ? `<h3 style="margin-top:12px">Depends on</h3>${r.dependencies.map((d) => `<span class="chip">${esc(d?.name)}</span>`).join('')}` : ''}
      <h3 style="margin-top:12px">Open tickets</h3>${r.openTickets.map((t) => `<div>${prio(t.priority)} <a href="#/ticket/${t.id}">${t.id}</a> ${esc(t.title)}</div>`).join('') || '<p class="muted">None</p>'}`;
  }));
}

// ---------------- governance & audit ----------------
async function governance() {
  const [settings, audit] = await Promise.all([api('/settings'), api('/audit?limit=120')]);
  const labels = { category: 'Categorize', priority: 'Set priority', assignment: 'Assign technician', merge: 'Merge duplicates', kbDraft: 'Draft KB articles' };
  $view.innerHTML = `<header class="top"><div><h1>AI governance &amp; audit</h1><div class="sub">Choose, per action, whether AI suggests, acts with approval, or acts automatically</div></div>
    <button class="danger" id="reset">↺ Reset demo data</button></header>
    <div class="grid two"><div class="card"><h2>Audit trail</h2><div style="max-height:620px;overflow:auto"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th class="hide-sm">Detail</th></tr></thead><tbody>
      ${audit.map((a) => `<tr><td class="muted">${ago(a.at)}</td><td>${a.actor === 'ai' ? '🤖 ai' : esc(a.actor)}</td><td><code>${esc(a.action)}</code></td><td>${/^(INC|REQ)-/.test(a.target) ? `<a href="#/ticket/${a.target}">${a.target}</a>` : esc(a.target)}</td>
      <td class="hide-sm muted" style="font-size:12px">${esc(Object.entries(a.detail || {}).filter(([k]) => k !== 'input').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card" style="align-self:start"><h2>AI action policy</h2>${Object.entries(settings.aiGovernance).map(([k, v]) => `
      <div class="field"><label>${labels[k] || k}</label><select data-g="${k}">${['suggest', 'approve', 'auto'].map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${{ suggest: 'Suggest only', approve: 'Act with approval', auto: 'Act automatically' }[m]}</option>`).join('')}</select></div>`).join('')}
      <h2 style="margin-top:18px">SLA policies</h2><table>${settings.slaPolicies.map((p) => `<tr><td>${prio(p.id)}</td><td>${fmtMin(p.responseMinutes)} / ${fmtMin(p.resolutionMinutes)}</td><td class="muted">${p.calendarId}</td></tr>`).join('')}</table>
      <p class="muted" style="font-size:12px">Response / resolution targets in business time. Holidays and time zones are respected.</p></div></div>`;
  $view.querySelectorAll('[data-g]').forEach((el) => (el.onchange = async () => { await api('/settings/ai-governance', { method: 'PATCH', body: { [el.dataset.g]: el.value } }); toast('Policy saved'); governance(); }));
  document.getElementById('reset').onclick = async () => { if (confirm('Reset all demo data?')) { await api('/admin/reset', { method: 'POST' }); toast('Demo data reset'); render(); } };
}

render();
