// Your Hall — hitters and pitchers share this file. The ranking is recomputed
// in the browser from per-season z-scores (YH_PLAYERS) under weights the visitor
// chooses. YH_CONFIG carries the real RHOF defaults and the mode; YH_CARDS is
// the career box-score line per playerID.
//
// season row in YH_PLAYERS[i].s = [z0, z1, z2, z3, z4, workload]  (order =
// YH_CONFIG.cats). A null z means that stat has no league spread that year —
// skip it and renormalise the weights over the rest, exactly as the Python does.

const YH = {
  mode: YH_CONFIG.mode,                     // 'hitters' | 'pitchers'
  cats: YH_CONFIG.cats,
  labels: YH_CONFIG.catLabels,
  weights: YH_CONFIG.defaultWeights.slice(),
  hasPeak: !!YH_CONFIG.hasPeak,             // hitters only: career↔peak blend
  peakN: YH_CONFIG.defaultPeakN || 7,
  blend: YH_CONFIG.defaultBlend == null ? 0.5 : YH_CONFIG.defaultBlend,
  listN: YH_CONFIG.listN,
  bubbleN: YH_CONFIG.bubbleN,
  norm: YH_CONFIG.workloadNorm,
};
const YH_NOUN = YH.mode === 'pitchers' ? 'pitchers' : 'players';

// ---- the recompute: YH_PLAYERS + knobs -> a ranked array ----
function yhScore() {
  const raw = YH.weights;
  const wsum = raw.reduce((a, b) => a + b, 0);
  const w = wsum > 0 ? raw.map(x => x / wsum) : raw.map(() => 0.2);
  const hasPeak = YH.hasPeak;
  const peakN = YH.peakN;
  const blend = YH.blend;

  const scored = YH_PLAYERS.map(p => {
    let total = 0, wlSum = 0;
    const saas = [];
    for (let si = 0; si < p.s.length; si++) {
      const row = p.s[si];
      let num = 0, den = 0;
      for (let k = 0; k < 5; k++) {
        const z = row[k];
        if (z !== null) { num += w[k] * z; den += w[k]; }
      }
      if (den > 0) {
        const seasonSaa = (num / den) * row[5] / YH.norm;
        saas.push(seasonSaa);
        total += seasonSaa;
        wlSum += row[5];
      }
    }
    let saa = total;
    let peak = 0;
    if (hasPeak) {
      saas.sort((a, b) => b - a);
      for (let i = 0; i < peakN && i < saas.length; i++) peak += saas[i];
      saa = (1 - blend) * total + blend * peak;
    }
    const rate = wlSum > 0 ? total / (wlSum / YH.norm) : 0;
    const d = {
      id: p.id, name: p.n, wl: p.wl, seasons: p.s.length,
      saa, total, peak, rate, hof: p.hof, nel: p.nel,
    };
    d[YH.mode === 'pitchers' ? 'ip' : 'pa'] = p.wl;       // workload column sort key
    for (let k = 0; k < 5; k++) d[YH.cats[k]] = p.z[k];   // z columns (weight-independent)
    return d;
  });

  scored.sort((a, b) => b.saa - a.saa);
  scored.forEach((d, i) => { d.rank = i + 1; });
  return scored;
}

let yhRanked = [], yhList = [], yhBubble = [];

// ================= table =================
const saaTbody = document.getElementById('saaRows');
const saaEmptyEl = document.getElementById('saaEmpty');
const saaBubbleEl = document.getElementById('saaBubble');
const saaQEcho = document.getElementById('saaQEcho');
const saaCountEl = document.getElementById('saaCount');
const saaSearchInput = document.getElementById('saaQ');
const saaHofToggle = document.getElementById('saaHofOnly');
const saaHeaders = Array.from(document.querySelectorAll('.saa-embed th[data-key]'));

let saaSortKey = 'rank';
let saaSortDir = 1;
let saaQuery = '';
const saaExpanded = new Set();   // player ids whose career card is open

function saaFmtZ(z) {
  const cls = z > 0.15 ? 'z-pos' : (z < -0.15 ? 'z-neg' : 'z-flat');
  return `<td class="${cls}">${z > 0 ? '+' : ''}${z.toFixed(2)}</td>`;
}
function saaZBar(label, z) {
  const cls = z > 0.15 ? 'pos' : (z < -0.15 ? 'neg' : 'flat');
  const mag = (Math.min(Math.abs(z), 4) / 4) * 50;
  const side = z >= 0 ? 'left' : 'right';
  return `<div class="saa-card__zrow">
      <span class="saa-card__zlabel">${label}</span>
      <span class="saa-card__ztrack"><span class="saa-card__zfill ${cls}" style="${side}:50%;width:${mag}%"></span></span>
      <span class="saa-card__zval ${cls}">${z > 0 ? '+' : ''}${z.toFixed(2)}</span>
    </div>`;
}

function yhCardBody(d, c) {
  const dec = v => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''));
  const two = v => (v == null ? '—' : v.toFixed(2));
  const int = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
  if (YH.mode === 'pitchers') {
    const slash = [
      ['W–L', c.w == null ? '—' : `${c.w}–${c.l}`], ['ERA', two(c.era)], ['WHIP', two(c.whip)],
      ['ERA+', c.eraPlus == null ? '—' : c.eraPlus], ['bWAR', c.war == null ? '—' : c.war.toFixed(1)],
    ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    const counting = [['IP', int(c.ip)], ['SO', int(c.so)], ['SV', int(c.sv)], ['G', int(c.g)], ['GS', int(c.gs)]]
      .map(([k, v]) => `<span><b>${v}</b> ${k}</span>`).join('');
    const math = c.qip
      ? `= weighted five-z blend (${d.rate > 0 ? '+' : ''}${d.rate.toFixed(3)} per 200 IP) &times; ${Math.round(c.qip).toLocaleString('en-US')} qualifying IP &divide; 200`
      : '';
    return { slash, counting, math };
  }
  const slash = [
    ['AVG', dec(c.avg)], ['OBP', dec(c.obp)], ['SLG', dec(c.slg)], ['OPS', dec(c.ops)],
    ['OPS+', c.opsPlus == null ? '—' : c.opsPlus], ['bWAR', c.war == null ? '—' : c.war.toFixed(1)],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const counting = [
    ['G', c.g], ['H', c.h], ['HR', c.hr], ['RBI', c.rbi], ['R', c.r], ['SB', c.sb], ['BB', c.bb], ['SO', c.so],
  ].map(([k, v]) => `<span><b>${int(v)}</b> ${k}</span>`).join('');
  const bl = Math.round(YH.blend * 100);
  const math = `= (career total ${d.total > 0 ? '+' : ''}${d.total.toFixed(2)} &times; ${100 - bl}% + best-${YH.peakN} peak ${d.peak > 0 ? '+' : ''}${d.peak.toFixed(2)} &times; ${bl}%)`;
  return { slash, counting, math };
}

function saaCard(d) {
  const c = YH_CARDS[d.id] || {};
  const { slash, counting, math } = yhCardBody(d, c);
  const meta = [c.pos || c.role, c.yrs, c.team].filter(Boolean).join(' · ');
  const nelNote = d.nel
    ? `<p class="saa-card__note">Negro Leagues seasons are part of this ranking. Official league schedules ran far shorter than the majors' and the surviving record is incomplete, so the career counting stats read low relative to the playing time behind them.</p>`
    : '';
  const zbars = YH.labels.map((lab, i) => saaZBar(lab, d[YH.cats[i]])).join('');
  return `<div class="saa-card">
      <div class="saa-card__head">
        <span class="saa-card__rank">#${d.rank}</span>
        <span class="saa-card__name">${d.name}${d.hof ? ' <span class="hof-star">★</span>' : ''}</span>
        <span class="saa-card__meta">${meta}</span>
      </div>
      <div class="saa-card__slash">${slash}</div>
      <div class="saa-card__counting">${counting}</div>
      <div class="saa-card__z">
        <div class="saa-card__z-head">
          <span class="saa-card__z-score">Your score <b>${d.saa > 0 ? '+' : ''}${d.saa.toFixed(2)}</b></span>
          ${math ? `<span class="saa-card__z-math">${math}</span>` : ''}
        </div>
        ${zbars}
      </div>
      ${nelNote}
    </div>`;
}
function saaDetailRow(d) { return `<tr class="saa-detail"><td colspan="12">${saaCard(d)}</td></tr>`; }

function saaRender() {
  let rows = yhList;
  if (saaQuery) {
    const qq = saaQuery.toLowerCase();
    rows = rows.filter(d => d.name.toLowerCase().includes(qq));
  }
  if (saaHofToggle.checked) rows = rows.filter(d => d.hof);

  const sorted = rows.slice().sort((a, b) => {
    const av = a[saaSortKey], bv = b[saaSortKey];
    if (typeof av === 'string') return av.localeCompare(bv) * saaSortDir;
    if (typeof av === 'boolean') return ((av === bv) ? 0 : (av ? -1 : 1)) * saaSortDir;
    return (av - bv) * saaSortDir;
  });

  saaCountEl.textContent = saaQuery || saaHofToggle.checked
    ? `${sorted.length} of ${yhList.length} ${YH_NOUN}`
    : `${yhList.length} ${YH_NOUN}, ranked by your formula`;

  if (sorted.length === 0) {
    saaTbody.innerHTML = '';
    saaEmptyEl.style.display = 'block';
    saaQEcho.textContent = saaQuery;
    return;
  }
  saaEmptyEl.style.display = 'none';

  saaTbody.innerHTML = sorted.map(d => {
    const open = saaExpanded.has(d.id);
    const zcells = YH.cats.map(cat => saaFmtZ(d[cat])).join('');
    return `<tr class="saa-row${open ? ' is-open' : ''}" data-id="${d.id}" tabindex="0" aria-expanded="${open}">
      <td class="rank"><span class="saa-caret">${open ? '▾' : '▸'}</span>${d.rank}</td>
      <td class="nel">${d.nel ? '<span class="nel-tag">NeL</span>' : ''}</td>
      <td class="name">${d.name}</td>
      <td>${Math.round(d.wl).toLocaleString('en-US')}</td>
      <td>${d.seasons}</td>
      <td class="saa">${d.saa > 0 ? '+' : ''}${d.saa.toFixed(2)}</td>
      ${zcells}
      <td>${d.hof ? '<span class="hof-star">★</span>' : '<span class="hof-dash">—</span>'}</td>
    </tr>${open ? saaDetailRow(d) : ''}`;
  }).join('');
}

function saaRenderBubble() {
  if (!saaBubbleEl) return;
  saaBubbleEl.innerHTML = yhBubble.map(d => `
    <div class="bubble-row">
      <span class="bubble-rank">${d.rank}</span>
      <span class="bubble-name">${d.nel ? '<span class="nel-tag">NeL</span> ' : ''}${d.name}${d.hof ? ' <span class="hof-star">★</span>' : ''}</span>
      <span class="bubble-saa">${d.saa > 0 ? '+' : ''}${d.saa.toFixed(2)}</span>
    </div>`).join('');
}

function yhRecompute() {
  yhRanked = yhScore();
  yhList = yhRanked.slice(0, YH.listN);
  yhBubble = yhRanked.slice(YH.listN, YH.listN + YH.bubbleN);
  const live = new Set(yhList.map(d => d.id));
  for (const id of [...saaExpanded]) if (!live.has(id)) saaExpanded.delete(id);
  saaRender();
  saaRenderBubble();
  yhUpdateReadout();
  saaSizeScroll();
}

// ================= sorting / search / expand =================
saaHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (saaSortKey === key) saaSortDir *= -1;
    else { saaSortKey = key; saaSortDir = 1; }
    saaHeaders.forEach(h => {
      h.classList.toggle('sorted', h === th);
      const arrow = h.querySelector('.arrow');
      if (h === th) arrow.textContent = saaSortDir === 1 ? '▲' : '▼';
    });
    saaRender();
  });
});
saaSearchInput.addEventListener('input', e => { saaQuery = e.target.value.trim(); saaRender(); });
saaHofToggle.addEventListener('change', saaRender);

function saaToggleRow(tr) {
  const id = tr.dataset.id;
  if (saaExpanded.has(id)) saaExpanded.delete(id);
  else saaExpanded.add(id);
  saaRender();
  if (saaExpanded.has(id)) {
    const again = saaTbody.querySelector(`tr.saa-row[data-id="${id}"]`);
    if (again) again.focus();
  }
}
saaTbody.addEventListener('click', e => {
  const tr = e.target.closest('tr.saa-row');
  if (tr) saaToggleRow(tr);
});
saaTbody.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tr = e.target.closest('tr.saa-row');
  if (!tr) return;
  e.preventDefault();
  saaToggleRow(tr);
});

// ================= scroll window =================
const saaShell = document.querySelector('.saa-embed .table-shell');
function saaSizeScroll() {
  if (!saaShell) return;
  const head = saaShell.querySelector('thead');
  const row = saaShell.querySelector('tbody tr.saa-row');
  if (!head || !row) return;
  const h = head.getBoundingClientRect().height + row.getBoundingClientRect().height * 15;
  saaShell.style.maxHeight = Math.round(h) + 'px';
}

// ================= weights panel =================
const yhWeightsEl = document.getElementById('yhWeights');
const yhBlendEl = document.getElementById('yhBlend');
const yhBlendVal = document.getElementById('yhBlendVal');
const yhPeakEl = document.getElementById('yhPeak');
const yhResetEl = document.getElementById('yhReset');
const yhReadoutEl = document.getElementById('yhReadout');
const yhBlendField = yhBlendEl ? yhBlendEl.closest('.yh-field') : null;
const yhPeakField = yhPeakEl ? yhPeakEl.closest('.yh-field') : null;

let yhRaf = 0;
function yhScheduleRecompute() {
  if (yhRaf) cancelAnimationFrame(yhRaf);
  yhRaf = requestAnimationFrame(() => { yhRaf = 0; yhRecompute(); });
}

function yhNormPct() {
  const s = YH.weights.reduce((a, b) => a + b, 0) || 1;
  return YH.weights.map(x => Math.round((x / s) * 100));
}
function yhSyncWeightLabels() {
  const pct = yhNormPct();
  yhWeightsEl.querySelectorAll('.yh-w').forEach((row, i) => {
    row.querySelector('.yh-w__val').textContent = pct[i] + '%';
    row.querySelector('input').value = Math.round(YH.weights[i] * 100);
  });
}
function yhBuildWeightSliders() {
  yhWeightsEl.innerHTML = YH.cats.map((cat, i) => `
    <label class="yh-w" data-cat="${cat}">
      <span class="yh-w__label">${YH.labels[i]}</span>
      <input type="range" min="0" max="100" step="1" value="${Math.round(YH.weights[i] * 100)}" aria-label="${YH.labels[i]} weight">
      <span class="yh-w__val">0%</span>
    </label>`).join('');
  yhWeightsEl.querySelectorAll('.yh-w input').forEach((inp, i) => {
    const onInput = () => { YH.weights[i] = Number(inp.value) / 100; yhSyncWeightLabels(); yhScheduleRecompute(); };
    inp.addEventListener('input', onInput);
    inp.addEventListener('change', yhRecompute);
  });
  yhSyncWeightLabels();
}

function yhSetBlendLabel() {
  const v = Math.round(YH.blend * 100);
  yhBlendEl.value = v;
  yhBlendVal.textContent = `${100 - v} / ${v}`;
}

if (YH.hasPeak) {
  yhBlendEl.addEventListener('input', () => {
    YH.blend = Number(yhBlendEl.value) / 100;
    yhBlendVal.textContent = `${100 - Number(yhBlendEl.value)} / ${yhBlendEl.value}`;
    yhScheduleRecompute();
  });
  yhBlendEl.addEventListener('change', yhRecompute);
  yhPeakEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-n]');
    if (!btn) return;
    YH.peakN = Number(btn.dataset.n);
    yhPeakEl.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === btn));
    yhRecompute();   // discrete click, no need to debounce
  });
} else {
  // pitcher SAA has no peak component -- hide those controls entirely
  if (yhBlendField) yhBlendField.remove();
  if (yhPeakField) yhPeakField.remove();
}

yhResetEl.addEventListener('click', () => {
  YH.weights = YH_CONFIG.defaultWeights.slice();
  yhSyncWeightLabels();
  if (YH.hasPeak) {
    YH.peakN = YH_CONFIG.defaultPeakN;
    YH.blend = YH_CONFIG.defaultBlend;
    yhSetBlendLabel();
    yhPeakEl.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', Number(b.dataset.n) === YH.peakN));
  }
  yhRecompute();
});

function yhUpdateReadout() {
  const inHof = yhList.reduce((n, d) => n + (d.hof ? 1 : 0), 0);
  let isDefault = YH.weights.every((x, i) => Math.abs(x - YH_CONFIG.defaultWeights[i]) < 1e-9);
  if (YH.hasPeak) {
    isDefault = isDefault && YH.peakN === YH_CONFIG.defaultPeakN
      && Math.abs(YH.blend - YH_CONFIG.defaultBlend) < 1e-9;
  }
  yhReadoutEl.innerHTML =
    `<b>${inHof}</b> of your top ${YH.listN} are in Cooperstown` +
    (isDefault ? ' &nbsp;·&nbsp; this is the real RHOF formula' : '');
}

// ================= go =================
yhBuildWeightSliders();
if (YH.hasPeak) yhSetBlendLabel();
yhRecompute();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(saaSizeScroll);
window.addEventListener('resize', saaSizeScroll);
