// Knowledge management: TF-IDF search and AI-drafted articles from resolved tickets.
import { tokenize } from './util.js';

export function searchKb(articles, query, limit = 5) {
  const q = tokenize(query);
  if (!q.length) return [];
  const docs = articles.filter((a) => a.status === 'published').map((a) => ({ a, toks: tokenize(`${a.title} ${a.title} ${a.category} ${a.body}`) }));
  const df = {};
  for (const d of docs) for (const t of new Set(d.toks)) df[t] = (df[t] || 0) + 1;
  const N = docs.length || 1;
  return docs
    .map(({ a, toks }) => {
      const tf = {};
      for (const t of toks) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      const titleToks = new Set(tokenize(a.title));
      for (const t of new Set(q)) {
        if (!tf[t]) continue;
        score += (1 + Math.log(tf[t])) * Math.log(1 + N / df[t]);
        if (titleToks.has(t)) score += 1.5 * Math.log(1 + N / df[t]); // title matches matter most
      }
      return { id: a.id, title: a.title, category: a.category, audience: a.audience, score: +(score / Math.sqrt(toks.length)).toFixed(3) };
    })
    .filter((r) => r.score > 0.15)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** Draft a knowledge article from a resolved ticket (requires human approval to publish). */
export function draftFromTicket(ticket, nextId) {
  const steps = ticket.comments.filter((c) => c.role === 'agent').map((c) => `- ${c.body}`).join('\n') || '- (add resolution steps)';
  return {
    id: nextId,
    title: `How to resolve: ${ticket.title}`,
    category: ticket.category,
    audience: 'internal',
    status: 'draft',
    version: 1,
    sourceTicket: ticket.id,
    body: `Symptoms\n${ticket.description}\n\nResolution steps\n${steps}\n\nApplies to: ${ticket.category} · Priority seen: ${ticket.priority}`,
    views: 0,
    helpful: 0,
  };
}
