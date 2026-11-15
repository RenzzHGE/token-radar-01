// Token Radar — dashboard.
//
// A static page: it reads window.RADAR (written by main.ts) and renders
// the board, the live view, the calibration table, the detail dialog and
// the model sandbox. The page recomputes every implied value from the
// same model that built board.json, so the detail view can show that its
// number is the same number board.json carries.

(function () {
  "use strict";

  const D = window.RADAR;
  if (!D) return;

  const $ = (id) => document.getElementById(id);
  const rows = D.rows;
  const live = D.live;
  const calibration = D.calibration;
  const params = D.model;

  // ---- formatting -------------------------------------------------------

  function money(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + Math.round(v);
  }

  function ageText(ageDays) {
    const age = ageDays === null || ageDays === undefined ? 365 : ageDays;
    if (age >= 365) return (age / 365).toFixed(1) + "y";
    return age + "d";
  }

  function pctText(change) {
    if (change === null || change === undefined) return "—";
    return (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- model (same function as the build) -------------------------------

  function round4(x) {
    return Math.round(x * 10000) / 10000;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function baseMultiple(category) {
    const entry = calibration.find((c) => c.category === category);
    if (!entry) return round4(D.global_median);
    const shrunk =
      (entry.n * entry.median + params.shrink_prior * D.global_median) / (entry.n + params.shrink_prior);
    return round4(clamp(shrunk, params.winsor_low * D.global_median, params.winsor_high * D.global_median));
  }

  function chainMultiplier(chains) {
    return round4(1 + params.chain_step * Math.min(Math.max(chains.length - 1, 0), params.chain_cap));
  }

  function growthMultiplier(change) {
    const pct = change === null || change === undefined ? 0 : change;
    const bounded = clamp(pct, params.growth_floor, params.growth_cap);
    return round4(1 + (params.growth_weight * bounded) / 100);
  }

  function maturityMultiplier(ageDays) {
    const age = ageDays === null || ageDays === undefined ? params.unknown_age_days : ageDays;
    const days = Math.min(age, params.maturity_days);
    return round4(params.maturity_floor + (params.maturity_range * days) / params.maturity_days);
  }

  // Recompute a row's implied value from its stored inputs. With the
  // shipped constants this returns exactly the number board.json carries.
  function recompute(row, over) {
    const p = over || params;
    const entry = calibration.find((c) => c.category === row.category);
    let base;
    if (!entry) {
      base = round4(D.global_median);
    } else {
      const shrunk = (entry.n * entry.median + p.shrink_prior * D.global_median) / (entry.n + p.shrink_prior);
      base = round4(clamp(shrunk, p.winsor_low * D.global_median, p.winsor_high * D.global_median));
    }
    const chain = round4(1 + p.chain_step * Math.min(Math.max(row.chains.length - 1, 0), p.chain_cap));
    const pct = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = round4(1 + (p.growth_weight * clamp(pct, p.growth_floor, p.growth_cap)) / 100);
    const age = row.age_days === null || row.age_days === undefined ? p.unknown_age_days : row.age_days;
    const maturity = round4(p.maturity_floor + (p.maturity_range * Math.min(age, p.maturity_days)) / p.maturity_days);
    return {
      base,
      chain,
      growth,
      maturity,
      implied: Math.round(row.tvl_usd * base * chain * growth * maturity),
    };
  }

  // ---- farm plans (same generator as the build) -------------------------

  const GAS = {
    Ethereum: 8,
    Base: 0.5,
    Polygon: 0.5,
    Avalanche: 0.5,
    Solana: 0.05,
    Sui: 0.05,
    Aptos: 0.05,
    Binance: 0.3,
    Arbitrum: 1,
    Tron: 1,
  };

  function gasFor(chain) {
    return GAS[chain] !== undefined ? GAS[chain] : 2;
  }

  function gasText(chain) {
    const g = gasFor(chain);
    return Number.isInteger(g) ? "$" + g : "$" + g;
  }

  function farmStake(tvl) {
    if (tvl >= 1000000000) return 150;
    if (tvl >= 100000000) return 100;
    return 50;
  }

  function holdDays(ageDays) {
    if (ageDays === null || ageDays === undefined || ageDays >= 365) return 30;
    if (ageDays >= 180) return 45;
    return 60;
  }

  function farmVoice(category) {
    switch (category) {
      case "Risk Curators":
      case "Onchain Capital Allocator":
        return { action: "vault", weekly: "add a little more or vote" };
      case "Lending":
      case "CDP":
      case "CDP Manager":
      case "Collateral Markets":
      case "Uncollateralized Lending":
        return { action: "lend", weekly: "supply, borrow or repay a little" };
      case "Dexs":
      case "Indexes":
        return { action: "liquidity", weekly: "swap, add liquidity or claim rewards" };
      case "Yield":
      case "Yield Aggregator":
      case "Leveraged Farming":
        return { action: "top-vault", weekly: "swap, add liquidity or claim rewards" };
      case "RWA":
        return { action: "mint-yield", weekly: "mint, hold or claim yield" };
      case "Derivatives":
      case "Interest Rate Derivatives":
        return { action: "margin", weekly: "open or close one small position" };
      case "Restaking":
      case "Staking Pool":
        return { action: "stake", weekly: "stake a little more or claim rewards" };
      case "Prediction Market":
        return { action: "predict", weekly: "place or settle one market position" };
      case "Insurance":
        return { action: "cover", weekly: "deposit, swap or vote" };
      case "Stablecoin Wrapper":
      case "Dual-Token Stablecoin":
        return { action: "stable", weekly: "mint, hold or claim yield" };
      default:
        return { action: "deposit", weekly: "deposit, swap or vote" };
    }
  }

  function farmMain(row, stake) {
    const chain = row.chains[0];
    const gas = gasText(chain);
    const voice = farmVoice(row.category);
    switch (voice.action) {
      case "vault":
        return (
          "Put $" + stake + " into a " + row.name + " vault on " + chain + " and hold the shares. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "lend":
        return (
          "Lend $" + stake + " of USDC to " + row.name + " on " + chain + " and leave the position open. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "liquidity":
        return (
          "Add $" + stake + " of liquidity to " + row.name + "'s main pool on " + chain + " and leave the position open. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "top-vault":
        return (
          "Put $" + stake + " of USDC into " + row.name + "'s best-yielding vault on " + chain + " and leave the position open. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "mint-yield":
        return (
          "Mint $" + stake + " of the protocol's yield-bearing asset on " + chain + " and hold it. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "margin":
        return (
          "Post $" + stake + " of USDC as margin on " + row.name + " and open one small hedged position. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "stake":
        return (
          "Stake $" + stake + " of the chain's staking asset through " + row.name + " and keep the receipt. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "predict":
        return (
          "Fund $" + stake + " and open one market position on " + row.name + ". " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "cover":
        return (
          "Buy $" + stake + " of cover from " + row.name + " on " + chain + " and keep the policy. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      case "stable":
        return (
          "Mint or deposit $" + stake + " of the stable asset through " + row.name + " on " + chain + ". " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
      default:
        return (
          "Deposit $" + stake + " of USDC into " + row.name + " on " + chain + " and keep the position open. " +
          "Cost: $" + stake + " of capital and about " + gas + " of gas on " + chain + ". Time: 15 minutes to set up."
        );
    }
  }

  function farmSteps(row) {
    const chain = row.chains[0];
    const gas = gasText(chain);
    const stake = farmStake(row.tvl_usd);
    const voice = farmVoice(row.category);
    const hold = holdDays(row.age_days);
    return [
      "Set up a fresh wallet just for this farm, fund it only with the amount you plan to use, and keep its recovery phrase offline. Cost: about " + gas + " of gas for the first transaction. Time: 5 minutes.",
      farmMain(row, stake),
      "Do one qualifying action each week — " + voice.weekly + ". Cost: about " + gas + " of gas a week. Time: 10 minutes a week.",
      "Keep the position open for at least " + hold + " days so it shows up in more than one snapshot. Cost: the $" + stake + " stays in the position. Time: " + hold + " days.",
      "Visit " + row.name + "'s own points or rewards page, connect the same wallet, and finish every task it lists. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
      "If a token or claim opens, follow only the link the protocol itself publishes, verify the token contract in the chain explorer before approving anything, and never sign a blind approval. Cost: the claim gas only, about " + gas + ". Time: 15 minutes.",
      "Record the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it later. Cost: nothing but the log. Time: 5 minutes.",
    ];
  }

  // ---- header, hero, facts ----------------------------------------------

  function renderMeta() {
    $("top-meta").innerHTML =
      "<span>Snapshot <b>" + esc(D.as_of) + "</b></span>" +
      "<span>Source <b>" + esc(D.source.split(" ")[0]) + "</b></span>" +
      "<span>Model <b>" + esc(D.model_version) + "</b></span>";
  }

  function renderHero() {
    const top = rows.slice(0, 12);
    const max = top[0].implied_value_usd;
    const cx = 170;
    const cy = 130;
    let dots = "";
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      const angle = (i / top.length) * Math.PI * 2 - Math.PI / 2;
      const radius = i === 0 ? 0 : 28 + (Math.log(r.implied_value_usd) / Math.log(max)) * 78;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const size = 4 + 7 * (r.implied_value_usd / max);
      dots +=
        '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + size.toFixed(1) +
        '" fill="' + (i === 0 ? "#5eead4" : "#8a94a8") + '" opacity="' + (i === 0 ? "1" : "0.75") + '">' +
        "<title>" + esc(r.name) + " — " + money(r.implied_value_usd) + "</title></circle>";
    }
    const rings = [34, 68, 102]
      .map((r) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#232e47" stroke-width="1"/>')
      .join("");
    $("hero").innerHTML =
      '<figure class="scope"><svg viewBox="0 0 340 260" role="img" aria-label="Radar scope of the top 12 protocols by implied value">' +
      rings + dots + "</svg>" +
      "<figcaption>The top 12 by implied value, the strongest at the centre. <b>" +
      esc(top[0].name) + "</b> leads at <b>" + money(top[0].implied_value_usd) + "</b>.</figcaption></figure>" +
      '<div class="lede"><h1>The next launches, priced by the market that is already live</h1>' +
      "<p>Every pre-token protocol in the snapshot, ranked by what its token launch would be worth: " +
      "TVL times the multiple the live market pays its category. The strongest first.</p>" +
      '<ol class="top-five">' +
      rows
        .slice(0, 5)
        .map(
          (r) =>
            '<li><span class="rank num">' + r.rank + '</span><span class="name">' + esc(r.name) +
            '</span><span class="val num">' + money(r.implied_value_usd) + "</span></li>",
        )
        .join("") +
      "</ol></div>";
  }

  function renderFacts() {
    const onBoard = D.watchlist_size;
    $("facts").innerHTML =
      '<div class="fact"><div class="label">Watchlist covered</div><div class="big num">' + onBoard + " / " + D.watchlist_size +
      '</div><div class="note">every watchlist slug is on the board</div></div>' +
      '<div class="fact"><div class="label">Global median multiple</div><div class="big num">' + D.global_median.toFixed(3) +
      '</div><div class="note">mcap / TVL across the live set</div></div>' +
      '<div class="fact"><div class="label">Pre-token board</div><div class="big num">' + D.board_size +
      '</div><div class="note">' + D.early_size + " beyond the watchlist</div></div>" +
      '<div class="fact"><div class="label">Live protocols calibrating</div><div class="big num">' + D.live_calibration_size +
      '</div><div class="note">their multiples set the price</div></div>';
  }

  // ---- board ------------------------------------------------------------

  let sortKey = "implied";
  let sortDir = -1;
  let sandbox = null;

  function chainLabel(chains) {
    if (chains.length <= 2) return chains.join(", ");
    return chains.slice(0, 2).join(", ") + " +" + (chains.length - 2);
  }

  function currentRows() {
    let list = rows.slice();
    if (sandbox) {
      list = list.map((r) => {
        const c = recompute(r, sandbox);
        return Object.assign({}, r, { implied_value_usd: c.implied });
      });
      list.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
      list.forEach((r, i) => {
        r.rank = i + 1;
      });
    }
    const q = $("q").value.trim().toLowerCase();
    const cat = $("cat").value;
    const chain = $("chain").value;
    const minTvl = Number($("min-tvl").value);
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.chains.some((c) => c.toLowerCase().includes(q)),
      );
    }
    if (cat) list = list.filter((r) => r.category === cat);
    if (chain) list = list.filter((r) => r.chains.includes(chain));
    if (minTvl) list = list.filter((r) => r.tvl_usd >= minTvl);
    const key = sortKey;
    list.sort((a, b) => {
      const av = key === "chg" ? a.change_7d ?? 0 : key === "age" ? a.age_days ?? 365 : a[key === "implied" ? "implied_value_usd" : key === "tvl" ? "tvl_usd" : "rank"];
      const bv = key === "chg" ? b.change_7d ?? 0 : key === "age" ? b.age_days ?? 365 : b[key === "implied" ? "implied_value_usd" : key === "tvl" ? "tvl_usd" : "rank"];
      return (av - bv) * sortDir;
    });
    return list;
  }

  function renderBoard() {
    const list = currentRows();
    const max = Math.max.apply(
      null,
      list.map((r) => r.implied_value_usd).concat([1]),
    );
    $("board-body").innerHTML = list
      .map((r) => {
        const chg = r.change_7d;
        const chgCls = chg === null || chg === undefined ? "" : chg >= 0 ? "up" : "down";
        const width = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
        return (
          '<tr data-slug="' + esc(r.slug) + '">' +
          '<td class="num">' + r.rank + "</td>" +
          '<td><span class="name">' + esc(r.name) + '</span><br><span class="sub">' +
          esc(r.category) + " on " + esc(chainLabel(r.chains)) + "</span></td>" +
          '<td class="num">' + money(r.tvl_usd) + "</td>" +
          '<td class="num ' + chgCls + '">' + pctText(chg) + "</td>" +
          '<td class="num">' + ageText(r.age_days) + "</td>" +
          '<td class="num"><span class="up">' + money(r.implied_value_usd) + '</span><span class="bar"><i style="width:' + width + '%"></i></span></td>' +
          '<td><span class="pill">no token</span></td></tr>'
        );
      })
      .join("");
    $("count").textContent = list.length + " rows shown";
    $("hint").textContent = sandbox
      ? "Sandbox on: the board is re-ranked under your constants. Select a row for its model and farm plan."
      : "Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.";
    document.querySelectorAll("#board thead th[data-sort]").forEach((th) => {
      th.textContent = th.textContent.replace(/ [▾▴]$/, "");
      if (th.getAttribute("data-sort") === sortKey) {
        th.textContent += sortDir === -1 ? " ▾" : " ▴";
      }
    });
  }

  function renderAlt(kind) {
    const alt = $("alt-view");
    const board = $("board");
    if (kind === "board") {
      alt.hidden = true;
      board.hidden = false;
      return;
    }
    board.hidden = true;
    alt.hidden = false;
    alt.className = "alt";
    if (kind === "live") {
      alt.innerHTML =
        "<p class=\"hint\">Live-token protocols, largest market cap first. Their multiples are what calibrate the model.</p>" +
        "<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class=\"num\">TVL</th><th class=\"num\">Market cap</th><th class=\"num\">Multiple</th></tr></thead><tbody>" +
        live
          .map(
            (r, i) =>
              "<tr><td class=\"num\">" + (i + 1) + '</td><td><span class="name">' + esc(r.name) +
              '</span><br><span class="sub">' + esc(r.category) + " on " + esc(chainLabel(r.chains)) + "</span></td>" +
              "<td>" + esc(r.category) + '</td><td class="num">' + money(r.tvl_usd) +
              '</td><td class="num">' + money(r.mcap_usd) + '</td><td class="num">×' + r.multiple.toFixed(4) + "</td></tr>",
          )
          .join("") +
        "</tbody></table>";
      $("count").textContent = live.length + " rows shown";
    } else {
      alt.innerHTML =
        "<p class=\"hint\">One row per category with a live protocol: how many set the price, their median multiple, and the shrunk multiple the model uses.</p>" +
        "<table><thead><tr><th>Category</th><th class=\"num\">Live</th><th class=\"num\">Median</th><th class=\"num\">Multiple</th></tr></thead><tbody>" +
        calibration
          .map(
            (c) =>
              "<tr><td>" + esc(c.category) + '</td><td class="num">' + c.n +
              '</td><td class="num">×' + c.median.toFixed(4) + '</td><td class="num">×' + c.multiple.toFixed(4) + "</td></tr>",
          )
          .join("") +
        "</tbody></table>";
      $("count").textContent = calibration.length + " rows shown";
    }
  }

  // ---- detail dialog ------------------------------------------------------

  function splitStep(step) {
    const at = step.indexOf(" Cost: ");
    if (at < 0) return { main: step, cost: "" };
    return { main: step.slice(0, at + 1), cost: step.slice(at + 1) };
  }

  function openDetail(slug) {
    const row = rows.find((r) => r.slug === slug);
    if (!row) return;
    const c = recompute(row, sandbox);
    const entry = calibration.find((x) => x.category === row.category);
    const steps = farmSteps(row);
    const dlg = $("detail");
    dlg.innerHTML =
      '<div class="card"><button class="close" type="button">Close</button>' +
      '<div class="rankline">Rank ' + row.rank + " of " + rows.length + "</div>" +
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="chains">' + esc(row.category) + " on " + esc(row.chains.join(", ")) + "</p>" +
      "<h3>Implied value</h3>" +
      '<dl class="eq">' +
      "<dt>TVL</dt><dd class=\"num\">" + money(row.tvl_usd) + "</dd>" +
      "<dt>Category multiple</dt><dd class=\"num\">×" + c.base.toFixed(4) + " (" + (entry ? entry.n : 0) + " live)</dd>" +
      "<dt>Chain multiplier</dt><dd class=\"num\">×" + c.chain.toFixed(2) + " (" + row.chains.length + " chains)</dd>" +
      "<dt>Seven-day growth</dt><dd class=\"num\">" + pctText(row.change_7d) + " → ×" + c.growth.toFixed(4) + "</dd>" +
      "<dt>Age with no token</dt><dd class=\"num\">" + ageText(row.age_days) + " → ×" + c.maturity.toFixed(4) + "</dd>" +
      '<dt class="total">Implied value</dt><dd class="total num">' + money(c.implied) + "</dd>" +
      "</dl>" +
      "<p class=\"fine\">Model radar-2: the same function scores every protocol. The page recomputes this row as " +
      money(c.implied) + ", the same number board.json carries. This is an estimate, not a price.</p>" +
      "<h3>Farm plan</h3><ol class=\"plan\">" +
      steps
        .map((s) => {
          const parts = splitStep(s);
          return "<li><div>" + esc(parts.main) + '</div><div class="cost">' + esc(parts.cost) + "</div></li>";
        })
        .join("") +
      "</ol></div>";
    dlg.hidden = false;
    dlg.querySelector(".close").addEventListener("click", closeDetail);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeDetail();
    });
  }

  function closeDetail() {
    $("detail").hidden = true;
    $("detail").innerHTML = "";
  }

  // ---- sandbox ------------------------------------------------------------

  const SANDBOX_FIELDS = [
    { key: "growth_weight", label: "Growth weight", min: 0, max: 1, step: 0.05 },
    { key: "maturity_floor", label: "Maturity floor", min: 0.3, max: 0.8, step: 0.05 },
    { key: "maturity_range", label: "Maturity range", min: 0.1, max: 0.6, step: 0.05 },
    { key: "shrink_prior", label: "Shrink prior", min: 0, max: 10, step: 1 },
    { key: "chain_step", label: "Chain step", min: 0, max: 0.05, step: 0.005 },
  ];

  function renderSandbox() {
    $("sandbox-grid").innerHTML = SANDBOX_FIELDS.map(
      (f) =>
        '<label>' + f.label +
        '<input type="range" data-key="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step +
        '" value="' + params[f.key] + '">' +
        '<output data-out="' + f.key + '">' + params[f.key] + "</output></label>",
    ).join("");
    document.querySelectorAll("#sandbox-grid input").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-key");
        document.querySelector('[data-out="' + key + '"]').textContent = input.value;
        const next = Object.assign({}, params);
        SANDBOX_FIELDS.forEach((f) => {
          next[f.key] = Number(document.querySelector('[data-key="' + f.key + '"]').value);
        });
        sandbox = SANDBOX_FIELDS.some((f) => next[f.key] !== params[f.key]) ? next : null;
        $("sandbox-state").textContent = sandbox ? "· Sandbox on" : "";
        renderBoard();
      });
    });
    $("sandbox-reset").addEventListener("click", () => {
      SANDBOX_FIELDS.forEach((f) => {
        const input = document.querySelector('[data-key="' + f.key + '"]');
        input.value = params[f.key];
        document.querySelector('[data-out="' + f.key + '"]').textContent = params[f.key];
      });
      sandbox = null;
      $("sandbox-state").textContent = "";
      renderBoard();
    });
  }

  // ---- wire up ------------------------------------------------------------

  function init() {
    renderMeta();
    renderHero();
    renderFacts();

    const cats = [...new Set(rows.map((r) => r.category))].sort();
    cats.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      $("cat").appendChild(o);
    });
    const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
    chains.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      $("chain").appendChild(o);
    });

    ["q", "cat", "chain", "min-tvl"].forEach((id) => {
      $(id).addEventListener("input", () => {
        renderBoard();
      });
    });
    document.querySelectorAll("#board thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        if (sortKey === key) {
          sortDir = -sortDir;
        } else {
          sortKey = key;
          sortDir = key === "rank" || key === "implied" ? -1 : 1;
        }
        renderBoard();
      });
    });
    $("board-body").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-slug]");
      if (tr) openDetail(tr.getAttribute("data-slug"));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetail();
    });

    const tabs = { board: $("view-board"), live: $("view-live"), cal: $("view-cal") };
    Object.keys(tabs).forEach((kind) => {
      tabs[kind].addEventListener("click", () => {
        Object.keys(tabs).forEach((k) => tabs[k].setAttribute("aria-selected", k === kind ? "true" : "false"));
        renderAlt(kind);
        if (kind === "board") renderBoard();
      });
    });

    renderSandbox();
    renderBoard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
