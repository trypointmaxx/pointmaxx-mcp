#!/usr/bin/env node
// PointMaxx as an MCP server: an AI assistant asks which card to use, which cards to get, or what a card's terms
// are, and gets the site's own answers (public/engine.js, public/cards.json) and the extension's (extension/pick.js).
// Runs locally over stdio and makes no network requests: whatever the assistant sends stays on this machine.
// It takes card names and monthly category totals only, never statements or card numbers.
// ponytail: the MCP wire format is written out by hand (JSON-RPC lines on stdin/stdout); swap in the official SDK
// if the protocol grows past initialize, tools/list and tools/call.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib'); // copied in by build.mjs
const require = createRequire(import.meta.url);
require(path.join(LIB, 'engine.cjs'));
const E = globalThis.Engine;
await import(pathToFileURL(path.join(LIB, 'pick.cjs')).href);
const STORES = require(path.join(LIB, 'stores.json'));
const VERSION = '0.1.2', VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const NOTE = 'Estimates from each card\'s published terms, not financial advice. Check the issuer before applying.';
const CATS = Object.keys(E.CAT_LABEL);

// ---------- helpers ----------
class Bad extends Error {} // a problem with the caller's input: reported back as a tool error, not a crash
const clean = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function findCard(q, list = E.HOLDABLE) {
  if (typeof q !== 'string' || !q.trim() || q.length > 100) throw new Bad('Each card must be a name or id of up to 100 characters.');
  const k = clean(q), byId = list.find(c => c.id === q.trim().toLowerCase());
  if (byId) return byId;
  const exact = list.filter(c => clean(c.name) === k);
  if (exact.length === 1) return exact[0];
  const words = k.split(' '), hits = list.filter(c => { const n = clean(c.name + ' ' + c.issuer); return words.every(w => n.includes(w)); });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Bad(`"${q}" matches ${hits.length} cards: ${hits.slice(0, 6).map(c => c.name).join(', ')}. Be more specific.`);
  throw new Bad(`No card called "${q}". Use card_terms with no card to list them.`);
}
function cardList(v, field) {
  if (!Array.isArray(v) || !v.length || v.length > 20) throw new Bad(`${field} must be a list of 1 to 20 card names.`);
  return [...new Map(v.map(q => findCard(q)).map(c => [c.id, c])).values()];
}
const pct = x => Math.round(x * 100) / 100;
const dollars = x => Math.round(x);
// A year of purchases from monthly amounts, the way the site's quick estimate builds them (app.js quickEstimate):
// four purchases a month, fixed to their category, so monthly and quarterly caps fill as they would.
function profile(monthly) {
  if (!monthly || typeof monthly !== 'object' || Array.isArray(monthly)) throw new Bad('monthly must be an object of category: dollars a month.');
  const txns = [], overrides = {}, now = new Date();
  let total = 0;
  for (const [cat, amt] of Object.entries(monthly)) {
    if (!CATS.includes(cat)) throw new Bad(`Unknown category "${cat}". Use: ${CATS.join(', ')}.`);
    if (typeof amt !== 'number' || !isFinite(amt) || amt < 0 || amt > 1e6) throw new Bad(`monthly.${cat} must be a number of dollars from 0 to 1,000,000.`);
    if (amt < 0.04) continue; // under a cent a purchase: nothing to rank
    total += amt;
    const desc = 'Your estimate: ' + E.CAT_LABEL[cat], key = E.merchantKey(desc), each = Math.round(amt / 4 * 100) / 100;
    overrides[key] = cat;
    for (let i = 12; i >= 1; i--) for (let w = 0; w < 4; w++) txns.push({ date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 3 + w * 7)), desc, amount: each, bankCat: '', key });
  }
  if (!total) throw new Bad('Give at least one category with spending above $0.');
  return { txns, overrides };
}

// ---------- tools ----------
const TOOLS = [
  {
    name: 'best_card',
    description: 'Which of the cards someone holds earns the most on one purchase, at a store (name or website) or in a spending category. Ranks every card given, with its percent back, why, and any cap.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['cards'], properties: {
      cards: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Card names or ids the person holds, e.g. "Amex Gold", "Citi Double Cash".' },
      store: { type: 'string', maxLength: 200, description: 'A store name or website, e.g. "doordash.com". Used when it is one of the stores PointMaxx knows; otherwise give category.' },
      category: { type: 'string', enum: CATS, description: 'The spending category, when store is not given or not known.' }
    } }
  },
  {
    name: 'compare_cards',
    description: 'Which one, two and three cards would earn the most on someone\'s monthly spending, after annual fees, caps and credits they would use; and, if they say which cards they hold, how much more that is. Uses the same engine as pointmaxx.app.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['monthly'], properties: {
      monthly: { type: 'object', description: 'Typical dollars a month by category. Categories: ' + CATS.join(', ') + '.', properties: Object.fromEntries(CATS.map(c => [c, { type: 'number', minimum: 0, maximum: 1e6, description: E.CAT_LABEL[c] }])), additionalProperties: false },
      held: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Cards the person already has, to compare against.' }
    } }
  },
  {
    name: 'card_terms',
    description: 'One card\'s annual fee, earn rates by category, caps, statement credits and where the terms were checked. With no card, lists every card PointMaxx knows.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { card: { type: 'string', maxLength: 100, description: 'A card name or id.' } } }
  }
];

function bestCard({ cards, store, category } = {}) {
  const held = cardList(cards, 'cards');
  if (category != null && !CATS.includes(category)) throw new Bad(`Unknown category "${String(category).slice(0, 40)}". Use: ${CATS.join(', ')}.`);
  let where = null;
  if (store != null) {
    if (typeof store !== 'string' || store.length > 200) throw new Bad('store must be text of up to 200 characters.');
    const host = store.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    const key = PointMaxxStore(STORES, host) || Object.keys(STORES).find(h => clean(STORES[h][0]) === clean(store) || clean(h.split('.')[0]) === clean(store));
    if (key) where = { name: STORES[key][0], cat: STORES[key][1], site: key, warn: STORES[key][2] || null };
  }
  if (!where) {
    if (!CATS.includes(category)) throw new Bad(store ? `PointMaxx doesn't know "${store}". Give its category: ${CATS.join(', ')}.` : 'Give a store or a category.');
    where = { name: '', cat: category, site: null, warn: null };
  } else if (category) where.cat = category;
  const ranked = PointMaxxPick(held.map(c => c.id), {}, where, new Date());
  return {
    store: where.site, category: where.cat, categoryLabel: E.CAT_LABEL[where.cat],
    ranking: ranked.map(r => ({ card: r.card.name, percentBack: pct(r.back), why: r.why, cap: r.cap && { spendLimitDollars: r.cap.limit, per: r.cap.period } })),
    warning: where.warn,
    assumes: 'Bonus caps not yet used up and rotating 5% categories activated. Points counted at each card\'s cents-per-point value.',
    note: NOTE
  };
}

function compareCards({ monthly, held } = {}) {
  const p = profile(monthly), data = E.buildData(p.txns, p.overrides), res = E.analyze(data, {});
  const mine = held && held.length ? cardList(held, 'held') : [];
  const wallet = (w, n) => w && w.cards.length === n && {
    cards: w.cards.map(c => c.name), netPerYear: dollars(w.net), annualFees: w.cards.reduce((a, c) => a + (c.fee || 0), 0),
    useFor: Object.fromEntries(w.perCard.map(x => [x.card.name, x.cats.map(c => E.CAT_LABEL[c])]))
  };
  const out = { best: { one: wallet(res.wallets[1], 1), two: wallet(res.wallets[2], 2) || null, three: wallet(res.wallets[3], 3) || null }, spendPerYear: dollars(data.total * 12 / data.m) };
  if (mine.length) {
    const now = E.setNet(mine.map(c => c.id), p.txns, p.overrides, {});
    out.yourCards = { cards: mine.map(c => c.name), netPerYear: dollars(now) };
    // A two- or three-card setup is null when fewer cards already do as well.
    const gain = (w, n) => w && w.cards.length === n ? dollars(w.net - now) : null;
    out.gainOverYourCards = { one: gain(res.wallets[1], 1), two: gain(res.wallets[2], 2), three: gain(res.wallets[3], 3) };
  }
  out.assumes = 'A year of purchases built from these monthly amounts. Statement credits count only where this spending would use them; sign-up bonuses are left out.';
  out.note = NOTE;
  return out;
}

function cardTerms({ card } = {}) {
  if (card == null) return { cards: E.HOLDABLE.map(c => ({ id: c.id, name: c.name, annualFee: c.fee, closedToNewApplicants: !!c.closed })), count: E.HOLDABLE.length };
  const c = findCard(card, E.HOLDABLE);
  return {
    id: c.id, name: c.name, issuer: c.issuer, annualFee: c.fee, firstYearFee: c.firstYearFee ?? null, closedToNewApplicants: !!c.closed,
    rewards: c.unit, centsPerPoint: c.cpp, baseRate: c.base,
    rates: Object.fromEntries(Object.entries(c.rates || {}).map(([k, v]) => [E.CAT_LABEL[k] || k, v])),
    caps: Object.fromEntries(Object.entries(c.caps || {}).map(([k, v]) => [E.CAT_LABEL[k] || k, v])),
    credits: (c.creditList || []).map(x => ({ name: x.name, amount: x.amount, period: x.period })),
    note: c.note || null, termsCheckedAt: c.source || null, disclaimer: NOTE
  };
}

// No prototype: a tool name like "constructor" or "toString" must not find a built-in.
const RUN = Object.assign(Object.create(null), { best_card: bestCard, compare_cards: compareCards, card_terms: cardTerms });

// ---------- MCP over stdio: one JSON-RPC message per line ----------
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
function handle(msg) {
  const { id, method, params } = msg || {};
  const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') return reply({ protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'pointmaxx', version: VERSION } });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    const fn = typeof params?.name === 'string' ? RUN[params.name] : undefined;
    if (!fn) return fail(-32602, 'Unknown tool: ' + String(params?.name).slice(0, 50));
    try {
      const args = params.arguments ?? {}, allowed = Object.keys(TOOLS.find(t => t.name === params.name).inputSchema.properties);
      if (typeof args !== 'object' || Array.isArray(args) || args === null) throw new Bad('arguments must be an object.');
      const extra = Object.keys(args).filter(k => !allowed.includes(k));
      if (extra.length) throw new Bad(`Unknown argument${extra.length > 1 ? 's' : ''}: ${extra.slice(0, 5).map(k => k.slice(0, 30)).join(', ')}. Allowed: ${allowed.join(', ')}.`);
      const out = fn(args);
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out });
    } catch (e) {
      if (e instanceof Bad) return reply({ content: [{ type: 'text', text: e.message }], isError: true });
      process.stderr.write('pointmaxx-mcp: ' + (e && e.stack || e) + '\n'); // the host's log, never the assistant
      return reply({ content: [{ type: 'text', text: 'PointMaxx hit an internal error working that out.' }], isError: true });
    }
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return;
  return fail(-32601, 'Method not found');
}
// Lines are split by hand so an endless line can't grow without bound: past 100 KB it's dropped until its newline.
const MAX = 100000;
let pending = '', skipping = false;
function onLine(line) {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  try { handle(msg); } catch (e) { process.stderr.write('pointmaxx-mcp: ' + (e && e.stack || e) + '\n'); } // one bad message never stops the server
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  let i;
  pending += chunk;
  while ((i = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, i); pending = pending.slice(i + 1);
    if (skipping) skipping = false; else onLine(line);
  }
  if (pending.length > MAX) {
    if (!skipping) send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } });
    skipping = true; pending = '';
  }
});
