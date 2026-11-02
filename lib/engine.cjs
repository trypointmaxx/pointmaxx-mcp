(function (root) {
  'use strict';

  var CATS = [
    { id: 'dining', label: 'Dining' },
    { id: 'groceries', label: 'Groceries' },
    { id: 'gas', label: 'Gas' },
    { id: 'travel', label: 'Flights, hotels, rentals' },
    { id: 'transit', label: 'Transit and rideshare' },
    { id: 'streaming', label: 'Streaming' },
    { id: 'entertainment', label: 'Movies, shows and attractions' },
    { id: 'amazon', label: 'Amazon' },
    { id: 'online', label: 'Online shopping' },
    { id: 'drugstore', label: 'Drugstores' },
    { id: 'utilities', label: 'Phone and utilities' },
    { id: 'other', label: 'Everything else' }
  ];
  var CAT_LABEL = {};
  CATS.forEach(function (c) { CAT_LABEL[c.id] = c.label; });

  // Cards come from public/cards.json (see test/cards.test.mjs for every field). The engine uses the complete
  // cards that still take new applicants, in file order. Rates go stale, and every number is editable in the page.
  // cpp = cents per point (1 for cash back).
  // HOLDABLE adds the complete cards closed to new applicants: you can't get them, but you may hold one.
  var CARDS = [], HOLDABLE = [];

  function useCards(db) {
    var list = [], all = [];
    (db.cards || []).forEach(function (c) {
      if (c.status !== 'complete') return;
      var rates = {}, caps = {}, brands = [];
      (c.earn || []).forEach(function (e) {
        if (e.merchants) { brands.push({ label: e.label, rate: e.rate, re: merchantMatcher(e.merchants), cats: e.categories }); return; }
        rates[e.category] = e.rate;
        if (e.cap) caps[e.category] = { limit: e.cap.amount, after: e.cap.after, period: e.cap.period, group: e.cap.group };
      });
      var card = { id: c.id, name: c.name, issuer: c.issuer, closed: !!c.closed, fee: c.annualFee, cpp: c.pointValue, unit: c.currency === 'cash' ? 'cash' : 'points', base: c.base, rates: rates, note: c.note,
        firstYearFee: c.firstYearFee, source: c.source || {}, bonus: c.signupBonus, creditList: c.credits || [], network: c.network, perks: c.perks || [] };
      if (c.membership) card.membership = { name: c.membership.name, fee: c.membership.fee, re: merchantMatcher(c.membership.merchants) };
      if (c.rotatingCalendar) {
        // Rotating 5% categories, by calendar quarter ("2026-Q3"): engine categories, and merchant names for the ones
        // our categories don't have (home improvement stores, wholesale clubs, Instacart).
        var rq = {}, qs = c.rotatingCalendar.quarters;
        Object.keys(qs).forEach(function (k) { rq[k] = { label: qs[k].label, cats: qs[k].categories || [], re: qs[k].merchants && qs[k].merchants.length ? merchantMatcher(qs[k].merchants) : null }; });
        card.rot = { rate: c.rotatingCalendar.rate, cap: c.rotatingCalendar.cap, quarters: rq };
      }
      if (Object.keys(caps).length) card.caps = caps;
      if (brands.length) card.brands = brands;
      if (c.topCategory) {
        var tc = c.topCategory.cap;
        // Each choice is one category or a named group of them (say online shopping = online, Amazon and streaming).
        var groups = c.topCategory.categories.map(function (g) { return typeof g === 'string' ? { label: CAT_LABEL[g], cats: [g] } : { label: g.label, cats: g.categories.slice() }; });
        card.top = { groups: groups, cats: [].concat.apply([], groups.map(function (g) { return g.cats; })), rate: c.topCategory.rate, auto: !!c.topCategory.auto, firstYearRate: c.topCategory.firstYearRate, cap: tc && { limit: tc.amount, after: tc.after, period: tc.period, group: tc.group } };
      }
      all.push(card);
      if (!c.closed) list.push(card);
    });
    CARDS.length = 0; HOLDABLE.length = 0;
    Array.prototype.push.apply(CARDS, list);
    Array.prototype.push.apply(HOLDABLE, all);
    return CARDS;
  }

  var RULES = [
    // Personal care earns no card's bonus, and "salon" reads too much like "saloon" for the model to be trusted on it.
    ['other', /\bsalons?\b|\bspa\b|barber|\bnails?\b|\bhair\b|beauty|massage|vagaro|\bwaxing\b|\blash(es)?\b/],
    // Gyms and fitness classes earn no card's bonus either; banks often file them under entertainment or recreation.
    ['other', /\bgyms?\b|fitness|\bcrunch\b|equinox|orangetheory|\bymca\b|\bf45\b|crossfit|soulcycle|barry'? ?s\b|pure barre|club pilates|\byoga\b|classpass|mindbody/],
    ['amazon', /amzn|amazon\.com|amazon mktp|amazon prime|amazon\.|^amazon/],
    ['groceries', /whole foods|wholefds|trader joe|safeway|kroger|stop ?(&|and)? ?shop|star market|shaw'?s|market basket|aldi|publix|wegmans|giant food|harris teeter|h-e-b|food lion|instacart|hannaford|price chopper|sprouts|fresh market|grocery|grocer|supermarket|\bmarket\b|\bfoodmaster\b|\bfood mart\b/],
    ['streaming', /netflix|hulu|disney ?\+|disney plus|spotify|\bhbo\b|max\.com|youtube ?(premium|tv)|peacock|paramount|apple tv|audible|crunchyroll|sirius|apple\.com\/bill/],
    // Issuers' entertainment: movie theaters, ticket sellers and promoters, parks, attractions, bowling. Not golf or streaming.
    ['entertainment', /ticketmaster|live ?nation|stubhub|seatgeek|vivid seats|\bamc\b|regal cinema|regal theat|cinemark|fandango|alamo drafthouse|cinema|theatre|theater|\bimax\b|six flags|cedar point|universal studios|disneyland|disney world|seaworld|knott'?s|aquarium|\bzoo\b|museum|bowling|bowlero|lucky strike|dave ?& ?buster|billiards/],
    ['drugstore', /\bcvs\b|walgreens|rite aid|pharmacy|duane reade/],
    ['dining', /restaurant|cafe|café|coffee|starbucks|dunkin|mcdonald|chipotle|doordash|uber ?eats|grubhub|pizza|sushi|taco|burger|grill|kitchen|bakery|deli\b|sweetgreen|panera|shake shack|chick-fil|chickfila|subway|wendy|domino|bistro|tavern|\bpub\b|brewery|diner|\btst\b|dig inn|tatte|blue bottle|ramen|thai|noodle|bbq|bar & |wings|auntie anne|\bcava\b|dave'?s hot chicken|gong cha|happy lemon|raising cane|blank street|boba|chip city|panda express|five guys|doughnut|donut|\bdining\b(?! room)|snack ?\*/],
    ['gas', /\bshell\b|exxon|mobil\b|chevron|\bbp\b|sunoco|citgo|speedway|\bgulf\b|valero|marathon|texaco|wawa|sheetz|circle k|irving oil|gas station|\bfuel\b/],
    ['travel', /airlines|airways|\bdelta\b|united air|american air|jetblue|southwest|alaska air|spirit air|frontier air|marriott|hilton|hyatt|airbnb|booking\.com|expedia|\bhotel\b|\binn\b|hertz|\bavis\b|enterprise rent|vrbo|kayak|resort/],
    ['transit', /\buber\b|\blyft\b|\bmbta\b|\bmta\b|amtrak|greyhound|megabus|flixbus|peter pan bus|parking|\btoll|e-?zpass|transit|metro|bluebikes|citi ?bike|\blime\b/],
    ['utilities', /verizon|at&t|\batt\b|t-mobile|comcast|xfinity|spectrum|eversource|national grid|con ?ed|utility|electric|water bill|internet|mint mobile|google fi|optimum/]
  ];

  // Bought on a website or app, judged from the statement text. Checked after every other rule and after the bank's
  // own category, so a .com that names a restaurant, airline, streaming service or bill keeps that category.
  // Issuers decide by merchant code, which statements don't show, so mark any other merchant as online yourself.
  var ONLINE = /\.com\b|\.co\b|\.net\b|www\.|\bpaypal\b|\bpp ?\*|shopify|shop pay|\betsy\b|\bebay\b|\bshein\b|\btemu\b|\bchewy\b|\bwayfair\b|\bzappos\b|aliexpress|poshmark|\bdepop\b|stockx|\bgoat\b/;

  // A bank's own category for a purchase: a CSV's category column, or the heading a PDF lists it under (Bank of
  // America's year-end summary groups purchases as "Food Store", "Dining", "Airline", "Pharmacy" and so on).
  // Groceries come first so "Food Store" is not read as dining; health care is doctors, not a drugstore.
  var BANK_CAT = [
    ['groceries', /grocer|supermarket|food store/],
    ['dining', /food|dining|restaurant/],
    ['gas', /\bgas\b|fuel/],
    ['travel', /travel|airfare|airline|hotel|lodging|car rental/],
    ['transit', /transport|rideshare|parking/],
    ['entertainment', /entertainment|recreation|amusement/],
    ['drugstore', /pharm|drug ?store/],
    ['utilities', /bills|utilit|phone|internet/]
  ];

  function merchantKey(desc) {
    var s = String(desc || '').toLowerCase();
    s = s.replace(/^(sq\s*\*|tst\s*\*|pp\s*\*|paypal\s*\*|py\s*\*|pos\s+|purchase\s+|debit card purchase\s*)/, '');
    s = s.replace(/[#*]\s*\d+/g, ' ').replace(/\d+/g, ' ').replace(/[^a-z&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    var k = s.split(' ').slice(0, 3).join(' ');
    return k || 'unknown';
  }

  // ---------- learned categorizer ----------
  // A small text model (public/category-model.json) that guesses a merchant's category from its name when no keyword
  // rule or bank category applies: TF-IDF over character 3-5 grams inside words, then logistic regression. Trained on
  // real card purchases labelled by merchant category code; tools/train-category-model.py rebuilds it. Its answer is
  // used only when it is at least model.threshold sure, since a wrong bonus category overstates rewards.
  // Tables keyed by merchant text start empty (no prototype), so a merchant called "constructor" or "toString" is just
  // another name, not a built-in. own() reads an ordinary object the same way.
  var dict = function () { return Object.create(null); };
  var own = function (o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; };
  var MODEL = null, MODEL_INDEX = null, modelCache = dict();
  function useModel(m) {
    MODEL = m; MODEL_INDEX = dict(); modelCache = dict();
    if (m) m.vocab.forEach(function (g, i) { MODEL_INDEX[g] = i; });
  }
  // Checkout services' prefixes (Square's "SQ *", Toast's "TST*", PayPal's "PP*") say how someone paid, not what they
  // bought, so the model never sees them; the keyword rules still do. Mirrored in tools/train-category-model.py clean().
  function modelText(desc) { return String(desc).toLowerCase().replace(/^\s*(sq|tst|pp|paypal|py|sp|snack)\s*\*\s*/, '').replace(/[#*]/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Character n-grams within words, padded with a space each side, exactly as scikit-learn's char_wb analyzer cuts them.
  function charGrams(text, lo, hi) {
    var out = [];
    text.split(' ').forEach(function (w) {
      if (!w) return;
      w = ' ' + w + ' ';
      for (var n = lo; n <= hi; n++) {
        var off = 0;
        out.push(w.slice(off, off + n));
        while (off + n < w.length) { off++; out.push(w.slice(off, off + n)); }
        if (off === 0) break;
      }
    });
    return out;
  }
  function modelPredict(desc) {
    if (!MODEL) return null;
    if (modelCache[desc]) return modelCache[desc];
    var tf = {}, j, k, norm = 0;
    charGrams(modelText(desc), MODEL.ngram[0], MODEL.ngram[1]).forEach(function (g) { j = MODEL_INDEX[g]; if (j !== undefined) tf[j] = (tf[j] || 0) + 1; });
    for (j in tf) { tf[j] = (1 + Math.log(tf[j])) * MODEL.idf[j]; norm += tf[j] * tf[j]; }
    norm = Math.sqrt(norm) || 1;
    var logits = MODEL.intercept.slice(), best = 0, sum = 0;
    for (k = 0; k < logits.length; k++) { var row = MODEL.coef[k], z = 0; for (j in tf) z += tf[j] * row[j]; logits[k] += z * MODEL.scale[k] / norm; }
    var top = Math.max.apply(null, logits), ps = logits.map(function (z) { var e = Math.exp(z - top); sum += e; return e; });
    for (k = 1; k < ps.length; k++) if (ps[k] > ps[best]) best = k;
    var next = best ? 0 : 1;
    for (k = 0; k < ps.length; k++) if (k !== best && ps[k] > ps[next]) next = k;
    return (modelCache[desc] = { cat: MODEL.classes[best], p: ps[best] / sum, next: MODEL.classes[next], pNext: ps[next] / sum });
  }

  // Issuers code superstores and warehouse clubs apart from supermarkets, and grocery bonuses exclude them, whatever
  // the bank's own category column says. Their gas stations still code as gas, and their websites as online shopping.
  var SUPERSTORE = /wal-?mart|\btarget\b|costco|sam'?s club|\bbj'?s (wholesale|whse|whsl)/;

  function categorize(tx, overrides) { return categoryInfo(tx, overrides).cat; }

  // The category, where it came from, and for a guess the likeliest other answer (alt), which the range below tries:
  // one the model gives at least a 15% chance, or for an online-looking name, everything else (the issuer may not
  // code it as online). Your own choices, the superstore check and the keyword rules name the merchant: no alt.
  function categoryInfo(tx, overrides) {
    if (own(overrides, tx.key)) return { cat: own(overrides, tx.key), source: 'yours' };
    var d = tx.desc.toLowerCase();
    if (SUPERSTORE.test(d)) return { cat: /\bgas\b|fuel/.test(d) ? 'gas' : ONLINE.test(d) ? 'online' : 'other', source: 'rule' };
    for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(d)) return { cat: RULES[i][0], source: 'rule' };
    var guess = modelPredict(tx.desc), other = function (c) {
      if (!guess) return null;
      if (guess.cat !== c && guess.p >= 0.15) return guess.cat;
      return guess.next !== c && guess.pNext >= 0.15 ? guess.next : null;
    };
    if (tx.bankCat) {
      var b = tx.bankCat.toLowerCase();
      for (var j = 0; j < BANK_CAT.length; j++) if (BANK_CAT[j][1].test(b)) return { cat: BANK_CAT[j][0], source: 'bank', alt: other(BANK_CAT[j][0]) };
    }
    if (guess && guess.cat !== 'other' && guess.p >= MODEL.threshold) return { cat: guess.cat, source: 'model', alt: other(guess.cat) };
    if (ONLINE.test(d)) return { cat: 'online', source: 'online', alt: 'other' };
    return { cat: 'other', source: 'none', alt: other('other') };
  }

  // How categoryInfo reached its answer, for the page to show: each check in the order it runs, what it found
  // (the text a rule matched, the bank's label, the model's top answers and the letter groups that pushed it most),
  // and which check decided. Checks after the deciding one are still filled in, marked as not reached.
  function explainCategory(tx, overrides) {
    var info = categoryInfo(tx, overrides), d = tx.desc.toLowerCase(), hit = function (re) { var m = d.match(re); return m ? m[0] : null; };
    var rule = null;
    for (var i = 0; i < RULES.length && !rule; i++) if (hit(RULES[i][1])) rule = { cat: RULES[i][0], text: hit(RULES[i][1]) };
    var bank = null;
    if (tx.bankCat) for (var j = 0; j < BANK_CAT.length && !bank; j++) if (BANK_CAT[j][1].test(tx.bankCat.toLowerCase())) bank = { label: tx.bankCat, cat: BANK_CAT[j][0] };
    if (tx.bankCat && !bank) bank = { label: tx.bankCat, cat: null };
    var steps = [
      { id: 'yours', found: own(overrides, tx.key) ? { cat: own(overrides, tx.key) } : null },
      { id: 'superstore', found: hit(SUPERSTORE) ? { cat: info.source === 'rule' && !rule ? info.cat : 'other', text: hit(SUPERSTORE) } : null },
      { id: 'rule', found: rule },
      { id: 'bank', found: bank && bank.cat ? bank : null, label: bank && bank.label },
      { id: 'model', found: null },
      { id: 'online', found: hit(ONLINE) ? { cat: 'online', text: hit(ONLINE) } : null },
      { id: 'none', found: { cat: 'other' } }
    ];
    var model = explainModel(tx.desc);
    if (model) steps[4].found = model.top[0].cat !== 'other' && model.top[0].p >= MODEL.threshold ? { cat: model.top[0].cat, p: model.top[0].p } : null;
    // The deciding check: superstore and keyword rules both report source 'rule'.
    var by = info.source === 'rule' ? (hit(SUPERSTORE) ? 'superstore' : 'rule') : info.source;
    var reached = true;
    steps.forEach(function (s) { s.reached = reached; s.decided = reached && s.id === by; if (s.decided) reached = false; });
    return { cat: info.cat, source: info.source, alt: info.alt || null, by: by, steps: steps, model: model, threshold: MODEL ? MODEL.threshold : null };
  }

  // The model's answer spelled out: its top three categories, and for the top one the letter groups in the name that
  // pushed hardest toward it (each one's share of that category's score, before the softmax).
  function explainModel(desc) {
    if (!MODEL) return null;
    var tf = {}, j, k, norm = 0;
    charGrams(modelText(desc), MODEL.ngram[0], MODEL.ngram[1]).forEach(function (g) { j = MODEL_INDEX[g]; if (j !== undefined) tf[j] = (tf[j] || 0) + 1; });
    for (j in tf) { tf[j] = (1 + Math.log(tf[j])) * MODEL.idf[j]; norm += tf[j] * tf[j]; }
    norm = Math.sqrt(norm) || 1;
    var logits = MODEL.intercept.map(function (b, c) { var z = 0; for (j in tf) z += tf[j] * MODEL.coef[c][j]; return b + z * MODEL.scale[c] / norm; });
    var top = Math.max.apply(null, logits), ps = logits.map(function (z) { return Math.exp(z - top); }), sum = ps.reduce(function (a, b) { return a + b; }, 0);
    var order = MODEL.classes.map(function (c, i) { return i; }).sort(function (a, b) { return ps[b] - ps[a]; });
    // Each letter's push toward the top category: every letter group it sits in shares its score evenly among its letters.
    k = order[0];
    var text = modelText(desc), heat = text.split('').map(function () { return 0; }), at = 0, count = {};
    charGrams(text, MODEL.ngram[0], MODEL.ngram[1]).forEach(function (g) { var i = MODEL_INDEX[g]; if (i !== undefined) count[i] = (count[i] || 0) + 1; });
    text.split(' ').forEach(function (w) {
      var p = ' ' + w + ' ';
      for (var n = MODEL.ngram[0]; n <= MODEL.ngram[1]; n++) for (var s = 0; s + n <= p.length; s++) {
        var i = MODEL_INDEX[p.slice(s, s + n)];
        if (i === undefined) continue;
        var share = tf[i] * MODEL.coef[k][i] * MODEL.scale[k] / norm / count[i];
        for (var c = Math.max(s, 1); c < Math.min(s + n, p.length - 1); c++) heat[at + c - 1] += share / n;
        if (n >= p.length) break;
      }
      at += w.length + 1;
    });
    return { top: order.slice(0, 3).map(function (i) { return { cat: MODEL.classes[i], p: ps[i] / sum }; }), text: text, heat: heat };
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function parseDate(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      var y = +m[3]; if (y < 100) y += 2000;
      return new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    }
    return null;
  }

  function parseAmount(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    var n = parseFloat(s.replace(/[$,()\s-]/g, ''));
    if (isNaN(n)) return null;
    return neg ? -n : n;
  }

  var PAYMENT = /autopay|payment thank|thank you|online payment|payment received|e-?payment|mobile payment|ach payment|automatic payment/i;
  // Issuer charges that earn no rewards: fees, interest and their reversals.
  var CHARGE = /interest charge|finance charge|\b(annual|annual membership|membership|late|late payment|foreign transaction|cash advance|balance transfer|returned payment|over ?limit) fee\b/i;
  // Credits that are not a merchant giving money back, so they do not reduce spend.
  var REWARD = /statement credit|rewards? (credit|redemption)|cash ?back (reward|redemption|credit)/i;

  // Statements with no header row: guess each column from what its values look like.
  function inferColumns(rows) {
    var sample = rows.slice(0, 50), n = sample.length, w = 0;
    sample.forEach(function (r) { if (r.length > w) w = r.length; });
    var dates = [], amts = [], letters = [];
    for (var c = 0; c < w; c++) {
      var d = 0, a = 0, l = 0;
      sample.forEach(function (r) {
        var v = String(r[c] == null ? '' : r[c]).trim();
        if (parseDate(v)) d++;
        else if (/^[-($]*[\d,]*\.\d{2}\)?$/.test(v) && parseAmount(v) != null) a++;
        l += (v.match(/[a-z]/gi) || []).length;
      });
      dates.push(d / n); amts.push(a / n); letters.push(l / n);
    }
    function best(arr, skip) {
      var bi = -1;
      for (var i = 0; i < arr.length; i++) if (skip.indexOf(i) < 0 && (bi < 0 || arr[i] > arr[bi])) bi = i;
      return bi;
    }
    var dateC = best(dates, []);
    if (dateC < 0 || dates[dateC] < 0.8) return null;
    var amtC = best(amts, [dateC]);
    if (amtC < 0 || amts[amtC] < 0.8) return null;
    var descC = best(letters, [dateC, amtC]);
    if (descC < 0 || letters[descC] < 2) return null;
    return { dateC: dateC, descC: descC, amtC: amtC };
  }

  function extractTransactions(rows) {
    var hi = -1, h = null;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var low = rows[i].map(function (x) { return String(x).toLowerCase().trim(); });
      var hasDate = low.some(function (x) { return /date/.test(x); });
      var hasAmt = low.some(function (x) { return /^amount$|^debit$|^charge/.test(x) || /amount/.test(x); });
      if (hasDate && hasAmt) { hi = i; h = low; break; }
    }
    var dateC, descC, amtC, debC = -1, creC = -1, catC = -1, typeC = -1;
    if (hi >= 0) {
      var find = function (res) {
        for (var r = 0; r < res.length; r++) for (var c = 0; c < h.length; c++) if (res[r].test(h[c])) return c;
        return -1;
      };
      dateC = find([/^transaction date$/, /^trans\.? date$/, /^date$/, /date/]);
      descC = find([/^description$/, /merchant/, /payee/, /^name$/, /description/, /memo/]);
      amtC = find([/^amount$/, /amount/]);
      debC = find([/^debit$/]);
      creC = find([/^credit$/]);
      catC = find([/^category$/]);
      typeC = find([/^type$/]);
      if (dateC < 0 || descC < 0 || (amtC < 0 && debC < 0)) return { txns: [], error: 'Could not match date, description and amount columns.' };
    } else {
      var g = inferColumns(rows);
      if (!g) return { txns: [], error: 'No header row with a date and an amount column was found, and the columns could not be worked out from the rows.' };
      dateC = g.dateC; descC = g.descC; amtC = g.amtC;
    }

    var body = rows.slice(hi + 1);
    var neg = 0, pos = 0;
    if (amtC >= 0 && typeC < 0 && debC < 0) {
      body.forEach(function (r) {
        var a = parseAmount(r[amtC]); if (a == null || PAYMENT.test(r[descC] || '')) return;
        if (a < 0) neg++; else if (a > 0) pos++;
      });
    }
    var purchasesNegative = neg > pos;
    // excluded counts dated rows that are not spending: payments, interest, fees, credits and zero amounts.
    var txns = [], excluded = 0;
    body.forEach(function (r) {
      var d = parseDate(r[dateC]); if (!d) return;
      var desc = String(r[descC] || '').trim(); if (!desc) return;
      var t0 = txns.length;
      addRow(r, d, desc);
      if (txns.length === t0) excluded++;
    });
    function addRow(r, d, desc) {
      if (PAYMENT.test(desc) || CHARGE.test(desc)) return;
      // spend > 0 is a purchase; spend < 0 is a refund that nets against spending.
      var spend = null;
      if (debC >= 0) {
        var db = parseAmount(r[debC]), cr = creC >= 0 ? parseAmount(r[creC]) : null;
        if (db && db > 0) spend = db;
        else if (cr && cr > 0) spend = -cr;
      } else {
        var a = parseAmount(r[amtC]); if (a == null) return;
        if (typeC >= 0) {
          var t = String(r[typeC] || '');
          if (/sale|purchase|debit/i.test(t)) spend = Math.abs(a);
          else if (/return|refund/i.test(t)) spend = -Math.abs(a);
          else return;
        } else spend = purchasesNegative ? -a : a;
      }
      if (!spend) return;
      if (spend < 0 && (REWARD.test(desc) || /payment|\bpmt\b/i.test(desc) || (catC >= 0 && /payment/i.test(r[catC] || '')))) return;
      txns.push({ date: d, desc: desc, amount: spend, kind: spend > 0 ? 'purchase' : 'refund', bankCat: catC >= 0 ? r[catC] : '', key: merchantKey(desc) });
    }
    var purchases = txns.filter(function (t) { return t.kind === 'purchase'; }).length;
    return { txns: txns, excluded: excluded, error: purchases ? null : 'No purchases were found in that file.' };
  }

  // ---------- PDF ----------
  // Input: one array per page of positioned text items { str, x, y } (pdf.js getTextContent).
  // Output: the same transaction shape as CSV, plus the statement's own purchase total if it has one.
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  var PDF_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$|^([a-z]{3,4})\.? (\d{1,2})(?:,? (\d{4}))?$/i;
  // Chase and others print amounts under a dollar without a leading zero (".70").
  var PDF_AMOUNT = /^(-|\+)?\s*\(?\$?\s*(-)?\s*((?:\d[\d,]*)?\.\d{2})\)?\s*(cr|-)?$/i;

  function pdfLines(pages) {
    var out = [];
    pages.forEach(function (items, p) {
      var rows = [];
      items.filter(function (it) { return String(it.str).trim(); }).sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
        var row = rows.length && Math.abs(rows[rows.length - 1].y - it.y) <= 2 ? rows[rows.length - 1] : null;
        if (!row) rows.push(row = { page: p + 1, y: it.y, cells: [] });
        row.cells.push({ x: it.x, str: String(it.str).replace(/\s+/g, ' ').trim() });
      });
      rows.forEach(function (r) {
        r.cells.sort(function (a, b) { return a.x - b.x; });
        r.text = r.cells.map(function (c) { return c.str; }).join(' ');
        out.push(r);
      });
    });
    return out;
  }

  function pdfAmount(s) {
    var m = String(s).trim().match(PDF_AMOUNT);
    if (!m) return null;
    var n = parseFloat(m[3].replace(/,/g, ''));
    var neg = m[1] === '-' || m[2] === '-' || /^\(.*\)$/.test(String(s).trim().replace(/^[-+]/, '')) || /cr|-/i.test(m[4] || '');
    return neg ? -n : n;
  }

  function statementPeriod(lines) {
    var re = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:to|through|thru|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].text.match(re);
      if (m) {
        var y1 = +m[3] < 100 ? +m[3] + 2000 : +m[3], y2 = +m[6] < 100 ? +m[6] + 2000 : +m[6];
        return { start: new Date(Date.UTC(y1, +m[1] - 1, +m[2])), end: new Date(Date.UTC(y2, +m[4] - 1, +m[5])) };
      }
      // Bank of America monthly statements: "May 18 - June 17, 2025" (the start's year left out unless it differs).
      var w = lines[i].text.match(/\b([a-z]{3,9})\.? (\d{1,2})(?:, (\d{4}))?\s*(?:to|through|thru|-|–)\s*([a-z]{3,9})\.? (\d{1,2}), (\d{4})/i);
      var a = w && MONTHS[w[1].slice(0, 3).toLowerCase()], b = w && MONTHS[w[4].slice(0, 3).toLowerCase()];
      if (w && a != null && b != null) {
        var ye = +w[6], ys = w[3] ? +w[3] : a > b ? ye - 1 : ye;
        return { start: new Date(Date.UTC(ys, a, +w[2])), end: new Date(Date.UTC(ye, b, +w[5])) };
      }
    }
    return null;
  }

  function pdfDate(s, period) {
    var m = String(s).trim().match(PDF_DATE);
    if (!m) return null;
    var mo, d, y;
    if (m[1]) { mo = +m[1] - 1; d = +m[2]; y = m[3] ? +m[3] : null; }
    else { mo = MONTHS[m[4].toLowerCase()]; if (mo == null) return null; d = +m[5]; y = m[6] ? +m[6] : null; }
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    if (y != null && y < 100) y += 2000;
    if (y == null) {
      if (!period) return undefined;
      // Statements print "Sep 05" or "08/25". Take the year from the statement period,
      // which handles a December to January statement.
      y = period.end.getUTCFullYear();
      if (Date.UTC(y, mo, d) > period.end.getTime() + 31 * 864e5) y--;
    }
    return new Date(Date.UTC(y, mo, d));
  }

  // OCR output (Tesseract lines of words with pixel boxes) to the same positioned text items pdf.js gives,
  // so scanned statements go through the same row detector and reconciliation. Words close together become
  // one cell; a wide gap starts a new column. y is the line's baseline at the word, flipped and scaled to points.
  function ocrItems(lines, scale, pageHeightPx) {
    var items = [];
    // A scan or photo is rarely straight. Take the page's tilt as the median slope of its longer lines and
    // straighten every word, otherwise the date and amount of one row land at different heights.
    var slopes = lines.map(function (l) { var b = l.baseline; return b && b.x1 - b.x0 > 60 ? (b.y1 - b.y0) / (b.x1 - b.x0) : null; })
      .filter(function (s) { return s != null; }).sort(function (a, b) { return a - b; });
    var tilt = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
    lines.forEach(function (line) {
      var words = (line.words || []).filter(function (w) { return String(w.text).trim(); });
      if (!words.length) return;
      var b = line.baseline || { x0: line.bbox.x0, y0: line.bbox.y1, x1: line.bbox.x1, y1: line.bbox.y1 };
      var slope = b.x1 !== b.x0 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
      var charW = words.reduce(function (s, w) { return s + (w.bbox.x1 - w.bbox.x0); }, 0) /
        Math.max(1, words.reduce(function (s, w) { return s + String(w.text).length; }, 0));
      var cell = null;
      words.forEach(function (w) {
        if (cell && w.bbox.x0 - cell.right <= charW * 2.5) { cell.str += ' ' + w.text; cell.right = w.bbox.x1; return; }
        var by = b.y0 + slope * (w.bbox.x0 - b.x0) - tilt * w.bbox.x0;
        cell = { str: String(w.text), x: w.bbox.x0 / scale, y: (pageHeightPx - by) / scale, right: w.bbox.x1 };
        items.push(cell);
      });
    });
    return items.map(function (c) { return { str: c.str, x: c.x, y: c.y }; });
  }

  function extractPdfTransactions(pages) {
    var lines = pdfLines(pages);
    if (!lines.length) return { txns: [], error: 'This PDF has no readable text. It may be a scanned image, which is not supported. Download a CSV from the card issuer instead.' };
    var period = statementPeriod(lines);
    var section = 'unknown', txns = [], excluded = 0, skipped = [], statedTotal = null, missingYear = false;
    var label = null, labelAt = -9, bankCat = ''; // the bank's category heading over the rows that follow
    lines.forEach(function (ln, li) {
      var cells = ln.cells, low = ln.text.toLowerCase();
      var amtAt = cells.length - 1;
      var amt = cells.length > 1 ? pdfAmount(cells[amtAt].str) : null;
      // U.S. Bank prints a credit marker in its own cell after the amount: "$500.00 | CR".
      if (amt == null && cells.length > 2 && /^(cr|dr|credit|-)$/i.test(cells[amtAt].str)) {
        var a2 = pdfAmount(cells[amtAt - 1].str);
        if (a2 != null) { amtAt--; amt = /^d/i.test(cells[amtAt + 1].str) ? Math.abs(a2) : -Math.abs(a2); }
      }
      var t = /total purchases\b[^$\d]*\$?([\d,]+\.\d{2})/i.exec(ln.text);
      if (t) { statedTotal = parseFloat(t[1].replace(/,/g, '')); return; }
      // Summary line: "Purchases | +$1,103.52" (Chase) or "Purchases | + | $1,103.52" (U.S. Bank, sign in its own cell).
      if (amt != null && cells.length >= 2 && /^purchases( and adjustments)?$/i.test(cells[0].str) &&
          cells.slice(1, amtAt).every(function (c) { return /^[+\-=]$/.test(c.str); })) { if (statedTotal == null) statedTotal = Math.abs(amt); return; }
      var d0 = cells.length ? pdfDate(cells[0].str, period) : null;
      if (d0 === undefined) { missingYear = true; return; }
      // "Electronics | $99.99" over a "Date | Description | … | Amount" header names the category of the rows below,
      // until the next one; a header with no label above it (a table going on to a new page) keeps the last.
      if (!d0 && amt != null && cells.length === 2 && /^[a-z][a-z &\/,'-]{1,40}$/i.test(cells[0].str) &&
          !/total|balance|payment|credit|purchase|fee|interest|advance|cash|reward|limit|due/i.test(cells[0].str)) { label = cells[0].str; labelAt = li; return; }
      if (!d0 && amt == null && /^date\b/i.test(cells.length ? cells[0].str : '') && /\bdescription\b/i.test(low)) {
        if (label && li - labelAt <= 2) bankCat = label;
        label = null;
        return;
      }
      if (!d0 || amt == null) {
        // A line with no amount that names a kind of activity starts a new section.
        // Page headers such as "ACCOUNT ACTIVITY (CONTINUED)" keep the section they continue.
        if (amt == null && !d0 && ln.text.length < 60 && !/continued/.test(low)) {
          if (/payments?\b.*credits?|credits?\b.*payments?|^payments?$/.test(low)) section = 'credit';
          else if (/fees|interest charged|interest charge/.test(low)) section = 'charge';
          // Chase heads its purchase section "PURCHASE", singular.
          else if (/\bpurchases?\b|transactions|activity/.test(low)) section = 'purchase';
        }
        // Something that looks like a transaction but could not be read is reported, never dropped silently.
        // A date on a line by itself is a heading or a footnote, not a transaction.
        if (d0 && amt == null && cells.length > 1) skipped.push(ln.text);
        return;
      }
      var first = 1;
      if (cells.length > 2 && pdfDate(cells[1].str, period)) first = 2; // post date column
      // U.S. Bank has a reference number column between the dates and the merchant.
      if (amtAt - first > 1 && /^\d{3,}$/.test(cells[first].str)) first++;
      var desc = cells.slice(first, amtAt).map(function (c) { return c.str; }).join(' ').trim();
      if (!desc) { skipped.push(ln.text); return; }
      if (PAYMENT.test(desc) || CHARGE.test(desc) || section === 'charge') { excluded++; return; }
      var spend = section === 'credit' ? -Math.abs(amt) : amt;
      if (spend < 0 && (REWARD.test(desc) || /payment|\bpmt\b/i.test(desc))) { excluded++; return; } // Bank of America: "PMT FROM ..."
      txns.push({ date: d0, desc: desc, amount: spend, kind: spend > 0 ? 'purchase' : 'refund', bankCat: bankCat, key: merchantKey(desc) });
    });
    if (missingYear && !txns.length) return { txns: [], error: 'Transaction dates in this PDF have no year, and no statement period was found to supply one.' };
    var purchaseTotal = Math.round(txns.reduce(function (s, x) { return s + (x.amount > 0 ? x.amount : 0); }, 0) * 100) / 100;
    var res = { txns: txns, excluded: excluded, skipped: skipped, statedTotal: statedTotal, purchaseTotal: purchaseTotal, warnings: [], error: null };
    if (!txns.some(function (x) { return x.amount > 0; })) {
      res.error = 'No purchase rows were found in this PDF. Its layout may not be supported yet. Download a CSV from the card issuer instead.';
      res.txns = [];
      return res;
    }
    if (skipped.length) res.warnings.push(skipped.length + (skipped.length === 1 ? ' line looks' : ' lines look') + ' like a transaction but could not be read: ' + skipped.slice(0, 3).join('; '));
    if (statedTotal != null && Math.abs(purchaseTotal - statedTotal) > statedTotal * 0.01) {
      var off = 'Parsed purchases total $' + purchaseTotal.toFixed(2) + ' but the statement says $' + statedTotal.toFixed(2) + '.';
      // Far off means the layout was misread. Leave the file out rather than show a result built on it.
      if (Math.abs(purchaseTotal - statedTotal) > statedTotal * 0.05) {
        res.error = off + ' This layout was not read correctly, so the file was left out. Download a CSV from the card issuer instead.';
        res.txns = [];
        return res;
      }
      res.warnings.push(off + ' Some rows may be missing or misread.');
    }
    var refundTotal = -txns.reduce(function (s, x) { return s + (x.amount < 0 ? x.amount : 0); }, 0);
    if (refundTotal > purchaseTotal) res.warnings.push('Refunds ($' + refundTotal.toFixed(2) + ') are larger than purchases ($' + purchaseTotal.toFixed(2) + '), which usually means credits and purchases were mixed up.');
    return res;
  }

  // Combine files without double counting. A row (date, description, amount) is kept as many
  // times as it appears in the one file that has it most often, so re-uploading a file or
  // uploading overlapping date ranges adds nothing, while identical same-day purchases within
  // a single statement still all count.
  // Which card a statement file is from (PRD U4): the issuer from a known CSV header or the issuer's name in the
  // file or its file name, the last four digits when the file shows them, and a card when the file or its name
  // names one of that issuer's products (or the issuer has only one). text is a CSV's text or a PDF's text lines.
  var ISSUER_HEADERS = [['chase', /^transaction date,post date,description,category,type,amount,memo/], ['capital-one', /card no\./],
    ['citi', /^status,date,description,debit,credit/], ['discover', /^trans\. date,post date,description,amount,category/],
    ['bank-of-america', /^posted date,reference number,payee,address,amount/]];
  // A PDF's text may break a name across lines ("American" then "Express"), so the spaces in a name match any white space.
  var ISSUER_NAMES = [['amex', /american\s*express|\bamex\b/], ['chase', /\bchase\b/], ['bank-of-america', /bank\s+of\s+america|bankofamerica/],
    ['capital-one', /capital\s*one|\bcapone\b/], ['citi', /\bciti(bank)?\b/], ['discover', /\bdiscover\b/], ['wells-fargo', /wells\s*fargo/],
    ['us-bank', /u\.? ?s\.? bank|\busbank\b/], ['barclays', /\bbarclays\b/], ['robinhood', /\brobinhood\b/], ['penfed', /\bpenfed\b/]];
  var BRAND = /^(american express|amex|chase|bank of america|capital one|citi|discover|wells fargo|u\.s\. bank|barclays|robinhood|penfed)\s+/;
  // [issuer, card, a line only that card's statements print]. Bank of America's statements don't name the card, but
  // only Customized Cash Rewards has a category bonus (checked on 22 real statements).
  // ponytail: one rule from real statements; add others as statements from those cards turn up.
  var SUMMARY_MARKS = [['bank-of-america', 'bank-of-america-customized-cash-rewards', /category bonus earned/]];
  // A card's name as a statement prints it: any case, with ®, ™ or ℠ and line breaks anywhere, and a few words inside it
  // ("Hilton Honors American Express Surpass", "Southwest Rapid Rewards Plus", "IHG One Rewards Premier"). In the statement
  // text the name must read as a card's, not a merchant's: after the issuer's name, with a ® mark, or before a word like
  // Card or Visa (before any number). Other names a card goes by are in NAME_ALIASES (SavorOne became Savor; Amazon Prime Visa is printed Prime Visa).
  var NAME_ALIASES = { savorone: ['savorone'], 'prime-visa': ['prime visa'] };
  var ISSUER_WORD = /^(chase|citi|citibank|one|express|amex|the)$/, CARD_WORD = /^(card|visa|mastercard|credit|american|signature|rewards|®)$/;
  function nameWords(s) { return String(s).toLowerCase().replace(/\((r|tm|sm)\)|[®™℠]/g, ' ® ').replace(/[^a-z0-9®]+/g, ' ').trim().split(' '); }
  // How well the words of a name show up in the tokens: 0 for no match, else more for a longer name, then an earlier one.
  function nameMatch(tokens, words, anchored) {
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] !== words[0]) continue;
      var k = 1, gap = 0, j = i + 1, mark = false;
      for (; j < tokens.length && k < words.length; j++) {
        if (tokens[j] === '®') { mark = true; continue; }
        if (tokens[j] === words[k]) { k++; gap = 0; } else if (++gap > 3) break;
      }
      if (k < words.length) continue;
      // the words just after the name, up to the first number (a merchant line goes on to its amount)
      var before = tokens[i - 1] === '®' ? tokens[i - 2] : tokens[i - 1], after = [];
      for (var a = j; a < j + 3 && a < tokens.length && !/\d/.test(tokens[a]); a++) after.push(tokens[a]);
      if (!anchored || mark || ISSUER_WORD.test(before || '') || words.concat(after).some(function (w) { return CARD_WORD.test(w); })) return words.length * 1e6 - i; // then the earliest: the header comes before ads
    }
    return 0;
  }
  function fileIdentity(text, filename) {
    var t = String(text || '').slice(0, 6000).toLowerCase(), n = String(filename || '').toLowerCase().replace(/[_\-.]+/g, ' ');
    var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); }), first = (lines[0] || '').replace(/"/g, '').replace(/\s*,\s*/g, ',').trim();
    var issuer = null, i;
    for (i = 0; i < ISSUER_HEADERS.length && !issuer; i++) if (ISSUER_HEADERS[i][1].test(first)) issuer = ISSUER_HEADERS[i][0];
    for (i = 0; i < ISSUER_NAMES.length && !issuer; i++) if (ISSUER_NAMES[i][1].test(n + ' ' + t)) issuer = ISSUER_NAMES[i][0];
    if (!issuer && /^"\d{1,2}\/\d{1,2}\/\d{4}","-?[\d.]+","\*"/.test(lines[0] || '')) issuer = 'wells-fargo'; // Wells Fargo's headerless export
    var m = t.match(/ending(?:\s+in)?\s*[:#]?\s*(\d{4})\b/) || t.match(/(?:x{2,}|\*{2,}|•{2,})\s*-?\s*(\d{4})\b/), last4 = m ? m[1] : null;
    if (!last4 && /card no\./.test(first) && lines[1]) {
      var col = first.split(',').indexOf('card no.'), v = lines[1].replace(/"/g, '').split(',')[col];
      if (/^\d{4}$/.test((v || '').trim())) last4 = v.trim();
    }
    var cands = HOLDABLE.filter(function (c) { return c.issuer === issuer; }), card = cands.length === 1 ? cands[0].id : null, best = 0;
    var tw = nameWords(t), nw = nameWords(n);
    cands.forEach(function (c) {
      [c.name.toLowerCase().replace(BRAND, '')].concat(NAME_ALIASES[c.id] || []).forEach(function (nm) {
        var w = nameWords(nm), sc = Math.max(nameMatch(nw, w, false), nameMatch(tw, w, true)); // the longest name found wins
        if (sc > best) { best = sc; card = c.id; }
      });
    });
    // Statements that never print the card's name: a line in the rewards summary only one of the issuer's cards has,
    // anywhere in the statement (it is usually past the first pages).
    if (!best) {
      var all = String(text || '').toLowerCase();
      SUMMARY_MARKS.forEach(function (s) { if (s[0] === issuer && s[2].test(all) && cands.some(function (c) { return c.id === s[1]; })) card = s[1]; });
    }
    return { issuer: issuer, last4: last4, card: card };
  }

  // What the cards you hold earned on the spending you gave each of them, as a yearly net (PRD R4): each card's
  // purchases at its own rates, caps and credits, every held card's fee, scaled to a year the same way as the
  // best setup (byCard: { cardId: [transactions] }; months: how many months the whole upload covers).
  function currentNet(byCard, held, overrides, params, months) {
    var per = held.map(function (id) {
      var base = HOLDABLE.filter(function (c) { return c.id === id; })[0], txns = byCard[id] || [], card, earn = 0, credits = 0;
      if (!base) return null;
      if (txns.length) {
        var data = buildData(txns, overrides), f = data.m / months, assign = {};
        card = applyParams(base, params, data); prepare(card, data);
        data.cats.forEach(function (c) { assign[c] = 0; });
        earn = walletEval([card], assign, data).earn * f; credits = card.credits * f;
      } else card = applyParams(base, params, null);
      return { card: card, earn: earn, credits: credits, net: earn + credits - card.fee };
    }).filter(Boolean);
    return { cards: per, net: per.reduce(function (a, p) { return a + p.net; }, 0) };
  }

  // What a file added: purchases, refunds, date range and totals (P4). Refunds are negative amounts.
  function fileSummary(txns) {
    var out = { purchases: 0, refunds: 0, spent: 0, refunded: 0, from: null, to: null };
    txns.forEach(function (t) {
      if (t.amount > 0) { out.purchases++; out.spent += t.amount; } else { out.refunds++; out.refunded -= t.amount; }
      if (!out.from || t.date < out.from) out.from = t.date;
      if (!out.to || t.date > out.to) out.to = t.date;
    });
    return out;
  }

  function txnId(t) {
    return t.date.toISOString().slice(0, 10) + '|' + t.desc.toUpperCase().replace(/\s+/g, ' ').trim() + '|' + Math.round(t.amount * 100);
  }

  function mergeFiles(lists) {
    var kept = {}, out = [], dropped = 0;
    lists.forEach(function (txns) {
      var seen = {};
      txns.forEach(function (t) {
        var id = txnId(t);
        seen[id] = (seen[id] || 0) + 1;
        if (seen[id] > (kept[id] || 0)) { kept[id] = seen[id]; out.push(t); } else dropped++;
      });
    });
    out.sort(function (a, b) { return a.date - b.date; });
    return { txns: out, dropped: dropped };
  }

  // ---------- data ----------
  function buildData(txns, overrides) {
    var minK = Infinity, maxK = -Infinity, minD = null, maxD = null;
    txns.forEach(function (t) {
      var k = t.date.getUTCFullYear() * 12 + t.date.getUTCMonth();
      if (k < minK) minK = k; if (k > maxK) maxK = k;
      if (!minD || t.date < minD) minD = t.date;
      if (!maxD || t.date > maxD) maxD = t.date;
    });
    var m = Math.max(1, maxK - minK + 1);
    var months = []; for (var i = 0; i < m; i++) months.push({});
    var byCat = {}, merchants = dict(), total = 0, count = 0;
    var sorted = txns.slice().sort(function (a, b) { return a.date - b.date; });
    // In date order, so each month lists its categories in the order they were first bought: shared caps fill that way.
    sorted.forEach(function (t) {
      var info = categoryInfo(t, overrides), c = info.cat;
      t.cat = c;
      var k = t.date.getUTCFullYear() * 12 + t.date.getUTCMonth() - minK;
      months[k][c] = (months[k][c] || 0) + t.amount;
      byCat[c] = (byCat[c] || 0) + t.amount;
      total += t.amount;
      if (t.amount > 0) count++;
      var mm = merchants[t.key] || (merchants[t.key] = { key: t.key, name: t.desc, spend: 0, n: 0, cat: c, source: info.source, alt: info.alt });
      mm.spend += t.amount; mm.n++; mm.cat = c;
    });
    var cats = CATS.map(function (c) { return c.id; }).filter(function (c) { return byCat[c] > 0; });
    var ml = Object.keys(merchants).map(function (k) { return merchants[k]; }).sort(function (a, b) { return b.spend - a.spend; });
    return { months: months, m: m, k0: minK, byCat: byCat, cats: cats, total: total, merchants: ml, count: count, minDate: minD, maxDate: maxD, txns: sorted };
  }

  // ---------- earn model ----------
  // Points a card earns on the given monthly category totals, as dollars a year. Caps apply per month, calendar
  // quarter or (scaled to the data) year, and categories with the same cap group share one limit, used up in purchase order.
  // A top-category card pays its top rate on the category the person chose. Without a choice that is the one
  // choice that earns most over the whole year, since people pick once and rarely switch; a card that picks for
  // you (top.auto) pays on the eligible category spent most on each month.
  function cardEarn(card, monthly, m, k0) {
    if (!card.top || card.top.auto) return earnWith(card, monthly, m, k0, null);
    if (card.topChoice != null) return earnWith(card, monthly, m, k0, card.top.groups[card.topChoice].cats);
    var best = 0;
    card.top.groups.forEach(function (g) { best = Math.max(best, earnWith(card, monthly, m, k0, g.cats)); });
    return best;
  }

  function earnWith(card, monthly, m, k0, fixedCats) {
    var rates = card.rates || {}, pts = 0, buckets = {}, i, j, c, key;
    for (i = 0; i < monthly.length; i++) {
      var mo = monthly[i], topCat = null, extra = card.extra && card.extra[i];
      if (card.top) {
        var best = 0;
        if (fixedCats) topCat = fixedCats;
        else for (j = 0; j < card.top.groups.length; j++) {
          var g = card.top.groups[j], v = 0;
          for (var q = 0; q < g.cats.length; q++) v += mo[g.cats[q]] || 0;
          if (v > best) { best = v; topCat = g.cats; }
        }
      }
      for (c in mo) {
        var a = mo[c], rate, cap;
        // Rotating 5%: this quarter's category spending, up to the quarter's limit, in purchase order. What's left
        // of the category earns its normal rate below.
        var rs = card.rotSpend && card.rotSpend[i] && card.rotSpend[i][c];
        if (rs > 0 && a > 0) {
          var rb = buckets['rot|' + Math.floor((k0 + i) / 3)] || (buckets['rot|' + Math.floor((k0 + i) / 3)] = { left: card.rot.cap });
          var rt = Math.min(rs, a, Math.max(rb.left, 0));
          pts += rt * card.rot.rate; rb.left -= rt; a -= rt;
        }
        if (topCat && topCat.indexOf(c) >= 0) { rate = card.top.rate; cap = card.top.cap; }
        else { rate = rates[c] !== undefined ? rates[c] : card.base; cap = card.caps && card.caps[c]; }
        if (extra && extra[c]) pts += extra[c];
        if (!cap) { pts += a * rate; continue; }
        key = (cap.group || (cap === (card.top && card.top.cap) ? 'top' : c)) + '|' + (cap.period === 'month' ? i : cap.period === 'quarter' ? Math.floor((k0 + i) / 3) : 'y');
        // A cap is used up in the order purchases are made, as banks count it: month by month, and within a month
        // in the order each category was first bought. A refund (a net negative month) gives back nothing.
        var b = buckets[key] || (buckets[key] = { left: cap.period === 'month' || cap.period === 'quarter' ? cap.limit : cap.limit * m / 12 });
        if (a <= 0) { pts += a * rate; continue; }
        var take = Math.min(a, Math.max(b.left, 0));
        pts += take * rate + (a - take) * cap.after;
        b.left -= take;
      }
    }
    return pts * card.cpp / 100 * 12 / m;
  }

  // Rotating categories: per month and category, the spending that was in that quarter's 5% categories (by category
  // or merchant name). Quarters missing from the calendar earn the normal rates.
  function quarterKey(d) { return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1); }
  function rotatingSpend(card, data) {
    if (!card.rot) return null;
    var out = data.months.map(function () { return {}; });
    data.txns.forEach(function (t) {
      var q = card.rot.quarters[quarterKey(t.date)];
      if (!q || (q.cats.indexOf(t.cat) < 0 && !(q.re && q.re.test(t.desc)))) return;
      var i = t.date.getUTCFullYear() * 12 + t.date.getUTCMonth() - data.k0;
      out[i][t.cat] = (out[i][t.cat] || 0) + t.amount;
    });
    return out;
  }

  // Brand bonuses (say 3x on Delta) as extra points per month and category, on top of the card's normal rate there.
  function brandExtra(card, data) {
    if (!card.brands) return null;
    var extra = data.months.map(function () { return {}; }), rates = card.rates || {};
    card.brandHits = {}; // category -> the brands bought in it, so a rate label names only those
    data.txns.forEach(function (t) {
      for (var b = 0; b < card.brands.length; b++) {
        var br = card.brands[b], normal = rates[t.cat] !== undefined ? rates[t.cat] : card.base;
        if (br.rate <= normal || (br.cats && br.cats.indexOf(t.cat) < 0) || !br.re.test(t.desc)) continue;
        var i = t.date.getUTCFullYear() * 12 + t.date.getUTCMonth() - data.k0;
        extra[i][t.cat] = (extra[i][t.cat] || 0) + t.amount * (br.rate - normal);
        (card.brandHits[t.cat] = card.brandHits[t.cat] || {})[b] = true;
        break;
      }
    });
    return extra;
  }

  // Most cards earn the same on a category whatever else they hold, so their earnings are worked out once per
  // category. Top-category cards and shared caps depend on the whole set, so those are recomputed each time.
  function prepare(card, data) {
    card.extra = brandExtra(card, data);
    card.rotSpend = rotatingSpend(card, data);
    card.separable = !card.top && !card.rot && !(card.caps && Object.keys(card.caps).some(function (k) { return card.caps[k].group; }));
    card.byCat = {};
    card.memo = {};
    if (card.separable) data.cats.forEach(function (c) {
      card.byCat[c] = cardEarn(card, data.months.map(function (mo) { var o = {}; if (mo[c]) o[c] = mo[c]; return o; }), data.m, data.k0);
    });
  }

  function earnOn(card, idx, assign, data) {
    var key = '', e = 0;
    if (card.separable) { data.cats.forEach(function (c) { if (assign[c] === idx) e += card.byCat[c]; }); return e; }
    // The same card is tried with the same categories in many pairs and triples, so remember each answer.
    data.cats.forEach(function (c) { key += assign[c] === idx ? '1' : '0'; });
    if (card.memo[key] === undefined) {
      // Each month keeps its own order (categories as first bought), which is the order shared caps fill in.
      var sub = data.months.map(function (mo) { var o = {}; Object.keys(mo).forEach(function (c) { if (assign[c] === idx && mo[c]) o[c] = mo[c]; }); return o; });
      card.memo[key] = cardEarn(card, sub, data.m, data.k0);
    }
    return card.memo[key];
  }

  // Card terms after the person's edits. Credits default to what the statements show they would have used.
  function applyParams(card, params, data) {
    var p = (params && params[card.id]) || {};
    var o = {}; for (var k in card) o[k] = card[k];
    // A membership the card requires (Amazon Prime for the Prime Visa) costs extra unless the statements show it paid.
    var mem = card.membership, memFee = mem && data && !data.txns.some(function (t) { return mem.re.test(t.desc); }) ? mem.fee : 0;
    o.membershipFee = p.fee != null ? 0 : memFee;
    o.fee = p.fee != null ? p.fee : card.fee + memFee;
    o.firstYearFee = Math.min((card.firstYearFee != null ? card.firstYearFee : card.fee) + o.membershipFee, o.fee);
    o.cpp = p.cpp != null ? p.cpp : card.cpp;
    o.topChoice = card.top && p.choice != null && card.top.groups[p.choice] ? p.choice : null;
    o.creditInfo = data ? creditsUsed(card, data) : null;
    o.creditsAuto = p.credits == null;
    o.credits = p.credits != null ? p.credits : (o.creditInfo ? o.creditInfo.used : 0);
    return o;
  }

  // ---------- credits and sign-up bonuses ----------
  var PER_YEAR = { month: 12, quarter: 4, 'half-year': 2, year: 1, '4-years': 0.25, once: 0 };

  function periodKey(period, date, start) {
    var y = date.getUTCFullYear(), mo = date.getUTCMonth();
    if (period === 'month') return y * 12 + mo;
    if (period === 'quarter') return y * 4 + Math.floor(mo / 3);
    if (period === 'half-year') return y * 2 + Math.floor(mo / 6);
    // Yearly credits count 12-month card years from the first purchase, so a year of statements never uses one twice.
    if (period === 'year') return Math.floor(((y - start.getUTCFullYear()) * 12 + mo - start.getUTCMonth()) / 12);
    return 0;
  }

  function merchantMatcher(words) {
    return new RegExp('\\b(' + words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'i');
  }

  // What each credit would have paid back: purchases whose description names one of its merchants, capped at the
  // credit in each period. used is dollars a year; a four-year credit is spread over four years; a one-time credit
  // counts only in year one.
  // Credits count as the statements show (the default) unless the person says what they'd use: PICKS maps
  // creditKey(card, credit) to dollars a year (for a one-time credit, its dollars in year one). With credits off
  // (CREDIT_MODE 'none') no card gets any.
  var CREDIT_MODE = 'used', PICKS = {};
  function useCredits(mode, picks) { CREDIT_MODE = mode === 'none' ? 'none' : 'used'; PICKS = picks || {}; }
  function creditKey(card, cr) { return card.id + '|' + cr.name; }
  function creditsUsed(card, data) {
    var out = { used: 0, available: 0, firstYear: 0, lines: [] };
    (card.creditList || []).forEach(function (cr) {
      var re = merchantMatcher(cr.merchants), spent = {}, total = 0, used = 0, k;
      data.txns.forEach(function (t) {
        if (t.amount <= 0 || !re.test(t.desc)) return;
        k = periodKey(cr.period, t.date, data.minDate);
        spent[k] = (spent[k] || 0) + t.amount;
        total += t.amount;
      });
      for (k in spent) used += Math.min(spent[k], cr.amount);
      var line = { key: creditKey(card, cr), name: cr.name, period: cr.period, amount: cr.amount, merchants: cr.merchants, spent: total, available: cr.amount * PER_YEAR[cr.period], used: 0, firstYear: 0 };
      // found: what the statements show, as dollars a year (dollars in year one for a one-time credit).
      if (cr.period === 'once') line.found = used;
      else if (cr.period === '4-years') line.found = used / 4;
      else line.found = Math.min(used * 12 / data.m, line.available);
      var max = cr.period === 'once' ? cr.amount : line.available, pick = PICKS[line.key];
      line.picked = pick != null;
      var v = CREDIT_MODE === 'none' ? 0 : line.picked ? Math.max(0, Math.min(pick, max)) : line.found;
      if (cr.period === 'once') line.firstYear = v; else line.used = v;
      out.lines.push(line);
      out.used += line.used; out.available += line.available; out.firstYear += line.firstYear;
    });
    return out;
  }

  // The sign-up bonus, if the purchases routed to this card reach the minimum spend in time. Assumes every card
  // is opened on the day of the first purchase in the statements.
  function bonusFor(card, idx, assign, data) {
    var b = card.bonus;
    if (!b || !b.points) return null;
    var end = data.minDate.getTime() + b.days * 864e5, spend = 0, day = b.minSpend > 0 ? null : 0;
    for (var i = 0; i < data.txns.length && day === null; i++) {
      var t = data.txns[i];
      if (t.date.getTime() >= end) break;
      if (assign[t.cat] !== idx) continue;
      spend += t.amount;
      if (spend >= b.minSpend) day = Math.round((t.date - data.minDate) / 864e5) + 1;
    }
    return { value: b.points * card.cpp / 100, earned: day !== null, day: day, spend: spend, minSpend: b.minSpend, days: b.days };
  }

  // First-year rates, counted from the first purchase like the sign-up bonus: a top category paid at a higher rate
  // for the first 12 months (inside its usual cap), and extra points on base-rate purchases for the first days, up to
  // a spend limit. Fewer than 12 months of data are scaled to a year, like everything else.
  function introValue(card, idx, assign, data) {
    var v = 0, k;
    if (card.top && card.top.firstYearRate) {
      var n = Math.min(12, data.months.length), boosted = {};
      var sub = data.months.slice(0, n).map(function (mo) { var o = {}; data.cats.forEach(function (c) { if (assign[c] === idx && mo[c]) o[c] = mo[c]; }); return o; });
      for (k in card) boosted[k] = card[k];
      boosted.top = {}; for (k in card.top) boosted.top[k] = card.top[k];
      boosted.top.rate = card.top.firstYearRate;
      // ponytail: without a fixed choice each version takes its own best choice; they only differ when two choices tie closely.
      v += cardEarn(boosted, sub, n, data.k0) - cardEarn(card, sub, n, data.k0);
    }
    var x = card.bonus && card.bonus.extra;
    if (x) {
      var end = data.minDate.getTime() + x.days * 864e5, spend = 0, rates = card.rates || {};
      data.txns.forEach(function (t) {
        if (t.date.getTime() >= end || assign[t.cat] !== idx) return;
        if (rates[t.cat] !== undefined || (card.top && card.top.cats.indexOf(t.cat) >= 0)) return; // bonus categories already earn more
        if ((card.brands || []).some(function (br) { return br.rate > card.base && (!br.cats || br.cats.indexOf(t.cat) >= 0) && br.re.test(t.desc); })) return;
        spend += t.amount;
      });
      v += Math.min(Math.max(spend, 0), x.maxSpend) * x.rate * card.cpp / 100;
    }
    return v;
  }

  // Year one on top of the ongoing yearly net: bonuses earned, first-year rates, any first-year fee waiver, one-time credits.
  function firstYear(cards, assign, data) {
    var extra = 0, intros = [], bonuses = cards.map(function (c, i) {
      var bonus = bonusFor(c, i, assign, data), intro = introValue(c, i, assign, data);
      intros.push(intro);
      extra += (bonus && bonus.earned ? bonus.value : 0) + intro + (c.fee - c.firstYearFee) + (c.creditsAuto && c.creditInfo ? c.creditInfo.firstYear : 0);
      return bonus;
    });
    return { extra: extra, bonuses: bonuses, intros: intros };
  }

  function walletEval(cards, assign, data) {
    var earn = 0, per = [];
    cards.forEach(function (card, i) { var e = earnOn(card, i, assign, data); per.push(e); earn += e; });
    return { earn: earn, per: per };
  }

  function fixed(cards) {
    var s = 0; cards.forEach(function (c) { s += (c.credits || 0) - c.fee; }); return s;
  }

  function nominal(card, cat) {
    if (card.top && card.top.cats.indexOf(cat) >= 0) return card.top.rate * card.cpp;
    var r = card.rates && card.rates[cat] !== undefined ? card.rates[cat] : card.base;
    return r * card.cpp;
  }

  function packWallet(cards, assign, data, net, earn, per) {
    var y1 = firstYear(cards, assign, data);
    return {
      cards: cards, assign: assign, net: net, earn: earn, yearOne: net + y1.extra,
      perCard: cards.map(function (c, i) {
        return { card: c, earn: per[i], bonus: y1.bonuses[i], intro: y1.intros[i], cats: data.cats.filter(function (x) { return assign[x] === i; }) };
      })
    };
  }

  function bestSingle(cards, data) {
    var assign = {}; data.cats.forEach(function (c) { assign[c] = 0; });
    var out = cards.map(function (card) {
      var r = walletEval([card], assign, data), net = r.earn + fixed([card]), y1 = firstYear([card], assign, data);
      return { card: card, earn: r.earn, net: net, yearOne: net + y1.extra, bonus: y1.bonuses[0] };
    });
    out.sort(function (a, b) { return b.net - a.net; });
    return out;
  }

  // Every pair of simple cards is checked (it is quick); pairs with a top-category or shared-cap card, which need
  // the full search over category splits, are checked among the shortlist.
  function bestPair(cards, data, shortlist) {
    var cats = data.cats, k = cats.length, best = null;
    if (k < 2) return null;
    for (var a = 0; a < cards.length; a++) for (var b = a + 1; b < cards.length; b++) {
      var pair = [cards[a], cards[b]], base = fixed(pair), assign, r, net;
      if (!(pair[0].separable && pair[1].separable) && !(shortlist[pair[0].id] && shortlist[pair[1].id])) continue;
      if (pair[0].separable && pair[1].separable) {
        // Each category to the card that pays more on it (the first card on a tie), but each card gets at least one.
        assign = {}; var n1 = 0;
        cats.forEach(function (c) { assign[c] = pair[1].byCat[c] > pair[0].byCat[c] ? 1 : 0; n1 += assign[c]; });
        if (n1 === 0 || n1 === k) {
          var from = n1 ? 1 : 0, move = -1, loss = Infinity;
          for (var j = 0; j < k; j++) {
            var d = pair[from].byCat[cats[j]] - pair[1 - from].byCat[cats[j]];
            if (from === 0 ? d < loss : d <= loss) { loss = d; move = j; }
          }
          assign[cats[move]] = 1 - from;
        }
        r = walletEval(pair, assign, data); net = r.earn + base;
        if (!best || net > best.net + 1e-9) best = { cards: pair, assign: assign, net: net, earn: r.earn, per: r.per };
        continue;
      }
      for (var mask = 1; mask < (1 << k) - 1; mask++) {
        assign = {};
        for (var jj = 0; jj < k; jj++) assign[cats[jj]] = (mask >> jj) & 1;
        r = walletEval(pair, assign, data); net = r.earn + base;
        if (!best || net > best.net + 1e-9) best = { cards: pair, assign: assign, net: net, earn: r.earn, per: r.per };
      }
    }
    return best && packWallet(best.cards, best.assign, data, best.net, best.earn, best.per);
  }

  function ascend(set, data) {
    var cats = data.cats, base = fixed(set), assign = {};
    cats.forEach(function (c) {
      var bi = 0, bv = -1;
      set.forEach(function (card, i) { var v = nominal(card, c); if (v > bv) { bv = v; bi = i; } });
      assign[c] = bi;
    });
    var cur = walletEval(set, assign, data);
    for (var it = 0; it < 8; it++) {
      var changed = false;
      for (var x = 0; x < cats.length; x++) {
        var c = cats[x], keep = assign[c], bestI = keep, bestE = cur.earn, bestR = cur;
        for (var i = 0; i < set.length; i++) {
          if (i === keep) continue;
          assign[c] = i;
          var r = walletEval(set, assign, data);
          if (r.earn > bestE + 1e-9) { bestE = r.earn; bestI = i; bestR = r; }
        }
        assign[c] = bestI;
        if (bestI !== keep) { changed = true; cur = bestR; }
      }
      if (!changed) break;
    }
    return { cards: set, assign: assign, net: cur.earn + base, earn: cur.earn, per: cur.per };
  }

  function bestTriple(cards, data, shortlist) {
    var best = null;
    if (data.cats.length < 3) return null;
    cards = cards.filter(function (c) { return shortlist[c.id]; });
    for (var a = 0; a < cards.length; a++) for (var b = a + 1; b < cards.length; b++) for (var c = b + 1; c < cards.length; c++) {
      var r = ascend([cards[a], cards[b], cards[c]], data);
      if (!best || r.net > best.net) best = r;
    }
    return best && packWallet(best.cards, best.assign, data, best.net, best.earn, best.per);
  }

  // The cards that can plausibly be part of the best setup: the 16 best on their own, plus the two that earn the
  // most on each spending category. On the example data and every synthetic statement set this finds the same best
  // two- and three-card setups as searching all cards, about ten times faster.
  function shortlistOf(cards, singles, data) {
    var keep = {};
    singles.slice(0, 16).forEach(function (s) { keep[s.card.id] = true; });
    data.cats.forEach(function (c) {
      cards.map(function (card) {
        var alone = card.separable ? card.byCat[c] : cardEarn(card, data.months.map(function (mo) { var o = {}; if (mo[c]) o[c] = mo[c]; return o; }), data.m, data.k0);
        return { id: card.id, e: alone };
      }).sort(function (x, y) { return y.e - x.e; }).slice(0, 2).forEach(function (x) { keep[x.id] = true; });
    });
    return keep;
  }

  // found (optional): the best pair and triple from search() below, worked out ahead in a worker (app.js), so this
  // only scores them; without it the full search runs here.
  function analyze(data, params, found) {
    var cards = CARDS.map(function (c) { var o = applyParams(c, params, data); prepare(o, data); return o; });
    var singles = bestSingle(cards, data);
    var one = singles[0], shortlist = shortlistOf(cards, singles, data);
    var assign1 = {}; data.cats.forEach(function (c) { assign1[c] = 0; });
    var w1 = packWallet([one.card], assign1, data, one.net, one.earn, [one.earn]);
    // A bigger wallet never scores below a smaller one (PRD R6): when another card adds less than its fee, the
    // smaller setup stands, and the page says so.
    var w2 = found ? score(cards, data, found[2]) : bestPair(cards, data, shortlist);
    var w3 = found ? score(cards, data, found[3]) : bestTriple(cards, data, shortlist);
    if (w2 && w2.net < w1.net) w2 = w1;
    if (w3 && w2 && w3.net < w2.net) w3 = w2;
    return {
      cards: cards, singles: singles,
      wallets: { 1: w1, 2: w2, 3: w3 },
      annual: data.total * 12 / data.m
    };
  }

  // The slow part of analyze (about a second on two years of statements): which pair and triple are best, as card
  // ids and each category's card, small enough to post back from a worker.
  function search(data, params) {
    var cards = CARDS.map(function (c) { var o = applyParams(c, params, data); prepare(o, data); return o; });
    var shortlist = shortlistOf(cards, bestSingle(cards, data), data);
    var brief = function (w) { return w && { ids: w.cards.map(function (c) { return c.id; }), assign: w.assign }; };
    return { 2: brief(bestPair(cards, data, shortlist)), 3: brief(bestTriple(cards, data, shortlist)) };
  }
  function score(cards, data, f) {
    if (!f) return null;
    var set = f.ids.map(function (id) { return cards.filter(function (c) { return c.id === id; })[0]; }), r = walletEval(set, f.assign, data);
    return packWallet(set, f.assign, data, r.earn + fixed(set), r.earn, r.per);
  }

  // ---------- the range (BUILD.md 5.2) ----------
  // What a fixed set of cards nets a year, with the categories as given.
  function setNet(ids, txns, overrides, params) {
    var data = buildData(txns, overrides);
    var set = ids.map(function (id) { var c = applyParams(CARDS.filter(function (x) { return x.id === id; })[0], params, data); prepare(c, data); return c; });
    if (set.length > 1) return ascend(set, data).net;
    var assign = {}; data.cats.forEach(function (c) { assign[c] = 0; });
    return walletEval(set, assign, data).earn + fixed(set);
  }

  // The merchants whose category could move this setup's result the most, and the range their answers span.
  // Guessed categories (bank column, model, online check, nothing matched) are tried against their likeliest other
  // answer; a quick estimate from each card's rates picks 12, exact runs keep the 8 that move it at least $1 a year.
  // ponytail: low and high flip every lowering (raising) merchant at once, which is exact unless caps make the
  // answers interact; enumerate the 2^k mixes if that ever matters.
  function uncertainty(txns, overrides, params, ids) {
    var data = buildData(txns, overrides), base = setNet(ids, txns, overrides, params), scale = 12 / data.m;
    var set = ids.map(function (id) { return applyParams(CARDS.filter(function (x) { return x.id === id; })[0], params, data); });
    var best = function (c) { return Math.max.apply(null, set.map(function (card) { return nominal(card, c); })); };
    var with1 = function (o, k, v) { var r = {}; for (var x in o) r[x] = o[x]; r[k] = v; return r; };
    var cands = data.merchants.filter(function (m) { return m.alt && m.alt !== m.cat && m.spend > 0; })
      .map(function (m) { return { m: m, guess: Math.abs(m.spend * scale * (best(m.alt) - best(m.cat)) / 100) }; })
      .sort(function (a, b) { return b.guess - a.guess; }).slice(0, 12)
      .map(function (x) { return { key: x.m.key, name: x.m.name, spend: x.m.spend * scale, cat: x.m.cat, alt: x.m.alt, source: x.m.source, delta: setNet(ids, txns, with1(overrides, x.m.key, x.m.alt), params) - base }; })
      .filter(function (x) { return Math.abs(x.delta) >= 1; })
      .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 8);
    var flip = function (sign) { var o = overrides || {}; cands.forEach(function (x) { if (x.delta * sign > 0) o = with1(o, x.key, x.alt); }); return o; };
    var low = cands.some(function (x) { return x.delta < 0; }) ? setNet(ids, txns, flip(-1), params) : base;
    var high = cands.some(function (x) { return x.delta > 0; }) ? setNet(ids, txns, flip(1), params) : base;
    buildData(txns, overrides); // trying answers re-tags each purchase's category; put the real ones back
    return { base: base, low: Math.min(low, base), high: Math.max(high, base), merchants: cands };
  }

  // ---------- data checks (PRD C4, R7) ----------
  // Signs the answer rests on thin or partial data: a big share in everything else (bonus categories likely missed),
  // under three months, months with no purchases (a statement missing), and spending that looks like one card's
  // share of someone's purchases (no groceries or dining, or fewer than five categories at all).
  function dataChecks(data) {
    var empty = [];
    data.months.forEach(function (mo, i) {
      if (!Object.keys(mo).some(function (c) { return mo[c] > 0; })) empty.push(new Date(Date.UTC(Math.floor((data.k0 + i) / 12), (data.k0 + i) % 12, 1)));
    });
    return {
      otherShare: data.total > 0 ? (data.byCat.other || 0) / data.total : 0, months: data.m, emptyMonths: empty,
      missing: ['groceries', 'dining'].filter(function (c) { return !(data.byCat[c] > 0); }), categories: data.cats.length
    };
  }

  // ---------- point value breakeven (BUILD.md 5.3) ----------
  // Points earnings are linear in what a point is worth, so a setup's yearly gain over the comparison is a line in v
  // (cents a point, the same v for every points card in it); cash back doesn't move. breakeven is the v where the
  // gain is zero (null when nothing in the setup earns points). Ongoing years only: sign-up bonuses are left out.
  // perCard is [{ card, earn }] as in a wallet or single result; fixed is its credits minus fees (net - earn).
  function pointValueLine(perCard, fixed, baseNet) {
    var pts = 0, cash = 0;
    perCard.forEach(function (p) { if (p.card.unit === 'cash') cash += p.earn; else pts += p.earn * 100 / p.card.cpp; });
    var rest = cash + fixed - baseNet;
    return { points: pts, gainAt: function (v) { return rest + pts * v / 100; }, breakeven: pts > 0 ? -rest / pts * 100 : null };
  }

  function flatBaseline(rate, data) { return data.total * rate / 100 * 12 / data.m; }

  // ---------- sample data ----------
  function sample() {
    var seed = 20260101;
    function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    var out = [];
    function add(y, mo, d, desc, amt) { out.push({ date: new Date(Date.UTC(y, mo, d)), desc: desc, amount: Math.round(amt * 100) / 100, bankCat: '', key: merchantKey(desc) }); }
    for (var i = 0; i < 12; i++) {
      var y = 2025 + Math.floor((9 + i) / 12), mo = (9 + i) % 12;
      var n, j;
      n = 7 + Math.floor(rnd() * 3);
      for (j = 0; j < n; j++) add(y, mo, 1 + Math.floor(rnd() * 27), pick(["TRADER JOE'S #512", 'WHOLE FOODS MKT 10234', 'MARKET BASKET 0021', 'STAR MARKET 4410']), 48 + rnd() * 70);
      n = 12 + Math.floor(rnd() * 5);
      for (j = 0; j < n; j++) add(y, mo, 1 + Math.floor(rnd() * 27), pick(['STARBUCKS STORE 18823', 'CHIPOTLE 1920', 'DOORDASH*SWEETGREEN', 'SQ *TATTE BAKERY', 'DUNKIN #338', 'TST* PIZZERIA REGINA']), 7 + rnd() * 28);
      n = 7 + Math.floor(rnd() * 4);
      for (j = 0; j < n; j++) add(y, mo, 1 + Math.floor(rnd() * 27), pick(['MBTA CHARLIECARD', 'UBER *TRIP', 'LYFT *RIDE']), 5 + rnd() * 20);
      n = 3 + Math.floor(rnd() * 3);
      for (j = 0; j < n; j++) add(y, mo, 1 + Math.floor(rnd() * 27), 'AMAZON MKTPL*' + Math.floor(rnd() * 99999), 14 + rnd() * 70);
      n = 4 + Math.floor(rnd() * 3);
      for (j = 0; j < n; j++) add(y, mo, 1 + Math.floor(rnd() * 27), pick(['TARGET 00012345', 'APPLE.COM STORE', 'UNIQLO USA', 'WALMART SUPERCENTER', 'COSTCO WHSE #1051']), 20 + rnd() * 90);
      add(y, mo, 3, 'NETFLIX.COM', 15.49); add(y, mo, 9, 'SPOTIFY USA', 11.99); add(y, mo, 14, 'HBO MAX', 16.99);
      add(y, mo, 17, 'VERIZON WIRELESS PAYMENTS', 65);
      add(y, mo, 12, 'CVS/PHARMACY #04411', 12 + rnd() * 30);
      add(y, mo, 21, pick(['SHELL OIL 57444', 'MOBIL 1099', 'SUNOCO 0412']), 36 + rnd() * 18);
    }
    add(2025, 11, 19, 'DELTA AIR LINES', 384); add(2025, 11, 27, 'MARRIOTT BOSTON', 242);
    add(2026, 2, 14, 'JETBLUE AIRWAYS', 268); add(2026, 2, 17, 'AIRBNB * HMXQ', 410);
    add(2026, 5, 20, 'UNITED AIRLINES', 441); add(2026, 7, 8, 'HERTZ RENT-A-CAR', 196);
    return out;
  }

  root.Engine = {
    CATS: CATS, CAT_LABEL: CAT_LABEL, CARDS: CARDS, HOLDABLE: HOLDABLE, parseCSV: parseCSV, extractTransactions: extractTransactions, extractPdfTransactions: extractPdfTransactions, mergeFiles: mergeFiles,
    pdf: { lines: pdfLines, date: pdfDate, amount: pdfAmount, period: statementPeriod, ocrItems: ocrItems },
    buildData: buildData, analyze: analyze, search: search, flatBaseline: flatBaseline, sample: sample, nominal: nominal,
    applyParams: applyParams, merchantKey: merchantKey, categorize: categorize, categoryInfo: categoryInfo, explainCategory: explainCategory, uncertainty: uncertainty, setNet: setNet, pointValueLine: pointValueLine, dataChecks: dataChecks, fileSummary: fileSummary, fileIdentity: fileIdentity, currentNet: currentNet, useCards: useCards, creditsUsed: creditsUsed,
    useModel: useModel, modelPredict: modelPredict, useCredits: useCredits
  };
  // In Node (tests and tools) load the card file straight away; the page fetches it in app.js.
  if (typeof module === 'object' && module.exports && typeof require === 'function') { useCards(require('./cards.json')); useModel(require('./category-model.json')); }
})(typeof window !== 'undefined' ? window : globalThis);
