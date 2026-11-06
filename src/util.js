// Shared helpers: tokenization, similarity, deterministic RNG, ids.

const STOPWORDS = new Set(
  `a an the and or but if then so to of in on at for from by with without into onto over under is are was were be been
   being am i me my we our you your he she it its they them their this that these those there here can cant cannot
   could would should will wont not no yes do does did done have has had please hi hello thanks thank regards
   just also very really any some all as up down out about after before again get got getting since when what
   which who whom how why need needs needed want wants able unable still keep keeps`.split(/\s+/)
);

// Words that carry meaning for triage even though they look like stopwords.
const KEEP = new Set(['down', 'all', 'cannot', 'cant', 'unable', 'no']);

export function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && (!STOPWORDS.has(t) || KEEP.has(t)))
    .map(stem);
}

// Very small suffix stemmer — enough to fold "printers"/"printing" onto "print".
export function stem(t) {
  if (t.length <= 4) return t;
  for (const s of ['ations', 'ation', 'ings', 'ing', 'ers', 'ies', 'ed', 'es', 's']) {
    if (t.endsWith(s) && t.length - s.length >= 3) return s === 'ies' ? t.slice(0, -3) + 'y' : t.slice(0, -s.length);
  }
  return t;
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Mulberry32 — deterministic PRNG so seed data is reproducible.
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function iso(ts) {
  return ts == null ? null : new Date(ts).toISOString();
}

export function toTs(v) {
  return v == null ? null : typeof v === 'number' ? v : Date.parse(v);
}

export function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
