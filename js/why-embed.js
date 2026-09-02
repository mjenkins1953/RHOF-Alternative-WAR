// Who's Better — head-to-head decomposition of the SAA gap between two hitters.
// Reuses js/yourhall-hitters-data.js (YH_PLAYERS z-matrix + YH_CONFIG) and
// scores everyone at the DEFAULT weights, so the numbers match the published
// hitters list exactly. See build_saa.py / yourhall-embed.js yhScore().
(function () {
  if (typeof YH_PLAYERS === 'undefined' || typeof YH_CONFIG === 'undefined') return;

  const W = YH_CONFIG.defaultWeights;                 // [.3 .3 .1 .1 .2]
  const NORM = YH_CONFIG.workloadNorm;                // 600
  const DECLINE = YH_CONFIG.declineWeight == null ? 1 : YH_CONFIG.declineWeight;  // .4
  const PEAK_N = YH_CONFIG.defaultPeakN || 7;
  const BLEND = YH_CONFIG.defaultBlend == null ? 0.5 : YH_CONFIG.defaultBlend;    // .5
  const CATS = YH_CONFIG.catLabels;                   // ["AVG","ISO","BB","SB","DEF"]
  const LONG = { AVG: 'batting average', ISO: 'power', BB: 'plate discipline',
                 SB: 'base-stealing', DEF: 'defense' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sign = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (name, attrs, parent) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // ---- decomposition: one player -> per-category total / peak / final ----
  function decompose(p) {
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
    const order = seasonSaa.map((v, i) => i).sort((a, b) => seasonSaa[b] - seasonSaa[a]);
    for (let i = 0; i < PEAK_N && i < order.length; i++)
      for (let k = 0; k < 5; k++) peakCat[k] += contrib[order[i]][k];
    const finalCat = totalCat.map((t, k) => (1 - BLEND) * t + BLEND * peakCat[k]);
    const SAA_total = totalCat.reduce((a, b) => a + b, 0);
    const SAA_peak = peakCat.reduce((a, b) => a + b, 0);
    return {
      id: p.id, name: p.n, hof: p.hof, seasons: p.s.length,
      totalCat, peakCat, finalCat, SAA_total, SAA_peak,
      SAA_final: SAA_total * (1 - BLEND) + SAA_peak * BLEND,
      seasonSaa, peakSet: new Set(order.slice(0, PEAK_N)),
    };
  }

  // ---- score & rank the whole pool once (default weights) ----
  const BY_ID = new Map();
  const NAMES = [];
  const ranked = YH_PLAYERS.map((p) => {
    const d = decompose(p);
    BY_ID.set(p.id, { p, d });
    NAMES.push({ id: p.id, n: p.n });
    return d;
  }).sort((a, b) => b.SAA_final - a.SAA_final);
  ranked.forEach((d, i) => { d.rank = i + 1; });
  const RANK = new Map(ranked.map((d) => [d.id, d.rank]));
  NAMES.sort((a, b) => a.n.localeCompare(b.n));

  // ---- pickers ----
  const dl = $('whyPlayers');
  NAMES.forEach(({ n }) => { const o = document.createElement('option'); o.value = n; dl.appendChild(o); });
  const NAME_TO_ID = new Map(NAMES.map(({ id, n }) => [n.toLowerCase(), id]));
  const inA = $('whyA'), inB = $('whyB');

  function currentIds() {
    return [NAME_TO_ID.get(inA.value.trim().toLowerCase()),
            NAME_TO_ID.get(inB.value.trim().toLowerCase())];
  }

  function run() {
    const [ia, ib] = currentIds();
    const out = $('whyOut');
    if (!ia || !ib) { out.hidden = true; return; }
    if (ia === ib) {
      out.hidden = false;
      out.innerHTML = '<p class="why-note">Pick two different players.</p>';
      return;
    }
    try {
      const u = new URL(location);
      u.searchParams.set('a', ia); u.searchParams.set('b', ib);
      history.replaceState(null, '', u);
    } catch (e) { /* ignore */ }
    try {
      if (window.THOF) { THOF.set('why', { a: ia, b: ib }); }
    } catch (e) { /* ignore */ }

    render(ia, ib, out);
  }

  function render(ia, ib, out) {
    const A = BY_ID.get(ia).d, B = BY_ID.get(ib).d;
    const hi = A.SAA_final >= B.SAA_final ? A : B;
    const lo = hi === A ? B : A;
    const rHi = RANK.get(hi.id), rLo = RANK.get(lo.id);
    const gap = hi.SAA_final - lo.SAA_final;
    const spots = rLo - rHi;
    const dTotal = (hi.SAA_total - lo.SAA_total) / 2;   // contribution to SAA_final
    const dPeak = (hi.SAA_peak - lo.SAA_peak) / 2;

    // per-category delta (hi minus lo), contribution to the final gap
    const rows = CATS.map((c, k) => ({
      cat: c, d: hi.finalCat[k] - lo.finalCat[k], hi: hi.finalCat[k], lo: lo.finalCat[k],
    }));
    const maxAbs = Math.max(0.001, ...rows.map((r) => Math.abs(r.d)));
    const ord = rows.slice().sort((a, b) => b.d - a.d);

    out.hidden = false;
    out.innerHTML = `
      <p class="why-verdict">
        <b>${esc(hi.name)}</b> ranks <b>${spots}</b> spot${spots === 1 ? '' : 's'} higher than
        ${esc(lo.name)} <span class="why-verdict__saa">(${hi.SAA_final.toFixed(2)} vs ${lo.SAA_final.toFixed(2)} SAA)</span>
      </p>
      <p class="why-sentence">${sentence(hi, lo, ord, dTotal, dPeak, gap, spots)}</p>

      <div class="why-split">
        <span>of the <b>${gap.toFixed(2)}</b>-SAA gap:</span>
        <span class="why-split__part">career total <b>${sign(dTotal)}</b></span>
        <span class="why-split__part">peak <b>${sign(dPeak)}</b></span>
      </div>

      <h3 class="why-h3">Where the gap comes from</h3>
      <p class="why-cap">Each bar is that category's share of the ${gap.toFixed(2)}-SAA gap.
        <span class="why-key"><i class="sw sw--hi"></i>${esc(hi.name)}</span>
        <span class="why-key"><i class="sw sw--lo"></i>${esc(lo.name)}</span></p>
      <div id="whyBars" class="why-bars"></div>

      <h3 class="why-h3">Season by season</h3>
      <p class="why-cap">Each hitter's SAA in every qualifying season — the shape of the career.
        Filled marks are the seven that make the peak half of the formula.</p>
      <div class="why-sparks">
        <div class="why-spark"><span class="why-spark__name">${esc(hi.name)}</span><div id="sparkHi"></div></div>
        <div class="why-spark"><span class="why-spark__name">${esc(lo.name)}</span><div id="sparkLo"></div></div>
      </div>

      <p class="why-foot">
        Scored at the default SAA weights — AVG 30% · ISO 30% · Defense 20% · Walks 10% · Steals 10%,
        the bar 60% toward the player's position, career total blended 50/50 with the best seven seasons.
        <a href="yourhall.html">Your Hall</a> re-scores the same data under weights you choose.
      </p>`;

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
        .textContent = LONG[r.cat];
      mk('rect', {
        x: toHi ? mid : mid - w, y: y - 9, width: w, height: 18, rx: 3,
        class: toHi ? 'why-bars__fill why-bars__fill--hi' : 'why-bars__fill why-bars__fill--lo',
      }, svg);
      mk('text', {
        x: toHi ? mid + w + 6 : mid - w - 6, y: y + 4,
        'text-anchor': toHi ? 'start' : 'end', class: 'why-bars__val',
      }, svg).textContent = Math.abs(r.d).toFixed(2);
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

  function sentence(hi, lo, ord, dTotal, dPeak, gap, spots) {
    const wins = ord.filter((r) => r.d > 0.03).slice(0, 2);
    const loss = ord[ord.length - 1];
    const hiL = esc(hi.name.split(' ').slice(-1)[0]);
    const loL = esc(lo.name.split(' ').slice(-1)[0]);
    let s;
    if (!wins.length) {
      s = `${esc(hi.name)} comes out ahead on the blend of small edges, none decisive.`;
    } else {
      const wtxt = wins.map((r) => `${LONG[r.cat]} (+${Math.abs(r.d).toFixed(1)})`).join(' and ');
      s = loss.d < -0.03
        ? `${esc(hi.name)}'s ${wtxt} ${wins.length > 1 ? 'more than cover' : 'covers'} ${loL}'s edge in ${LONG[loss.cat]} (+${Math.abs(loss.d).toFixed(1)}).`
        : `${esc(hi.name)} leads on ${wtxt}, with little pushback anywhere else.`;
    }
    if (gap < 0.4 || spots < 12) s = 'A near-tie. ' + s;
    const moreSeasons = hi.seasons - lo.seasons;
    if (dTotal > 1.6 * Math.abs(dPeak) && moreSeasons >= 3)
      s += ` And ${hiL} stayed at that level for ${moreSeasons} more seasons — most of the margin is career length.`;
    else if (dTotal > 1.6 * Math.abs(dPeak) && moreSeasons <= -3)
      s += ` The gap is all in the rate: ${loL} played ${-moreSeasons} more seasons, but ${hiL}'s were worth more.`;
    else if (dPeak > 1.6 * Math.abs(dTotal))
      s += ` It's a peak gap more than a longevity one — ${loL}'s best years are close, ${hiL} just reached higher.`;
    return s;
  }

  // ---- wire up ----
  inA.addEventListener('change', run);
  inB.addEventListener('change', run);
  inA.addEventListener('input', () => { if (NAME_TO_ID.has(inA.value.trim().toLowerCase())) run(); });
  inB.addEventListener('input', () => { if (NAME_TO_ID.has(inB.value.trim().toLowerCase())) run(); });

  // ---- initial state: URL params, else saved, else a default matchup ----
  const nameOf = (id) => (BY_ID.has(id) ? BY_ID.get(id).p.n : '');
  let a0, b0;
  try {
    const q = new URL(location).searchParams;
    a0 = q.get('a'); b0 = q.get('b');
  } catch (e) { /* ignore */ }
  if (!(BY_ID.has(a0) && BY_ID.has(b0))) {
    try {
      const saved = window.THOF && THOF.get('why');
      if (saved && BY_ID.has(saved.a) && BY_ID.has(saved.b)) { a0 = saved.a; b0 = saved.b; }
    } catch (e) { /* ignore */ }
  }
  if (!(BY_ID.has(a0) && BY_ID.has(b0))) { a0 = 'jeterde01'; b0 = 'trammal01'; }
  if (BY_ID.has(a0)) inA.value = nameOf(a0);
  if (BY_ID.has(b0)) inB.value = nameOf(b0);
  run();
})();
