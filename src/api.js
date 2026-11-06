// Versioned REST API (/api/v2) — optional API-key auth and per-client rate limiting.
import { HttpError } from './service.js';
import { searchKb } from './kb.js';

const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { method, re, keys, handler };
};

export function buildRoutes(app) {
  const actor = (req) => req.headers['x-ostium-user'] || 'demo.agent';
  return [
    route('GET', '/api/v2/health', () => ({ status: 'ok', product: 'Ostium ITSM MVP', version: '0.1.0', time: new Date().toISOString() })),

    // Tickets
    route('GET', '/api/v2/tickets', ({ query }) => app.listTickets(query)),
    route('POST', '/api/v2/tickets', ({ body, req }) => [201, app.createTicket(body, actor(req))]),
    route('POST', '/api/v2/incidents', ({ body, req }) => [201, app.createTicket({ ...body, type: 'incident' }, actor(req))]),
    route('POST', '/api/v2/requests', ({ body, req }) => [201, app.createTicket({ ...body, type: 'request' }, actor(req))]),
    route('GET', '/api/v2/tickets/:id', ({ params }) => app.view(app.ticket(params.id))),
    route('PATCH', '/api/v2/tickets/:id', ({ params, body, req }) => app.updateTicket(params.id, body, actor(req))),
    route('POST', '/api/v2/tickets/:id/comments', ({ params, body, req }) => app.addComment(params.id, body, actor(req))),
    route('POST', '/api/v2/tickets/:id/merge', ({ params, body, req }) => app.merge(params.id, body.targetId, actor(req))),
    route('POST', '/api/v2/tickets/:id/major-incident', ({ params, body, req }) => app.declareMajor(params.id, body, actor(req))),
    route('POST', '/api/v2/tickets/:id/ai/:field/:decision', ({ params, body, req }) => app.decideAi(params.id, params.field, params.decision, actor(req), body?.value)),
    route('POST', '/api/v2/tickets/:id/kb-draft', ({ params, req }) => [201, app.kbDraft(params.id, actor(req))]),
    route('POST', '/api/v2/tickets/:id/workflow/:step', ({ params, body, req }) => app.workflowStep(params.id, params.step, body?.decision || 'done', actor(req))),

    // AI triage preview (suggested answers before the user submits)
    route('POST', '/api/v2/triage', ({ body }) => app.previewTriage(body)),

    // Omnichannel intake webhooks
    route('POST', '/api/v2/intake/:channel', ({ params, body }) => [201, app.intake(params.channel, body)]),

    // Knowledge
    route('GET', '/api/v2/kb', ({ query }) => (query.q ? searchKb(app.db.kb, query.q, 10) : app.db.kb)),
    route('GET', '/api/v2/kb/:id', ({ params }) => {
      const a = app.db.kb.find((x) => x.id === params.id);
      if (!a) throw new HttpError(404, 'Article not found');
      a.views++;
      return a;
    }),
    route('POST', '/api/v2/kb/:id/publish', ({ params, req }) => app.publishArticle(params.id, actor(req))),

    // Service catalog
    route('GET', '/api/v2/catalog', () => app.db.catalog),
    route('POST', '/api/v2/catalog/:id/request', ({ params, body, req }) => [201, app.requestCatalogItem(params.id, body.values || {}, body.requester, actor(req))]),

    // CMDB
    route('GET', '/api/v2/assets', () => app.db.assets),
    route('GET', '/api/v2/assets/:id/impact', ({ params }) => app.impact(params.id)),

    // Reporting, governance, audit
    route('GET', '/api/v2/metrics', ({ query }) => app.metrics(query)),
    route('GET', '/api/v2/banners', () => app.db.banners.filter((b) => b.active)),
    route('GET', '/api/v2/technicians', () => app.db.technicians),
    route('GET', '/api/v2/settings', () => app.settings),
    route('PATCH', '/api/v2/settings/ai-governance', ({ body, req }) => app.setGovernance(body, actor(req))),
    route('GET', '/api/v2/audit', ({ query }) => app.db.audit.slice(-Number(query.limit || 200)).reverse()),
    route('GET', '/api/v2/export/tickets.csv', () => ({ __raw: app.exportCsv(), type: 'text/csv' })),
    route('POST', '/api/v2/admin/reset', () => app.reset()),
  ];
}

/** Simple token bucket per client: `limit` requests per minute. */
export function rateLimiter(limit = 300) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const b = buckets.get(key) || { tokens: limit, at: now };
    b.tokens = Math.min(limit, b.tokens + ((now - b.at) / 60000) * limit);
    b.at = now;
    if (b.tokens < 1) { buckets.set(key, b); return false; }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };
}

export function createApiHandler(app, { apiKey = process.env.OSTIUM_API_KEY, rateLimit = 300 } = {}) {
  const routes = buildRoutes(app);
  const allow = rateLimiter(rateLimit);

  return async function handle(req, res, url) {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data, null, 2) : data);
    };
    if (!allow(req.socket.remoteAddress || 'local')) return send(429, { error: 'Rate limit exceeded' });
    if (apiKey && req.method !== 'GET' && req.headers['x-api-key'] !== apiKey) return send(401, { error: 'Missing or invalid X-API-Key' });

    const match = routes.map((r) => ({ r, m: req.method === r.method && url.pathname.match(r.re) })).find((x) => x.m);
    if (!match) return send(404, { error: `No route for ${req.method} ${url.pathname}` });

    try {
      let body = {};
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.length > 1e6) throw new HttpError(413, 'Payload too large');
        body = raw ? JSON.parse(raw) : {};
      }
      const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
      const result = await match.r.handler({ req, params, query: Object.fromEntries(url.searchParams), body });
      if (result?.__raw !== undefined) return send(200, result.__raw, result.type);
      if (Array.isArray(result) && typeof result[0] === 'number' && result.length === 2) return send(result[0], result[1]);
      return send(200, result);
    } catch (e) {
      if (e instanceof SyntaxError) return send(400, { error: 'Invalid JSON body' });
      if (!e.status) console.error(e);
      return send(e.status || 500, { error: e.message });
    }
  };
}
