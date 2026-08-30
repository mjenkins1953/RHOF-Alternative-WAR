// Your Hall — hitters. Same table as the Top 300 list, but the ranking is
// recomputed in the browser from per-season z-scores (YH_PLAYERS) under
// weights the visitor chooses. YH_CONFIG carries the real RHOF defaults;
// YH_CARDS is the career box-score line per playerID.
//
// season row in YH_PLAYERS[i].s  = [z_AVG, z_ISO, z_BB, z_SB, z_DEF, PA]
// (a null z means that stat has no league spread that year — skip it and
//  renormalise the weights over the rest, exactly as build_saa.py does)

const YH = {
  cats: YH_CONFIG.cats,                    // ["avg","iso","bb","sb","def"]
  labels: YH_CONFIG.catLabels,             // ["AVG","ISO","BB","SB","DEF"]
  weights: YH_CONFIG.defaultWeights.slice(),
  peakN: YH_CONFIG.defaultPeakN,
  blend: YH_CONFIG.defaultBlend,
  listN: YH_CONFIG.listN,
  bubbleN: YH_CONFIG.bubbleN,
  paNorm: YH_CONFIG.paNorm,
};

// ---- the recompute: YH_PLAYERS + knobs -> a ranked array shaped like the
//      Top-300 list's SAA_DATA (rank/name/pa/seasons/saa/total/peak/z*/hof/nel) ----
function yhScore() {
  const raw = YH.weights;
  const wsum = raw.reduce((a, b) => a + b, 0);
  const w = wsum > 0 ? raw.map(x => x / wsum) : raw.map(() => 0.2);
  const peakN = YH.peakN;
  const blend = YH.blend;

  const scored = YH_PLAYERS.map(p => {
    let total = 0;
    const saas = [];
    for (let si = 0; si < p.s.length; si++) {
      const row = p.s[si];
      let num = 0, den = 0;
      for (let k = 0; k < 5; k++) {
        const z = row[k];
        if (z !== null) { num += w[k] * z; den += w[k]; }
      }
      if (den > 0) {
        const seasonSaa = (num / den) * row[5] / YH.paNorm;
        saas.push(seasonSaa);
        total += seasonSaa;
      }
    }
    saas.sort((a, b) => b - a);
    let peak = 0;
    for (let i = 0; i < peakN && i < saas.length; i++) peak += saas[i];
    const saa = (1 - blend) * total + blend * peak;
    return {
      id: p.id, name: p.n, pa: p.pa, seasons: p.s.length,
      saa, total, peak,
      avg: p.z[0], iso: p.z[1], bb: p.z[2], sb: p.z[3], def: p.z[4],
      hof: p.hof, nel: p.nel,
    };
  });

  scored.sort((a, b) => b.saa - a.saa);
  scored.forEach((d, i) => { d.rank = i + 1; });
  return scored;
}

let yhRanked = [];            // full pool, current weights, rank-sorted
let yhList = [];              // yhRanked.slice(0, listN)
let yhBubble = [];            // yhRanked[listN .. listN+bubbleN]

// ================= table (adapted from hitters-embed.js) =================
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
  const txt = (z > 0 ? '+' : '') + z.toFixed(2);
  return `<td class="${cls}">${txt}</td>`;
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

function saaCard(d) {
  const c = YH_CARDS[d.id] || {};
  const dec = v => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''));
  const int = v => (v == null ? '—' : v.toLocaleString('en-US'));
  const slash = [
    ['AVG', dec(c.avg)], ['OBP', dec(c.obp)], ['SLG', dec(c.slg)], ['OPS', dec(c.ops)],
    ['OPS+', c.opsPlus == null ? '—' : c.opsPlus],
    ['bWAR', c.war == null ? '—' : c.war.toFixed(1)],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const counting = [
    ['G', c.g], ['H', c.h], ['HR', c.hr], ['RBI', c.rbi],
    ['R', c.r], ['SB', c.sb], ['BB', c.bb], ['SO', c.so],
  ].map(([k, v]) => `<span><b>${int(v)}</b> ${k}</span>`).join('');
  const meta = [c.pos, c.yrs, c.team].filter(Boolean).join(' · ');
  const nelNote = d.nel
    ? '<p class="saa-card__note">Negro Leagues seasons are part of this ranking. Official league schedules ran far shorter than the majors\' and the surviving record is incomplete, so the career counting stats read low relative to the playing time behind them.</p>'
    : '';
  const pk = YH.peakN;
  const bl = Math.round(YH.blend * 100);
  const math = `= (career total ${d.total > 0 ? '+' : ''}${d.total.toFixed(2)} &times; ${100 - bl}% + best-${pk} peak ${d.peak > 0 ? '+' : ''}${d.peak.toFixed(2)} &times; ${bl}%)`;
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
          <span class="saa-card__z-math">${math}</span>
        </div>
        ${saaZBar('AVG', d.avg)}${saaZBar('ISO', d.iso)}${saaZBar('BB', d.bb)}${saaZBar('SB', d.sb)}${saaZBar('DEF', d.def)}
      </div>
      ${nelNote}
    </div>`;
}

function saaDetailRow(d) {
  return `<tr class="saa-detail"><td colspan="12">${saaCard(d)}</td></tr>`;
}

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
    ? `${sorted.length} of ${yhList.length} players`
    : `${yhList.length} players, ranked by your formula`;

  if (sorted.length === 0) {
    saaTbody.innerHTML = '';
    saaEmptyEl.style.display = 'block';
    saaQEcho.textContent = saaQuery;
    return;
  }
  saaEmptyEl.style.display = 'none';

  saaTbody.innerHTML = sorted.map(d => {
    const open = saaExpanded.has(d.id);
    return `<tr class="saa-row${open ? ' is-open' : ''}" data-id="${d.id}" tabindex="0" aria-expanded="${open}">
      <td class="rank"><span class="saa-caret">${open ? '▾' : '▸'}</span>${d.rank}</td>
      <td class="nel">${d.nel ? '<span class="nel-tag">NeL</span>' : ''}</td>
      <td class="name">${d.name}</td>
      <td>${d.pa.toLocaleString('en-US')}</td>
      <td>${d.seasons}</td>
      <td class="saa">${d.saa > 0 ? '+' : ''}${d.saa.toFixed(2)}</td>
      ${saaFmtZ(d.avg)}${saaFmtZ(d.iso)}${saaFmtZ(d.bb)}${saaFmtZ(d.sb)}${saaFmtZ(d.def)}
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

// full recompute + re-render, called on load and on every knob change
function yhRecompute() {
  yhRanked = yhScore();
  yhList = yhRanked.slice(0, YH.listN);
  const b = yhRanked.slice(YH.listN, YH.listN + YH.bubbleN);
  yhBubble = b;
  // drop expanded ids that fell off the list
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

// ================= scroll window (from hitters-embed.js) =================
const saaShell = document.querySelector('.saa-embed .table-shell');
function saaSizeScroll() {
  if (!saaShell) return;
  const head = saaShell.querySelector('thead');
  const row = saaShell.querySelector('tbody tr.saa-row');
  if (!head || !row) return;
  const h = head.getBoundingClientRect().height + row.getBoundingClientRect().height * 15;
  saaShell.style.maxHeight = Math.round(h) + 'px';
}

// ================= the weights panel =================
const yhWeightsEl = document.getElementById('yhWeights');
const yhBlendEl = document.getElementById('yhBlend');
const yhBlendVal = document.getElementById('yhBlendVal');
const yhPeakEl = document.getElementById('yhPeak');
const yhResetEl = document.getElementById('yhReset');
const yhReadoutEl = document.getElementById('yhReadout');

let yhRaf = 0;
function yhScheduleRecompute() {
  // coalesce a burst of slider `input` events into one recompute per frame.
  // (cancel + reschedule, not an early-return guard: a frame scheduled while
  //  the tab was hidden never fires, which would wedge an early-return guard.)
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
      <input type="range" min="0" max="100" step="1" value="${Math.round(YH.weights[i] * 100)}"
             aria-label="${YH.labels[i]} weight">
      <span class="yh-w__val">0%</span>
    </label>`).join('');
  yhWeightsEl.querySelectorAll('.yh-w input').forEach((inp, i) => {
    const onChange = () => {
      YH.weights[i] = Number(inp.value) / 100;
      yhSyncWeightLabels();
      yhScheduleRecompute();
    };
    inp.addEventListener('input', onChange);       // live while dragging
    inp.addEventListener('change', yhRecompute);   // guaranteed on release
  });
  yhSyncWeightLabels();
}

function yhBlendChange() {
  YH.blend = Number(yhBlendEl.value) / 100;
  yhBlendVal.textContent = `${100 - Number(yhBlendEl.value)} / ${yhBlendEl.value}`;
  yhScheduleRecompute();
}
yhBlendEl.addEventListener('input', yhBlendChange);
yhBlendEl.addEventListener('change', yhRecompute);

yhPeakEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-n]');
  if (!btn) return;
  YH.peakN = Number(btn.dataset.n);
  yhPeakEl.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === btn));
  yhScheduleRecompute();
});

yhResetEl.addEventListener('click', () => {
  YH.weights = YH_CONFIG.defaultWeights.slice();
  YH.peakN = YH_CONFIG.defaultPeakN;
  YH.blend = YH_CONFIG.defaultBlend;
  yhSyncWeightLabels();
  yhBlendEl.value = Math.round(YH.blend * 100);
  yhBlendVal.textContent = `${100 - Math.round(YH.blend * 100)} / ${Math.round(YH.blend * 100)}`;
  yhPeakEl.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', Number(b.dataset.n) === YH.peakN));
  yhRecompute();
});

function yhUpdateReadout() {
  const inHof = yhList.reduce((n, d) => n + (d.hof ? 1 : 0), 0);
  const isDefault =
    YH.weights.every((x, i) => Math.abs(x - YH_CONFIG.defaultWeights[i]) < 1e-9) &&
    YH.peakN === YH_CONFIG.defaultPeakN && Math.abs(YH.blend - YH_CONFIG.defaultBlend) < 1e-9;
  yhReadoutEl.innerHTML =
    `<b>${inHof}</b> of your top ${YH.listN} are in Cooperstown` +
    (isDefault ? ' &nbsp;·&nbsp; this is the real RHOF formula' : '');
}

// ================= go =================
yhBuildWeightSliders();
yhBlendEl.value = Math.round(YH.blend * 100);
yhBlendVal.textContent = `${100 - Math.round(YH.blend * 100)} / ${Math.round(YH.blend * 100)}`;
yhRecompute();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(saaSizeScroll);
window.addEventListener('resize', saaSizeScroll);
