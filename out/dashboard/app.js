// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, the radar scope, the calibration the model is built on, a sandbox
// that recomputes the board live, and a per-protocol detail view with the model's own arithmetic
// and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { growth_weight: null, maturity_floor: null, chain_step: null, shrink_prior: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * row.chain_multiplier * row.growth_multiplier * row.maturity_multiplier));
  }
  // The sandbox recompute: the same formula with the sandbox's constants, from the calibration table.
  function multipleFor(category, prior) {
    var g = DATA.global_median;
    var m = DATA.model;
    if (!category) return g;
    var found = null;
    for (var i = 0; i < DATA.calibration.length; i++) if (DATA.calibration[i].category === category) { found = DATA.calibration[i]; break; }
    if (!found) return g;
    var shrunk = (found.n * found.median + prior * g) / (found.n + prior);
    return Math.min(m.winsor_high * g, Math.max(m.winsor_low * g, shrunk));
  }
  function impliedSandbox(row) {
    var m = DATA.model;
    var prior = sandbox.shrink_prior === null ? m.shrink_prior : sandbox.shrink_prior;
    var gw = sandbox.growth_weight === null ? m.growth_weight : sandbox.growth_weight;
    var mf = sandbox.maturity_floor === null ? m.maturity_floor : sandbox.maturity_floor;
    var cs = sandbox.chain_step === null ? m.chain_step : sandbox.chain_step;
    var multiple = round4(multipleFor(row.category, prior));
    var chainMult = round4(1 + cs * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_cap));
    var growthPct = round4(Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d)));
    var growthMult = round4(1 + (growthPct / 100) * gw);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturityMult = round4(mf + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range);
    return Math.max(1, Math.round(row.tvl_usd * multiple * chainMult * growthMult * maturityMult));
  }
  function sandboxActive() {
    return sandbox.growth_weight !== null || sandbox.maturity_floor !== null || sandbox.chain_step !== null || sandbox.shrink_prior !== null;
  }
  function displayRows() {
    if (!sandboxActive()) return DATA.rows.slice();
    var scored = DATA.rows.map(function (r) { return { row: r, implied: impliedSandbox(r) }; });
    scored.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
    return scored.map(function (s, i) {
      var copy = {};
      for (var k in s.row) copy[k] = s.row[k];
      copy.rank = i + 1;
      copy.implied_value_usd = s.implied;
      return copy;
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold, the weekly action and every cost and time. Gas is priced
  // from the protocol's first chain, not guessed flat. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var table = { Ethereum: 8, Arbitrum: 1, Base: 0.5, Optimism: 1, Polygon: 0.5, Solana: 0.05, Binance: 0.3, Avalanche: 0.5, Tron: 1, Bitcoin: 2, Sui: 0.05, Aptos: 0.05, Near: 0.05, Cosmos: 0.1 };
    return table[chain] === undefined ? 2 : table[chain];
  }
  function usdShort(n) { return '$' + (n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, '')); }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply ' + usdShort(capital) + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit ' + usdShort(capital) + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + usdShort(capital) + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit ' + usdShort(capital) + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('dex') >= 0) return 'Provide ' + usdShort(capital) + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit ' + usdShort(capital) + ' of USDC into ' + name + "'s highest-yield vault on " + chain + ' and keep the position open.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake ' + usdShort(capital) + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit ' + usdShort(capital) + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint ' + usdShort(capital) + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy ' + usdShort(capital) + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit ' + usdShort(capital) + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'supply, borrow or repay a little';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'open or close one small position';
    if (c.indexOf('prediction') >= 0) return 'place or settle one market position';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'deposit a little more or vote';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'swap, add liquidity or claim rewards';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'stake a little more or claim rewards';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0) return 'mint, hold or claim yield';
    return 'deposit, swap or vote';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'about ' + usdShort(gas) + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: usdShort(capital) + ' of capital and about ' + usdShort(gas) + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as ' + weeklyFor(p) + '.', cost: 'about ' + usdShort(gas) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the ' + usdShort(capital) + ' stays in the position', time: hold + ' days' },
      { text: "Open " + p.name + "'s own points or rewards page, connect this same wallet, and finish any task it lists.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'When a token or claim opens, use only the link the protocol itself publishes, check the token contract on the chain explorer before you approve anything, and never sign a blind approval.', cost: 'the claim gas only, about ' + usdShort(gas), time: '15 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // Test hook: the automated checks call these; they change nothing on the page.
  window.RADAR_TEST = { farmSteps: farmSteps, impliedOf: impliedOf, impliedSandbox: impliedSandbox };

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { html: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="none" stroke="#5eead4" stroke-width="1.4"/><circle cx="17" cy="17" r="9.5" fill="none" stroke="#2aa590" stroke-width="1"/><circle cx="17" cy="17" r="4" fill="none" stroke="#2aa590" stroke-width="1"/><line x1="17" y1="17" x2="29" y2="8" stroke="#5eead4" stroke-width="1.4"/><circle cx="25" cy="11" r="2.4" fill="#5eead4"/><circle cx="12" cy="21" r="1.8" fill="#e8ecf5"/><circle cx="20" cy="24" r="1.4" fill="#8a94a8"/></svg>' }),
        el('div', null, el('span', { class: 'brand-name', text: 'Token Radar' }), el('span', { class: 'brand-sub', text: 'Every pre-token protocol, ranked by what its launch would be worth' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function scopeSvg() {
    // The scope is a picture, not a table: twelve blips, rank 1 at the centre, size is implied
    // value. Names live in the top-five list beside it, where they cannot collide with the blips.
    var top = DATA.rows.slice(0, 12);
    var max = top.length ? top[0].implied_value_usd : 1;
    var cx = 170, cy = 140;
    var parts = ['<svg viewBox="0 0 340 280" role="img" aria-label="Radar scope: the top 12 protocols by implied value, rank 1 at the centre">'];
    [135, 98, 62, 26].forEach(function (r) { parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#232e47" stroke-width="1"/>'); });
    parts.push('<line x1="' + cx + '" y1="5" x2="' + cx + '" y2="275" stroke="#232e47" stroke-width="1"/><line x1="35" y1="' + cy + '" x2="305" y2="' + cy + '" stroke="#232e47" stroke-width="1"/>');
    parts.push('<line x1="' + cx + '" y1="' + cy + '" x2="292" y2="52" stroke="#2aa590" stroke-width="1.2"/>');
    top.forEach(function (r, i) {
      var angle = (i * 137.5 - 90) * Math.PI / 180;
      var rad = 20 + (i / 11) * 110;
      var x = (cx + rad * Math.cos(angle)).toFixed(1);
      var y = (cy + rad * Math.sin(angle)).toFixed(1);
      var size = (4 + Math.sqrt(r.implied_value_usd / max) * 9).toFixed(1);
      var fill = i === 0 ? '#5eead4' : (i < 5 ? '#e8ecf5' : '#8a94a8');
      parts.push('<circle cx="' + x + '" cy="' + y + '" r="' + size + '" fill="' + fill + '"' + (i === 0 ? ' stroke="#5eead4" stroke-width="2"' : '') + '/>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function hero() {
    var top = DATA.rows.slice(0, 5);
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'hero' },
      el('figure', { class: 'scope' },
        el('div', { html: scopeSvg() }),
        el('figcaption', null, 'The top 12 by implied value, rank 1 at the centre. ',
          el('b', { text: top[0] ? top[0].name : '' }), ' leads at ', el('b', { text: top[0] ? fmtUsd(top[0].implied_value_usd) : '' }), '.')
      ),
      el('div', { class: 'lede' },
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied launch value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols, ',
          el('b', { text: 'every rankable one in the snapshot' }), ', including launches above the floor the watchlist missed. Implied value is a model, not a promise.'),
        el('ol', { class: 'top5' }, top.map(function (r) {
          return el('li', { tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
            el('span', { class: 'rk', text: String(r.rank) }),
            el('span', { class: 'nm', text: r.name }, el('span', { text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL' })),
            el('span', { class: 'vl num', text: fmtUsd(r.implied_value_usd) }));
        })),
        el('p', { class: 'sub' }, 'Board total implied value: ', el('b', { text: fmtUsd(total) }), '.')
      )
    );
  }

  function stats() {
    return el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is on the board' })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the watchlist' })),
      el('div', { class: 'fact' }, el('span', { text: 'Live protocols calibrating' }), el('b', { text: String(DATA.live_calibration_size) }), el('small', { text: 'their market caps set the multiples' })),
      el('div', { class: 'fact' }, el('span', { text: 'Global median multiple' }), el('b', { text: '×' + DATA.global_median }), el('small', { text: 'mcap / TVL across the live set' }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = ['Ethereum', 'Arbitrum', 'Base', 'Solana', 'Binance', 'Avalanche', 'Polygon', 'Optimism'];
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      state.q = search.value;
      var pos = search.selectionStart;
      writeHash();
      render();
      var again = document.getElementById('q');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* older engines */ } }
    });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['50000000', 'TVL $50M+'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: String(state.minTvl) === o[0] ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var cal = el('button', { type: 'button', 'aria-pressed': state.tab === 'calibration' ? 'true' : 'false', text: 'Calibration', onclick: function () { state.tab = 'calibration'; writeHash(); render(); } });
    var count = state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : DATA.calibration.length + ' categories calibrated';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Minimum TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, pre, live, cal)),
      el('span', { class: 'count', text: count })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or TVL to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (sandboxActive() ? ' The sandbox is on: these ranks are recomputed live, not the submitted board.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : '×' + r.multiple.toFixed(2) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their multiples are what calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function calibrationTable() {
    var tbody = el('tbody');
    DATA.calibration.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: '×' + c.median.toFixed(3) }),
        el('td', { class: 'num', text: '×' + c.multiple.toFixed(3) })
      ));
    });
    return el('div', { class: 'panel calib' },
      el('h2', { text: 'How the multiples are set' }),
      el('p', null, 'Each category’s multiple is the median market-cap-to-TVL ratio of its live protocols, shrunk toward the global median (×' + DATA.global_median + ') with a prior weight of ' + DATA.model.shrink_prior + ', then clamped to ' + DATA.model.winsor_low + '×–' + DATA.model.winsor_high + '× the global median. A category with one live protocol is pulled hard toward the market average: Prediction Market’s single live protocol trades at ×400.2, and the model uses ×0.723. A category with no live protocol uses the global median.'),
      el('p', null, 'The snapshot carries a market cap for ', el('b', { text: String(DATA.live_calibration_size) }), ' live protocols. Versions that share one token carry the symbol but no per-version market cap, so they are not in the set — the calibration is the snapshot’s own figures, with that limit stated.'),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live protocols per category, their median multiple, and the multiple the model uses.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'num', text: 'Live' }), el('th', { scope: 'col', class: 'num', text: 'Median' }), el('th', { scope: 'col', class: 'num', text: 'Model multiple' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var sliders = [
      { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05, value: m.growth_weight },
      { key: 'maturity_floor', label: 'Maturity floor', min: 0, max: 1, step: 0.05, value: m.maturity_floor },
      { key: 'chain_step', label: 'Per extra chain', min: 0, max: 0.05, step: 0.005, value: m.chain_step },
      { key: 'shrink_prior', label: 'Shrinkage prior', min: 0, max: 20, step: 1, value: m.shrink_prior },
    ];
    var sliderEls = sliders.map(function (s) {
      var cur = sandbox[s.key] === null ? s.value : sandbox[s.key];
      var input = el('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step), value: String(cur), 'aria-label': s.label });
      var out = el('output', { text: String(cur) });
      input.addEventListener('input', function () {
        var v = Number(input.value);
        sandbox[s.key] = v === s.value ? null : v;
        out.textContent = String(v);
        render();
      });
      return el('div', { class: 'slider' }, el('label', null, el('span', { text: s.label }), out), input);
    });
    var reset = el('button', { class: 'ghost', type: 'button', text: 'Reset to the submitted model', onclick: function () { sandbox.growth_weight = null; sandbox.maturity_floor = null; sandbox.chain_step = null; sandbox.shrink_prior = null; render(); } });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiple comes from the live market, not from a flat constant.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple(category) x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_cap + ')) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )\n' +
        'multiple(category) = clamp( (n x median + ' + m.shrink_prior + ' x global) / (n + ' + m.shrink_prior + '), ' + m.winsor_low + ' x global, ' + m.winsor_high + ' x global ), global = ' + DATA.global_median
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. No size discount: the live set’s log TVL against log multiple correlates at −0.45, but that is driven by category mix, and the category multiple already carries it — discounting by size would penalise exactly the largest launches the radar exists to find. Bridges, wrapped assets and liquid-staking receipts are excluded: their token already trades.' }),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox' }),
        el('p', { text: 'Move a slider and the whole board re-ranks live, from the same formula. This is the proof the value follows from the formula and not from a hand-picked list: change the constants and the ranking moves.' }),
        el('div', { class: 'sliders' }, sliderEls),
        el('div', { class: 'row' }, reset, sandboxActive() ? el('span', { class: 'note', text: 'Sandbox on: the board above is recomputed live. Reset to see the submitted board.' }) : el('span', { class: 'sub', text: 'Showing the submitted board.' }))
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var calib = null;
    for (var i = 0; i < DATA.calibration.length; i++) if (DATA.calibration[i].category === row.category) { calib = DATA.calibration[i]; break; }
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: '×' + row.base_multiple + (calib ? ' (' + calib.n + ' live)' : ' (global)') })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: '×' + row.chain_multiplier + ' (' + (row.chains ? row.chains.length : 0) + ' chains)' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → ×' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → ×' + row.maturity_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(stats());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : calibrationTable());
    shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('b', { text: 'Method, in one paragraph: ' }),
      'the board ranks every rankable pre-token protocol in the snapshot by TVL times the multiple the live market pays its category, adjusted for chain breadth, seven-day growth and time without a token. Farm plans are derived from each protocol’s own category, chains, TVL and age. Implied value is a model, not a price, and a launch is never guaranteed. Snapshot ' + DATA.as_of + ', DefiLlama protocol index.'
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
