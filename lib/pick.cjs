// Best card for one purchase from the cards the person holds. Uses the engine's card terms (Engine.HOLDABLE).
// opts (from the popup): capsUsed { cardId: { capKey: ISO date the person marked that cap used up } } and activated
// { cardId: quarter key the person activated the rotating 5% for }. Without opts, caps are unused and rotating
// categories count as activated, which is how the site's engine scores one purchase (the accuracy test relies on it).
// ponytail: a "year" cap resets on January 1; card-member years vary by issuer, ask for the anniversary if it matters.
(function (root) {
  'use strict';
  function quarterKey(d) { return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1); }
  function samePeriod(period, a, b) {
    if (a.getFullYear() !== b.getFullYear()) return false;
    return period === 'year' || (period === 'quarter' ? quarterKey(a) === quarterKey(b) : a.getMonth() === b.getMonth());
  }
  // Each separate spending limit a card has, keyed so categories that share one limit (a cap group) share a switch.
  function capKey(cap, fallback) { return cap.group ? 'g:' + cap.group : fallback; }
  function capList(card) {
    var out = {}, L = root.Engine.CAT_LABEL;
    function add(key, cap, what) {
      var o = out[key] || (out[key] = { key: key, limit: cap.limit, period: cap.period, what: [] });
      o.what.push(what);
    }
    Object.keys(card.caps || {}).forEach(function (c) { add(capKey(card.caps[c], 'c:' + c), card.caps[c], c === 'amazon' ? L[c] : L[c].toLowerCase()); });
    if (card.top && card.top.cap) add(capKey(card.top.cap, 'top'), card.top.cap, 'your ' + card.top.rate + '% category');
    if (card.rot) add('rot', { limit: card.rot.cap, period: 'quarter' }, 'rotating ' + card.rot.rate + '%');
    return Object.keys(out).map(function (k) {
      var o = out[k];
      return { key: k, period: o.period, label: '$' + o.limit.toLocaleString('en-US') + ' ' + o.what.join(' and ') + ' cap used up this ' + o.period };
    });
  }
  function rateFor(card, store, choice, date, opts) {
    var marks = (opts && opts.capsUsed && typeof opts.capsUsed[card.id] === 'object' && opts.capsUsed[card.id]) || {};
    function used(cap, key) { return !!(cap && marks[key] && samePeriod(cap.period, new Date(marks[key]), date)); }
    var cat = store.cat, cap = card.caps && card.caps[cat], rate = card.rates[cat] !== undefined ? card.rates[cat] : card.base, why = null;
    if (used(cap, cap && capKey(cap, 'c:' + cat))) { rate = cap.after; cap = null; why = 'Bonus cap used up'; }
    if (card.top) {
      var g = card.top.auto ? card.top.groups.find(function (x) { return x.cats.indexOf(cat) >= 0; }) : card.top.groups[choice];
      var tc = card.top.cap, tu = used(tc, tc && capKey(tc, 'top')), tr = tu ? tc.after : card.top.rate;
      if (g && g.cats.indexOf(cat) >= 0 && tr > rate) { rate = tr; cap = tu ? null : tc; why = g.label; }
    }
    if (card.rot && (!opts || (opts.activated && opts.activated[card.id] === quarterKey(date)))) {
      var q = card.rot.quarters[quarterKey(date)], rcap = { limit: card.rot.cap, period: 'quarter' };
      if (q && !used(rcap, 'rot') && (q.cats.indexOf(cat) >= 0 || (q.re && q.re.test(store.name))) && card.rot.rate > rate) { rate = card.rot.rate; cap = rcap; why = q.label + ' this quarter'; }
    }
    (card.brands || []).forEach(function (b) {
      if (b.rate > rate && (!b.cats || b.cats.indexOf(cat) >= 0) && b.re.test(store.name)) { rate = b.rate; cap = null; why = b.label; }
    });
    // Percent back: points times what a point is worth.
    return { card: card, rate: rate, back: rate * card.cpp, cap: cap && cap.limit ? { limit: cap.limit, period: cap.period } : null,
      why: why || (rate > card.base ? root.Engine.CAT_LABEL[cat] : 'Everything else') };
  }
  function pick(owned, choices, store, date, opts) {
    return root.Engine.HOLDABLE.filter(function (c) { return owned.indexOf(c.id) >= 0; })
      .map(function (c) { return rateFor(c, store, choices[c.id] || 0, date || new Date(), opts); })
      .sort(function (a, b) { return b.back - a.back; });
  }
  // Card colors, as the site draws them (public/app.js drawCard): from the card's name, else its issuer.
  var LOOK = [[/gold/i, '#D8B46A', '#8C6A2A'], [/platinum|silver/i, '#C9D0DA', '#8E98A7'], [/sapphire|reserve|venture x/i, '#23417A', '#0B1A3E'], [/savor/i, '#7A4A38', '#2F1B14'],
    [/delta/i, '#1E3A70', '#0E1D3C'], [/united/i, '#2C5AA0', '#142C57'], [/hilton|marriott|hyatt|ihg/i, '#2D3E57', '#121C2B']];
  var ISSUER_LOOK = { amex: ['#3B7DD8', '#1B4A93'], chase: ['#2A64B0', '#123566'], 'bank-of-america': ['#D0283E', '#82101F'], 'capital-one': ['#1D4A73', '#0A2238'], citi: ['#2C82C9', '#0F4C84'],
    discover: ['#F28A2E', '#B8560E'], 'wells-fargo': ['#C42A2A', '#6E1010'], 'us-bank': ['#2B4378', '#0F1D3D'], barclays: ['#1EB4EA', '#0A6E9C'], robinhood: ['#2A2A2A', '#050505'], penfed: ['#244A7C', '#0E2342'] };
  function look(card) {
    var l = LOOK.filter(function (x) { return x[0].test(card.name); })[0];
    return l ? l.slice(1, 3) : ISSUER_LOOK[card.issuer] || ['#3C87EE', '#0B3FBF'];
  }
  // What the in-page panel and the popup say. entry is the store's stores.json line: [name, category, warning].
  function describe(state, entry, date) {
    var store = { name: entry[0], cat: entry[1] }, ranked = pick(state.owned, state.choices, store, date, state), best = ranked[0], next = ranked[1];
    if (!best) return null;
    function pct(x) { return (Math.round(x * 10) / 10) + '%'; }
    var cap = best.cap ? ' on up to $' + best.cap.limit.toLocaleString('en-US') + ' a ' + best.cap.period : '';
    return { card: best.card.name, colors: look(best.card), pct: pct(best.back),
      line: best.why === 'Everything else' ? pct(best.back) + ' back on everything. None of your cards has a bonus here that beats it.' : best.why + ': ' + pct(best.back) + ' back' + cap + '.',
      next: next ? 'Next best: ' + next.card.name + ', ' + pct(next.back) + '.' : '', warn: entry[2] || null };
  }
  // Stores: each stores.json key covers itself and its www. host, plus any extra checkout hosts listed in the entry's
  // fourth field ("pay.ebay.com", "*.store.apple.com"). Never every subdomain: that would take in sign-in and account sites.
  function hostsFor(h, entry) { return [h, 'www.' + h].concat((entry && entry[3]) || []); }
  function patterns(h, entry) { return hostsFor(h, entry).map(function (x) { return 'https://' + x + '/*'; }); }
  function storeFor(stores, hostname) {
    return Object.keys(stores).filter(function (h) {
      return hostsFor(h, stores[h]).some(function (x) { return x.indexOf('*.') === 0 ? hostname.endsWith(x.slice(1)) : hostname === x; });
    })[0] || null;
  }
  root.PointMaxxPick = pick;
  root.PointMaxxDescribe = describe;
  root.PointMaxxLook = look;
  root.PointMaxxCaps = capList;
  root.PointMaxxQuarter = quarterKey;
  root.PointMaxxSamePeriod = samePeriod;
  root.PointMaxxPatterns = patterns;
  root.PointMaxxStore = storeFor;
})(typeof window !== 'undefined' ? window : globalThis);
