// Runs the MCP server over stdio the way an assistant does and checks its answers against the engine.
//   node mcp/server.test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const srv = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', next = 1;
const waiting = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise(r => { const id = next++; waiting.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
assert.equal(init.result.serverInfo.name, 'pointmaxx');
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
assert.deepEqual((await rpc('tools/list')).result.tools.map(t => t.name), ['best_card', 'compare_cards', 'card_terms']);

// best_card: Amex Gold beats Double Cash on dining (4x at 1.5c = 6%), at a known store and by category
let r = await call('best_card', { cards: ['Amex Gold', 'Citi Double Cash'], store: 'doordash.com' });
assert.equal(r.structuredContent.category, 'dining');
assert.equal(r.structuredContent.ranking[0].card, 'Amex Gold');
assert.equal(r.structuredContent.ranking[0].percentBack, 6);
r = await call('best_card', { cards: ['amex-gold', 'double-cash'], category: 'gas' });
assert.equal(r.structuredContent.ranking[0].card, 'Citi Double Cash');
r = await call('best_card', { cards: ['Amex Gold'], store: 'some-unknown-shop.example' });
assert.equal(r.isError, true);

// compare_cards: the Day 2 numbers ($400 a month of groceries: Blue Cash Preferred alone nets $193)
r = await call('compare_cards', { monthly: { groceries: 400 }, held: ['Amex Blue Cash Preferred'] });
assert.equal(r.structuredContent.yourCards.netPerYear, 193);
assert.ok(r.structuredContent.best.one.netPerYear >= 193);
assert.equal(r.structuredContent.spendPerYear, 4800);

// card_terms
r = await call('card_terms', { card: 'Amex Gold' });
assert.equal(r.structuredContent.annualFee, 325);
r = await call('card_terms', {});
assert.equal(r.structuredContent.count, 54);

// Bad input comes back as a tool error, never a crash
for (const bad of [{ monthly: { groceries: -5 } }, { monthly: { rent: 900 } }, { monthly: {} }, { monthly: 'lots' }])
  assert.equal((await call('compare_cards', bad)).isError, true, JSON.stringify(bad));
assert.equal((await call('best_card', { cards: [] })).isError, true);
assert.equal((await call('best_card', { cards: ['x'.repeat(500)] })).isError, true);
assert.equal((await rpc('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
assert.equal((await rpc('no/such/method')).error.code, -32601);

// Security regressions: built-ins aren't tools; a malformed message doesn't stop the server; endless lines are cut
assert.equal((await rpc('tools/call', { name: 'constructor', arguments: { a: 1 } })).error.code, -32602);
assert.equal((await rpc('tools/call', { name: 'toString' })).error.code, -32602);
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 5 }) + '\n');
srv.stdin.write('x'.repeat(150000) + '\n');
assert.deepEqual((await rpc('ping')).result, {});

// QA regressions
assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
assert.equal((await call('compare_cards', { monthly: { dining: 0.001 } })).isError, true);
assert.equal((await call('best_card', { cards: ['Amex Gold'], store: 'doordash.com', category: 'bogus' })).isError, true);
assert.equal((await call('best_card', { cards: ['Amex Gold'], category: 'dining', extra: 1 })).isError, true);
assert.equal((await rpc('tools/call', { name: 'card_terms', arguments: 'x' })).result.isError, true);
r = await call('compare_cards', { monthly: { dining: 1e6, groceries: 1e6 } });
assert.ok(r.structuredContent.best.two === null || r.structuredContent.best.two.cards.length === 2);
const batch = new Promise(res => { const h = d => { if (String(d).includes('Invalid Request')) { srv.stdout.off('data', h); res(true); } }; srv.stdout.on('data', h); });
srv.stdin.write(JSON.stringify([{ jsonrpc: '2.0', id: 77, method: 'ping' }]) + '\n');
assert.ok(await batch);

srv.kill();
console.log('mcp server ok');
