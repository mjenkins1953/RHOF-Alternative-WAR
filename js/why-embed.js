// Who's Better — head-to-head decomposition of the SAA gap between two players.
// Works for hitters OR pitchers: window.WHY_DATA.<side> = { config, players, cards }
// (built by build_yourhall_js.py). Each side is scored at its DEFAULT weights, so
// the numbers match the published Hitters / Pitchers lists exactly.
//   hitters  — 5 z's, decline damping 0.40, career total blended 50/50 with best-7 peak
//   pitchers — 5 z's, no damping, no peak: SAA is the career total only
(function () {
  const DATA = window.WHY_DATA;
  if (!DATA || !DATA.hitters || !DATA.pitchers) return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sign = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
  // Round `parts` to `digits` decimals so they sum EXACTLY to `target` rounded
  // the same way -- largest-remainder apportionment. `parts` mathematically
  // already sum to `target` before rounding (e.g. total-half + peak-half =
  // the full gap), but rounding each part independently can make the printed
  // numbers fail to add up to the printed total (0.45 + 0.00 next to a
  // 0.46 gap). This fixes the display without changing any underlying math.
  const splitRound = (target, parts, digits = 2) => {
    const scale = 10 ** digits;
    const want = Math.round(target * scale);
    const raw = parts.map((v) => v * scale);
    const rounded = raw.map((v) => Math.round(v));
    let diff = want - rounded.reduce((a, b) => a + b, 0);
    if (diff !== 0) {
      const order = raw.map((v, i) => ({ i, err: v - rounded[i] }))
        .sort((a, b) => (diff > 0 ? b.err - a.err : a.err - b.err));
      for (let k = 0; k < Math.abs(diff); k++) {
        rounded[order[k % order.length].i] += diff > 0 ? 1 : -1;
      }
    }
    return rounded.map((v) => v / scale);
  };
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (name, attrs, parent) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // per-mode copy
  const LONG = {
    hitters: { AVG: 'batting average', ISO: 'power', BB: 'walk rate',
               SB: 'base-stealing', DEF: 'defense' },
    pitchers: { ERA: 'ERA', WHIP: 'WHIP', 'K/9': 'strikeout rate',
                'WIN%': 'win percentage', SV: 'saves' },
  };
  const INTRO = {
    hitters: 'Stat Above Average is one number built from five things — batting average, '
      + 'power, walk rate, base-stealing, and defense — scaled to a full season, dampened for '
      + "years past a player's prime, and blended half career total, half best-seven peak. That "
      + "means any two players' ranking gap can be taken apart and handed back to you: this much "
      + "is defense, this much is the extra seasons, this much is one player's bat. Pick two.",
    pitchers: 'Stat Above Average is one number built from five things — ERA, WHIP, strikeout '
      + 'rate, win percentage, and saves — each measured against the league that season, scaled '
      + 'by innings pitched, and summed across the whole career (no peak weighting for pitchers). '
      + "That means any two pitchers' ranking gap can be taken apart and handed back to you: this "
      + 'much is run prevention, this much is the strikeouts, this much is the extra innings. Pick two.',
  };
  const LEDE = {
    hitters: 'Two hitters, side by side. See which one Stat Above Average ranks higher — and exactly where the gap comes from.',
    pitchers: 'Two pitchers, side by side. See which one Stat Above Average ranks higher — and exactly where the gap comes from.',
  };
  const FOOT = {
    hitters: 'Scored at the default SAA weights — AVG 30% · ISO 30% · Defense 20% · Walks 10% · '
      + "Steals 10%, the bar 60% toward the player's position, career total blended 50/50 with the "
      + 'best seven seasons. <a href="yourhall.html">Your Hall</a> re-scores the same data under weights you choose.',
    pitchers: 'Scored at the default pitcher SAA weights — ERA 25% · WHIP 25% · K/9 20% · Win% 20% · '
      + 'Saves 10%, each season measured against the league and scaled by innings, then summed across '
      + 'the career. <a href="yourhall-pitchers.html">Your Hall</a> re-scores the same data under weights you choose.',
  };
  const DEFAULTS = { hitters: ['jeterde01', 'trammal01'], pitchers: ['maddugr01', 'glavito02'] };

  // ---- mode-scoped state (rebuilt by buildMode) ----
  let MODE = 'hitters';
  let CFG, BY_ID, RANK, NAMES, NAME_TO_ID, CARDS;

  // ---- decomposition: one player -> per-category total / peak / final ----
  function decompose(p) {
    const W = CFG.defaultWeights;
    const NORM = CFG.workloadNorm;
    const DECLINE = CFG.declineWeight == null ? 1 : CFG.declineWeight;
    const HAS_PEAK = !!CFG.hasPeak;
    const PEAK_N = CFG.defaultPeakN || 7;
    const BLEND = CFG.defaultBlend == null ? 0.5 : CFG.defaultBlend;

    const contrib = [];        // per season: [c0..c4] contribution to season_saa
    const seasonSaa = [];
    for (const row of p.s) {
      let den = 0;
      for (let k = 0; k < 5; k++) if (row[k] !== null) den += W[k];
      if (den <= 0) continue;
      const c = [0, 0, 0, 0, 0];
      const scale = (row[5] / NORM) / den;
      for (let k = 0; k < 5; k++) if (row[k] !== null) c[k] = W[k] * row[k] * scale;
      contrib.push(c);
      seasonSaa.push(c.reduce((a, b) => a + b, 0));
    }
    const totalCat = [0, 0, 0, 0, 0], peakCat = [0, 0, 0, 0, 0];
    contrib.forEach((c, i) => {
      const f = seasonSaa[i] < 0 ? DECLINE : 1;
      for (let k = 0; k < 5; k++) totalCat[k] += c[k] * f;
    });
    let peakSet = new Set();
    if (HAS_PEAK) {
      const order = seasonSaa.map((v, i) => i).sort((a, b) => seasonSaa[b] - seasonSaa[a]);
      for (let i = 0; i < PEAK_N && i < order.length; i++)
        for (let k = 0; k < 5; k++) peakCat[k] += contrib[order[i]][k];
      peakSet = new Set(order.slice(0, PEAK_N));
    }
    const finalCat = HAS_PEAK
      ? totalCat.map((t, k) => (1 - BLEND) * t + BLEND * peakCat[k])
      : totalCat.slice();
    const SAA_total = totalCat.reduce((a, b) => a + b, 0);
    const SAA_peak = peakCat.reduce((a, b) => a + b, 0);
    return {
      id: p.id, name: p.n, hof: p.hof, seasons: p.s.length,
      hasPeak: HAS_PEAK, totalCat, peakCat, finalCat, SAA_total, SAA_peak,
      SAA_final: HAS_PEAK ? SAA_total * (1 - BLEND) + SAA_peak * BLEND : SAA_total,
      seasonSaa, peakSet,
    };
  }

  // ---- (re)build one mode: score the pool, rank it, fill the datalist ----
  const inA = $('whyA'), inB = $('whyB');
  const badgeA = $('saaA'), badgeB = $('saaB');

  function buildMode(mode) {
    MODE = mode;
    const bundle = DATA[mode];
    CFG = bundle.config;
    CARDS = bundle.cards || {};

    BY_ID = new Map();
    NAMES = [];
    const ranked = bundle.players.map((p) => {
      const d = decompose(p);
      BY_ID.set(p.id, { p, d });
      NAMES.push({ id: p.id, n: p.n });
      return d;
    }).sort((a, b) => b.SAA_final - a.SAA_final);
    ranked.forEach((d, i) => { d.rank = i + 1; });
    RANK = new Map(ranked.map((d) => [d.id, d.rank]));
    NAMES.sort((a, b) => a.n.localeCompare(b.n));
    NAME_TO_ID = new Map(NAMES.map(({ id, n }) => [n.toLowerCase(), id]));

    const dl = $('whyPlayers');
    dl.textContent = '';
    NAMES.forEach(({ n }) => { const o = document.createElement('option'); o.value = n; dl.appendChild(o); });

    const introEl = $('whyIntro'); if (introEl) introEl.textContent = INTRO[mode];
    const ledeEl = $('whyLede'); if (ledeEl) ledeEl.textContent = LEDE[mode];
    const ph = mode === 'pitchers' ? 'Start typing a pitcher…' : 'Start typing a hitter…';
    inA.placeholder = ph; inB.placeholder = ph;

    document.querySelectorAll('.why-mode__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    });
  }

  function currentIds() {
    return [NAME_TO_ID.get(inA.value.trim().toLowerCase()),
            NAME_TO_ID.get(inB.value.trim().toLowerCase())];
  }

  // the SAA value + rank shown beside each picker, live as you type
  function updateBadge(input, badge) {
    const id = NAME_TO_ID.get(input.value.trim().toLowerCase());
    if (!id || !BY_ID.has(id)) { badge.hidden = true; return; }
    const d = BY_ID.get(id).d;
    badge.innerHTML = `<b>${d.SAA_final.toFixed(2)}</b><small>SAA &middot; #${RANK.get(id)}</small>`;
    badge.hidden = false;
  }
  function updateBadges() { updateBadge(inA, badgeA); updateBadge(inB, badgeB); }

  // ---- career-stat row inside the picker box ----
  const PICK = $('whyPickStats');
  const rate = (x) => (x == null ? '—' : x.toFixed(3).replace(/^0(?=\.)/, ''));
  const cnt = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));

  function statBlock(id) {
    const nm = BY_ID.has(id) ? BY_ID.get(id).p.n : '';
    const c = CARDS[id] || null;
    if (!c) {
      return `<div class="why-stat"><span class="why-stat__meta">${esc(nm)}</span>`
        + '<span class="why-stat__line">career line unavailable</span></div>';
    }
    let l1, l2, meta;
    if (MODE === 'pitchers') {
      meta = [nm, c.role, c.yrs].filter(Boolean).join(' · ');
      l1 = `<b>${cnt(c.w)}</b>–<b>${cnt(c.l)}</b>`
        + ` &middot; <b>${c.era == null ? '—' : c.era.toFixed(2)}</b> ERA`
        + ` &middot; <b>${c.whip == null ? '—' : c.whip.toFixed(2)}</b> WHIP`
        + ` &middot; <b>${c.eraPlus == null ? '—' : c.eraPlus}</b> ERA+`;
      l2 = `<b>${cnt(c.so)}</b> K &middot; <b>${cnt(c.sv)}</b> SV`
        + ` &middot; <b>${cnt(c.ip)}</b> IP`
        + ` &middot; <b>${c.war == null ? '—' : c.war.toFixed(1)}</b> bWAR`;
    } else {
      meta = [nm, c.pos, c.yrs].filter(Boolean).join(' · ');
      l1 = `<b>${rate(c.avg)}</b>/<b>${rate(c.obp)}</b>/<b>${rate(c.slg)}</b>`
        + ` &middot; <b>${c.opsPlus == null ? '—' : c.opsPlus}</b> OPS+`;
      l2 = `<b>${cnt(c.h)}</b> H &middot; <b>${cnt(c.hr)}</b> HR`
        + ` &middot; <b>${cnt(c.sb)}</b> SB &middot; <b>${cnt(c.bb)}</b> BB`
        + ` &middot; <b>${c.war == null ? '—' : c.war.toFixed(1)}</b> bWAR`;
    }
    return `<div class="why-stat"><span class="why-stat__meta">${esc(meta)}</span>`
      + `<span class="why-stat__line">${l1}<br>${l2}</span></div>`;
  }
  function fillPickStats(ia, ib) {
    if (!PICK) return;
    if (!(BY_ID.has(ia) && BY_ID.has(ib))) { PICK.hidden = true; PICK.innerHTML = ''; return; }
    PICK.innerHTML = statBlock(ia) + statBlock(ib);
    PICK.hidden = false;
  }

  function persist(ia, ib) {
    try {
      const u = new URL(location);
      u.searchParams.set('mode', MODE);
      u.searchParams.set('a', ia); u.searchParams.set('b', ib);
      history.replaceState(null, '', u);
    } catch (e) { /* ignore */ }
    try {
      if (window.THOF) { THOF.set('why', { mode: MODE, a: ia, b: ib }); }
    } catch (e) { /* ignore */ }
  }

  function run() {
    const [ia, ib] = currentIds();
    const out = $('whyOut');
    updateBadges();
    fillPickStats(ia, ib);
    if (!ia || !ib) { out.hidden = true; return; }
    if (ia === ib) {
      out.hidden = false;
      out.innerHTML = '<p class="why-note">Pick two different players.</p>';
      return;
    }
    persist(ia, ib);
    render(ia, ib, out);
  }

  function render(ia, ib, out) {
    const A = BY_ID.get(ia).d, B = BY_ID.get(ib).d;
    const hi = A.SAA_final >= B.SAA_final ? A : B;
    const lo = hi === A ? B : A;
    const rHi = RANK.get(hi.id), rLo = RANK.get(lo.id);
    const gap = hi.SAA_final - lo.SAA_final;
    const spots = rLo - rHi;
    const hasPeak = hi.hasPeak;
    const dTotal = hasPeak ? (hi.SAA_total - lo.SAA_total) / 2 : hi.SAA_total - lo.SAA_total;
    const dPeak = hasPeak ? (hi.SAA_peak - lo.SAA_peak) / 2 : 0;
    const noun = MODE === 'pitchers' ? 'seasons' : 'seasons';
    const played = MODE === 'pitchers' ? 'threw' : 'played';

    const CATS = CFG.catLabels;
    const rows = CATS.map((c, k) => ({
      cat: c, d: hi.finalCat[k] - lo.finalCat[k], hi: hi.finalCat[k], lo: lo.finalCat[k],
    }));
    // the 5 category deltas sum to `gap` exactly pre-rounding (finalCat sums
    // to SAA_final for each player); reconcile their rounded display values
    // the same way the total/peak split is, so the bars' printed numbers
    // always add up to the gap the caption says they're a share of.
    splitRound(gap, rows.map((r) => r.d)).forEach((v, k) => { rows[k].dDisp = v; });
    const maxAbs = Math.max(0.001, ...rows.map((r) => Math.abs(r.d)));
    const ord = rows.slice().sort((a, b) => b.d - a.d);

    // dTotal + dPeak already equal gap exactly in the underlying math (each
    // is half the total/peak difference by construction); reconcile the
    // ROUNDED display values the same way so "0.45 + 0.00" next to a "0.46"
    // gap can't happen.
    const [dTotalDisp, dPeakDisp] = hasPeak ? splitRound(gap, [dTotal, dPeak]) : [dTotal, dPeak];
    const splitBlock = hasPeak ? `
      <div class="why-split">
        <span>of the <b>${gap.toFixed(2)}</b>-SAA gap:</span>
        <span class="why-split__part">career total <b>${sign(dTotalDisp)}</b></span>
        <span class="why-split__part">peak <b>${sign(dPeakDisp)}</b></span>
      </div>` : `
      <div class="why-split">
        <span>the gap is <b>${gap.toFixed(2)}</b> SAA — pitcher SAA is career total only, no peak weighting.</span>
      </div>`;

    const sparkCap = hasPeak
      ? "Each player's SAA in every qualifying season — the shape of the career. "
        + 'Filled marks are the seven that make the peak half of the formula.'
      : "Each pitcher's SAA in every qualifying season (40+ IP) — the shape of the career.";

    out.hidden = false;
    out.innerHTML = `
      <p class="why-verdict">
        <b>${esc(hi.name)}</b> ranks <b>${spots}</b> spot${spots === 1 ? '' : 's'} higher than
        ${esc(lo.name)} <span class="why-verdict__saa">(${hi.SAA_final.toFixed(2)} vs ${lo.SAA_final.toFixed(2)} SAA)</span>
      </p>
      <p class="why-sentence">${sentence(hi, lo, ord, dTotal, dPeak, gap, spots, hasPeak, played)}</p>

      ${splitBlock}

      <h3 class="why-h3">Where the gap comes from</h3>
      <p class="why-cap">Each bar is that category's share of the ${gap.toFixed(2)}-SAA gap.
        <span class="why-key"><i class="sw sw--hi"></i>${esc(hi.name)}</span>
        <span class="why-key"><i class="sw sw--lo"></i>${esc(lo.name)}</span></p>
      <div id="whyBars" class="why-bars"></div>

      <h3 class="why-h3">Season by season</h3>
      <p class="why-cap">${sparkCap}</p>
      <div class="why-sparks">
        <div class="why-spark"><span class="why-spark__name">${esc(hi.name)}</span><div id="sparkHi"></div></div>
        <div class="why-spark"><span class="why-spark__name">${esc(lo.name)}</span><div id="sparkLo"></div></div>
      </div>

      <p class="why-foot">${FOOT[MODE]}</p>`;

    drawBars($('whyBars'), ord, maxAbs, hi, lo);
    drawSpark($('sparkHi'), hi);
    drawSpark($('sparkLo'), lo);
  }

  function drawBars(host, ord, maxAbs, hi, lo) {
    const W_ = 640, rowH = 36, H = ord.length * rowH + 22;
    const labelR = 146;                 // right edge of the category-name column
    const plotL = labelR + 12, plotR = W_ - 8;
    const mid = (plotL + plotR) / 2;
    const barMax = (plotR - plotL) / 2 - 46;   // leave room for the value label
    const svg = mk('svg', { viewBox: `0 0 ${W_} ${H}`, class: 'why-bars__svg' }, host);
    mk('line', { x1: mid, y1: 2, x2: mid, y2: H - 20, class: 'why-bars__axis' }, svg);
    ord.forEach((r, i) => {
      const y = 4 + i * rowH + rowH / 2;
      const w = Math.max(1, (Math.abs(r.d) / maxAbs) * barMax);
      const toHi = r.d >= 0;
      mk('text', { x: labelR, y: y + 4, class: 'why-bars__lbl', 'text-anchor': 'end' }, svg)
        .textContent = LONG[MODE][r.cat];
      mk('rect', {
        x: toHi ? mid : mid - w, y: y - 9, width: w, height: 18, rx: 3,
        class: toHi ? 'why-bars__fill why-bars__fill--hi' : 'why-bars__fill why-bars__fill--lo',
      }, svg);
      mk('text', {
        x: toHi ? mid + w + 6 : mid - w - 6, y: y + 4,
        'text-anchor': toHi ? 'start' : 'end', class: 'why-bars__val',
      }, svg).textContent = Math.abs(r.dDisp).toFixed(2);
    });
    const last = (nm) => nm.split(' ').slice(-1)[0];
    mk('text', { x: mid + 6, y: H - 4, 'text-anchor': 'start', class: 'why-bars__end' }, svg)
      .textContent = `${last(hi.name)} ahead →`;
    mk('text', { x: mid - 6, y: H - 4, 'text-anchor': 'end', class: 'why-bars__end' }, svg)
      .textContent = `← ${last(lo.name)} ahead`;
  }

  function drawSpark(host, d) {
    const n = d.seasonSaa.length;
    const W_ = 520, H = 76, pad = 6;
    const lo = Math.min(0, ...d.seasonSaa), hey = Math.max(...d.seasonSaa, 0.1);
    const x = (i) => pad + (n <= 1 ? 0 : i / (n - 1) * (W_ - 2 * pad));
    const y = (v) => H - pad - (v - lo) / (hey - lo) * (H - 2 * pad);
    const svg = mk('svg', { viewBox: `0 0 ${W_} ${H}`, class: 'why-spark__svg' }, host);
    mk('line', { x1: 0, y1: y(0), x2: W_, y2: y(0), class: 'why-spark__zero' }, svg);
    let path = '';
    d.seasonSaa.forEach((v, i) => { path += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; });
    mk('path', { d: path, class: 'why-spark__line' }, svg);
    d.seasonSaa.forEach((v, i) => {
      mk('circle', {
        cx: x(i), cy: y(v), r: d.peakSet.has(i) ? 3.2 : 2,
        class: d.peakSet.has(i) ? 'why-spark__dot why-spark__dot--peak' : 'why-spark__dot',
      }, svg);
    });
  }

  function sentence(hi, lo, ord, dTotal, dPeak, gap, spots, hasPeak, played) {
    // pitcher SAA is innings-weighted with no peak, so category contributions
    // run larger and tiny ones (a starter's stray save value) are just noise --
    // hold the "lead" / "pushback" bar higher than on the hitters side.
    const EDGE = hasPeak ? 0.03 : 0.6;
    const wins = ord.filter((r) => r.d > EDGE).slice(0, 2);
    const loss = ord[ord.length - 1];
    const hiL = esc(hi.name.split(' ').slice(-1)[0]);
    const loL = esc(lo.name.split(' ').slice(-1)[0]);
    let s;
    if (!wins.length) {
      s = `${esc(hi.name)} comes out ahead on the blend of small edges, none decisive.`;
    } else {
      const wtxt = wins.map((r) => `${LONG[MODE][r.cat]} (+${Math.abs(r.d).toFixed(1)})`).join(' and ');
      s = loss.d < -EDGE
        ? `${esc(hi.name)}'s ${wtxt} ${wins.length > 1 ? 'more than cover' : 'covers'} ${loL}'s edge in ${LONG[MODE][loss.cat]} (+${Math.abs(loss.d).toFixed(1)}).`
        : `${esc(hi.name)} leads on ${wtxt}, with little pushback anywhere else.`;
    }
    const nearTie = hasPeak ? (gap < 0.4 || spots < 12) : gap < 1.0;
    if (nearTie) s = 'A near-tie. ' + s;
    const moreSeasons = hi.seasons - lo.seasons;
    if (hasPeak) {
      if (dTotal > 1.6 * Math.abs(dPeak) && moreSeasons >= 3)
        s += ` And ${hiL} stayed at that level for ${moreSeasons} more seasons — most of the margin is career length.`;
      else if (dTotal > 1.6 * Math.abs(dPeak) && moreSeasons <= -3)
        s += ` The gap is all in the rate: ${loL} played ${-moreSeasons} more seasons, but ${hiL}'s were worth more.`;
      else if (dPeak > 1.6 * Math.abs(dTotal))
        s += ` It's a peak gap more than a longevity one — ${loL}'s best years are close, ${hiL} just reached higher.`;
    } else {
      if (moreSeasons >= 3)
        s += ` ${hiL} also ${played} ${moreSeasons} more qualifying seasons, and every one adds to the total.`;
      else if (moreSeasons <= -3)
        s += ` ${loL} ${played} ${-moreSeasons} more qualifying seasons, so the edge is entirely in the rate.`;
    }
    return s;
  }

  // ---- wire up ----
  inA.addEventListener('change', run);
  inB.addEventListener('change', run);
  inA.addEventListener('input', () => { updateBadge(inA, badgeA); if (NAME_TO_ID.has(inA.value.trim().toLowerCase())) run(); });
  inB.addEventListener('input', () => { updateBadge(inB, badgeB); if (NAME_TO_ID.has(inB.value.trim().toLowerCase())) run(); });

  const nameOf = (id) => (BY_ID.has(id) ? BY_ID.get(id).p.n : '');

  function switchMode(mode, a, b) {
    if (mode !== 'hitters' && mode !== 'pitchers') return;
    buildMode(mode);
    let a0 = a, b0 = b;
    if (!(BY_ID.has(a0) && BY_ID.has(b0))) { [a0, b0] = DEFAULTS[mode]; }
    inA.value = BY_ID.has(a0) ? nameOf(a0) : '';
    inB.value = BY_ID.has(b0) ? nameOf(b0) : '';
    run();
  }

  document.querySelectorAll('.why-mode__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === MODE) return;
      switchMode(btn.dataset.mode);
    });
  });

  // ---- initial state: URL params, else saved, else the default matchup ----
  let mode0 = 'hitters', a0, b0;
  try {
    const q = new URL(location).searchParams;
    if (q.get('mode') === 'pitchers' || q.get('mode') === 'hitters') mode0 = q.get('mode');
    a0 = q.get('a'); b0 = q.get('b');
  } catch (e) { /* ignore */ }
  if (!a0 || !b0) {
    try {
      const saved = window.THOF && THOF.get('why');
      if (saved && saved.a && saved.b) {
        a0 = a0 || saved.a; b0 = b0 || saved.b;
        if (!new URL(location).searchParams.get('mode') && (saved.mode === 'pitchers' || saved.mode === 'hitters')) {
          mode0 = saved.mode;
        }
      }
    } catch (e) { /* ignore */ }
  }
  switchMode(mode0, a0, b0);
})();
