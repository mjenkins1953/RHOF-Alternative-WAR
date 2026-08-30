// Stats — every player in the Lahman database, one career line each. No RHOF
// scoring. Batters and pitchers share this file (STATS_META.source picks the
// mode). The list renders in chunks (tens of thousands of rows) and grows on
// scroll; clicking a name expands a season-by-season card.

const ST_MODE = STATS_META.source;                         // 'batters' | 'pitchers'
const ST = {
  mode: ST_MODE,
  rows: ST_MODE === 'pitchers' ? STATS_PITCHERS : STATS_BATTERS,
  seasons: () => (ST_MODE === 'pitchers'
    ? (typeof STATS_PITCHERS_SEASONS !== 'undefined' ? STATS_PITCHERS_SEASONS : null)
    : (typeof STATS_BATTERS_SEASONS !== 'undefined' ? STATS_BATTERS_SEASONS : null)),
  cols: STATS_COLS,                                        // [[key, label, type], ...] -- col i -> row index i+1
  count: STATS_META.count,
};
const ST_NCOLS = ST.cols.length;

const ST_TYPE = {};
const ST_IDX = {};
ST.cols.forEach(([k, , t], i) => { ST_TYPE[k] = t; ST_IDX[k] = i + 1; });
const ST_LOW_GOOD = new Set(['era', 'whip']);              // sort ascending on first click
const ST_QUAL_KEY = STATS_META.qualKey;                    // rate-sort: this stat >= qualMin sorts first
const ST_QUAL_MIN = STATS_META.qualMin;

function ipStr(outs) {
  return `${Math.floor(outs / 3).toLocaleString('en-US')}.${outs % 3}`;
}
function stCell(key, v) {
  if (v === '' || v == null) return '—';
  if (key === 'ip') return ipStr(v);
  return typeof v === 'number' ? v.toLocaleString('en-US') : v;
}

// "last first" alpha key, derived once from the display name
const ST_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const stSortName = new Map();
for (const r of ST.rows) {
  const parts = r[1].split(' ');
  let li = parts.length - 1;
  if (li > 1 && ST_SUFFIX.test(parts[li])) li -= 1;
  stSortName.set(r, `${parts.slice(li).join(' ')} ${parts.slice(0, li).join(' ')}`.trim().toLowerCase());
}

const stTbody = document.getElementById('statsRows');
const stEmptyEl = document.getElementById('statsEmpty');
const stQEcho = document.getElementById('statsQEcho');
const stCountEl = document.getElementById('statsCount');
const stSearchInput = document.getElementById('statsQ');
const stHeaders = Array.from(document.querySelectorAll('.saa-embed th[data-key]'));
const stShell = document.querySelector('.saa-embed .table-shell');
const stNoun = ST_MODE === 'pitchers' ? 'pitchers' : 'players';

let stSortKey = ST_MODE === 'pitchers' ? 'ip' : 'g';
let stSortDir = -1;
let stQuery = '';
let stFiltered = ST.rows;
let stRendered = 0;
const ST_CHUNK = 150;
const stExpanded = new Set();

function stSortVal(row, key) {
  const v = row[ST_IDX[key]];
  const t = ST_TYPE[key];
  if (t === 'str') return v;
  if (t === 'int') return parseInt(v, 10) || 0;
  if (t === 'rate') { const n = parseFloat(v); return Number.isNaN(n) ? -Infinity : n; }
  return v;
}

// ---------------- season card ----------------
function stRate(x, dp) { if (x == null || !isFinite(x)) return '—'; const s = x.toFixed(dp); return (dp === 3 && s.startsWith('0.')) ? s.slice(1) : s; }

// batter season row = [year, team, G, AB, R, H, 2B, 3B, HR, RBI, SB, BB, SO, HBP, SF]
const SB = { yr: 0, tm: 1, g: 2, ab: 3, r: 4, h: 5, d2: 6, d3: 7, hr: 8, rbi: 9, sb: 10, bb: 11, so: 12, hbp: 13, sf: 14 };
function stBatStatCells(s) {
  const ab = s[SB.ab], h = s[SB.h];
  const tb = h + s[SB.d2] + 2 * s[SB.d3] + 3 * s[SB.hr];
  const od = ab + s[SB.bb] + s[SB.hbp] + s[SB.sf];
  const avg = ab ? h / ab : null, slg = ab ? tb / ab : null;
  const obp = od ? (h + s[SB.bb] + s[SB.hbp]) / od : null;
  const ops = (obp != null && slg != null) ? obp + slg : null;
  const n = k => s[SB[k]].toLocaleString('en-US');
  return `<td>${n('g')}</td><td>${n('ab')}</td><td>${n('r')}</td><td>${n('h')}</td>`
    + `<td>${n('d2')}</td><td>${n('d3')}</td><td>${n('hr')}</td><td>${n('rbi')}</td>`
    + `<td>${n('sb')}</td><td>${n('bb')}</td><td>${n('so')}</td>`
    + `<td>${stRate(avg, 3)}</td><td>${stRate(obp, 3)}</td><td>${stRate(slg, 3)}</td><td>${stRate(ops, 3)}</td>`;
}
const ST_BAT_TH = ['Year', 'Tm', 'G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS'];

// pitcher season row = [year, team, W, L, G, GS, CG, SHO, SV, IPouts, H, ER, HR, BB, SO]
const SP = { yr: 0, tm: 1, w: 2, l: 3, g: 4, gs: 5, cg: 6, sho: 7, sv: 8, outs: 9, h: 10, er: 11, hr: 12, bb: 13, so: 14 };
function stPitStatCells(s) {
  const ip = s[SP.outs] / 3;
  const era = ip ? s[SP.er] * 9 / ip : null;
  const whip = ip ? (s[SP.h] + s[SP.bb]) / ip : null;
  const n = k => s[SP[k]].toLocaleString('en-US');
  return `<td>${n('w')}</td><td>${n('l')}</td><td>${stRate(era, 2)}</td><td>${stRate(whip, 3)}</td>`
    + `<td>${n('g')}</td><td>${n('gs')}</td><td>${n('cg')}</td><td>${n('sho')}</td><td>${n('sv')}</td>`
    + `<td>${ipStr(s[SP.outs])}</td><td>${n('h')}</td><td>${n('er')}</td><td>${n('hr')}</td><td>${n('bb')}</td><td>${n('so')}</td>`;
}
const ST_PIT_TH = ['Year', 'Tm', 'W', 'L', 'ERA', 'WHIP', 'G', 'GS', 'CG', 'SHO', 'SV', 'IP', 'H', 'ER', 'HR', 'BB', 'SO'];

function stCard(id, name) {
  const all = ST.seasons();
  const seasons = all ? all[id] : null;
  const head = `<div class="stats-card__head"><span class="stats-card__name">${name}</span></div>`;
  if (!seasons || !seasons.length) {
    return `<div class="stats-card">${head}<p class="stats-card__sub">${all ? 'No season data.' : 'Loading season data…'}</p></div>`;
  }
  const pit = ST_MODE === 'pitchers';
  const nStats = 15;                     // both season rows are [yr, tm, + 13 stats]
  const statCells = pit ? stPitStatCells : stBatStatCells;
  const ths = (pit ? ST_PIT_TH : ST_BAT_TH).map(h => `<th>${h}</th>`).join('');

  const tot = new Array(nStats).fill(0);
  for (const s of seasons) for (let k = 2; k < nStats; k++) tot[k] += s[k];
  const body = seasons.map(s => `<tr><td>${s[0]}</td><td>${s[1] || '—'}</td>${statCells(s)}</tr>`).join('');
  const totRow = `<tr class="is-total"><td>${seasons[0][0]}–${seasons[seasons.length - 1][0]}</td>`
    + `<td>${seasons.length} yr</td>${statCells(tot)}</tr>`;
  return `<div class="stats-card">
      ${head}
      <div class="stats-card__wrap"><table class="stats-seasons">
        <thead><tr>${ths}</tr></thead><tbody>${body}${totRow}</tbody>
      </table></div>
    </div>`;
}
function stDetailRow(id, name) {
  return `<tr class="stats-detail"><td colspan="${ST_NCOLS}">${stCard(id, name)}</td></tr>`;
}

// ---------------- list ----------------
function stApply() {
  let rows = ST.rows;
  if (stQuery) {
    const qq = stQuery.toLowerCase();
    rows = rows.filter(r => r[1].toLowerCase().includes(qq));
  }
  const key = stSortKey, dir = stSortDir;
  if (ST_TYPE[key] === 'str') {
    rows = rows.slice().sort((a, b) => stSortName.get(a).localeCompare(stSortName.get(b)) * dir);
  } else if (ST_TYPE[key] === 'rate') {
    const qi = ST_IDX[ST_QUAL_KEY];
    rows = rows.slice().sort((a, b) => {
      const qa = a[qi] >= ST_QUAL_MIN ? 1 : 0, qb = b[qi] >= ST_QUAL_MIN ? 1 : 0;
      if (qa !== qb) return qb - qa;
      return (stSortVal(a, key) - stSortVal(b, key)) * dir;
    });
  } else {
    rows = rows.slice().sort((a, b) => (stSortVal(a, key) - stSortVal(b, key)) * dir);
  }
  stFiltered = rows;

  stCountEl.textContent = stQuery
    ? `${rows.length.toLocaleString('en-US')} of ${ST.count.toLocaleString('en-US')} ${stNoun}`
    : `${ST.count.toLocaleString('en-US')} ${stNoun}`;

  stTbody.innerHTML = '';
  stRendered = 0;
  if (rows.length === 0) {
    stEmptyEl.style.display = 'block';
    stQEcho.textContent = stQuery;
    return;
  }
  stEmptyEl.style.display = 'none';
  if (stShell) stShell.scrollTop = 0;
  stRenderMore();
}

function stRowHtml(r) {
  const open = stExpanded.has(r[0]);
  let tds = `<td class="name"><span class="stats-caret">${open ? '▾' : '▸'}</span>${r[1]}</td>`;
  for (let c = 1; c < ST.cols.length; c++) {
    const k = ST.cols[c][0];
    tds += `<td>${stCell(k, r[ST_IDX[k]])}</td>`;
  }
  return `<tr class="stats-row${open ? ' is-open' : ''}" data-id="${r[0]}" tabindex="0" aria-expanded="${open}">${tds}</tr>`
    + (open ? stDetailRow(r[0], r[1]) : '');
}

function stRenderMore() {
  const rows = stFiltered;
  if (stRendered >= rows.length) return;
  const end = Math.min(stRendered + ST_CHUNK, rows.length);
  let html = '';
  for (let i = stRendered; i < end; i++) html += stRowHtml(rows[i]);
  stTbody.insertAdjacentHTML('beforeend', html);
  stRendered = end;
}

if (stShell) {
  stShell.addEventListener('scroll', () => {
    if (stShell.scrollTop + stShell.clientHeight >= stShell.scrollHeight - 240) stRenderMore();
  }, { passive: true });
}

// ---------------- expand / collapse ----------------
function stToggleRow(tr) {
  const id = tr.dataset.id;
  const name = tr.querySelector('.name').textContent.replace(/^[▸▾]\s*/, '');
  const isOpen = stExpanded.has(id);
  if (isOpen) {
    stExpanded.delete(id);
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('stats-detail')) next.remove();
  } else {
    stExpanded.add(id);
    tr.insertAdjacentHTML('afterend', stDetailRow(id, name));
  }
  tr.classList.toggle('is-open', !isOpen);
  tr.setAttribute('aria-expanded', String(!isOpen));
  const caret = tr.querySelector('.stats-caret');
  if (caret) caret.textContent = isOpen ? '▸' : '▾';
}
stTbody.addEventListener('click', e => {
  const tr = e.target.closest('tr.stats-row');
  if (tr) stToggleRow(tr);
});
stTbody.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tr = e.target.closest('tr.stats-row');
  if (!tr) return;
  e.preventDefault();
  stToggleRow(tr);
});

// season data arrives after the list (deferred) -- refresh any card still on "Loading…"
window.addEventListener('load', () => {
  if (!ST.seasons() || !stExpanded.size) return;
  document.querySelectorAll('tr.stats-detail').forEach(d => {
    const row = d.previousElementSibling;
    if (row) d.querySelector('td').innerHTML = stCard(row.dataset.id, row.querySelector('.name').textContent.replace(/^[▸▾]\s*/, ''));
  });
});

// ---------------- sort / search ----------------
stHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (stSortKey === key) stSortDir *= -1;
    else {
      stSortKey = key;
      stSortDir = (ST_TYPE[key] === 'str' || ST_LOW_GOOD.has(key)) ? 1 : -1;
    }
    stHeaders.forEach(h => {
      h.classList.toggle('sorted', h === th);
      const arrow = h.querySelector('.arrow');
      if (h === th && arrow) arrow.textContent = stSortDir === 1 ? '▲' : '▼';
    });
    stApply();
  });
});

let stQTimer = 0;
stSearchInput.addEventListener('input', e => {
  stQuery = e.target.value.trim();
  clearTimeout(stQTimer);
  stQTimer = setTimeout(stApply, 120);
});

// ---------------- scroll window ----------------
function stSizeScroll() {
  if (!stShell) return;
  const head = stShell.querySelector('thead');
  const row = stShell.querySelector('tbody tr.stats-row');
  if (!head || !row) return;
  const h = head.getBoundingClientRect().height + row.getBoundingClientRect().height * 15;
  stShell.style.maxHeight = Math.round(h) + 'px';
}

const stPoolEl = document.getElementById('statsPool');
if (stPoolEl) stPoolEl.textContent = ST.count.toLocaleString('en-US');

const stDefaultTh = document.querySelector(`.saa-embed th[data-key="${stSortKey}"]`);
if (stDefaultTh) {
  stDefaultTh.classList.add('sorted');
  const a = stDefaultTh.querySelector('.arrow');
  if (a) a.textContent = '▼';
}

stApply();
stSizeScroll();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(stSizeScroll);
window.addEventListener('resize', stSizeScroll);
