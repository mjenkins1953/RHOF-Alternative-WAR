// Stats — every player in the Lahman database, one career line each.
// No RHOF scoring. The list renders in chunks (24k rows) and grows on scroll.
// Click a name to expand a season-by-season card (STATS_BATTERS_SEASONS).

const ST = {
  rows: STATS_BATTERS,             // [id, name, yrs, g, ab, r, h, 2b, 3b, hr, rbi, sb, bb, so, avg, obp, slg, ops]
  cols: STATS_COLS,                // [[key, label], ...]  (col i -> row index i+1)
  count: STATS_META.count,
};
const ST_NCOLS = ST.cols.length;   // colspan for the detail row

const ST_TYPE = {
  name: 'str', yrs: 'int',
  g: 'num', ab: 'num', r: 'num', h: 'num', d2: 'num', d3: 'num', hr: 'num',
  rbi: 'num', sb: 'num', bb: 'num', so: 'num',
  avg: 'rate', obp: 'rate', slg: 'rate', ops: 'rate',
};
const ST_IDX = {};
ST.cols.forEach(([k], i) => { ST_IDX[k] = i + 1; });

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

let stSortKey = 'g';
let stSortDir = -1;
let stQuery = '';
let stFiltered = ST.rows;
let stRendered = 0;
const ST_CHUNK = 150;
const stExpanded = new Set();     // playerIDs whose season card is open

function stSortVal(row, key) {
  const v = row[ST_IDX[key]];
  const t = ST_TYPE[key];
  if (t === 'str') return v;
  if (t === 'int') return parseInt(v, 10) || 0;
  if (t === 'rate') { const n = parseFloat(v); return Number.isNaN(n) ? -Infinity : n; }
  return v;
}

// ---------- the season card ----------
function stRate(x) {
  if (x == null || !isFinite(x)) return '—';
  const s = x.toFixed(3);
  return s.startsWith('0.') ? s.slice(1) : s;
}
// season row = [year, team, G, AB, R, H, 2B, 3B, HR, RBI, SB, BB, SO, HBP, SF]
const S = { yr: 0, tm: 1, g: 2, ab: 3, r: 4, h: 5, d2: 6, d3: 7, hr: 8, rbi: 9, sb: 10, bb: 11, so: 12, hbp: 13, sf: 14 };

// cells 3..17 (G through OPS) for one season array (also used for the total row)
function stStatCells(s) {
  const ab = s[S.ab], h = s[S.h];
  const tb = h + s[S.d2] + 2 * s[S.d3] + 3 * s[S.hr];
  const obpDen = ab + s[S.bb] + s[S.hbp] + s[S.sf];
  const avg = ab ? h / ab : null;
  const slg = ab ? tb / ab : null;
  const obp = obpDen ? (h + s[S.bb] + s[S.hbp]) / obpDen : null;
  const ops = (obp != null && slg != null) ? obp + slg : null;
  const n = k => s[S[k]].toLocaleString('en-US');
  return `<td>${n('g')}</td><td>${n('ab')}</td><td>${n('r')}</td><td>${n('h')}</td>`
    + `<td>${n('d2')}</td><td>${n('d3')}</td><td>${n('hr')}</td><td>${n('rbi')}</td>`
    + `<td>${n('sb')}</td><td>${n('bb')}</td><td>${n('so')}</td>`
    + `<td>${stRate(avg)}</td><td>${stRate(obp)}</td><td>${stRate(slg)}</td><td>${stRate(ops)}</td>`;
}

function stCard(id, name) {
  const seasons = (typeof STATS_BATTERS_SEASONS !== 'undefined') ? STATS_BATTERS_SEASONS[id] : null;
  const head = `<div class="stats-card__head"><span class="stats-card__name">${name}</span></div>`;
  if (!seasons || !seasons.length) {
    return `<div class="stats-card">${head}<p class="stats-card__sub">No season data.</p></div>`;
  }
  const tot = new Array(15).fill(0);
  for (const s of seasons) for (let k = 2; k < 15; k++) tot[k] += s[k];

  const th = ['Year', 'Tm', 'G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'AVG', 'OBP', 'SLG', 'OPS']
    .map(h => `<th>${h}</th>`).join('');
  const body = seasons.map(s => `<tr><td>${s[S.yr]}</td><td>${s[S.tm] || '—'}</td>${stStatCells(s)}</tr>`).join('');
  const totRow = `<tr class="is-total"><td>${seasons[0][S.yr]}–${seasons[seasons.length - 1][S.yr]}</td>`
    + `<td>${seasons.length} yr</td>${stStatCells(tot)}</tr>`;
  return `<div class="stats-card">
      ${head}
      <div class="stats-card__wrap"><table class="stats-seasons">
        <thead><tr>${th}</tr></thead>
        <tbody>${body}${totRow}</tbody>
      </table></div>
    </div>`;
}

function stDetailRow(id, name) {
  return `<tr class="stats-detail"><td colspan="${ST_NCOLS}">${stCard(id, name)}</td></tr>`;
}

// ---------- list ----------
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
    const ab = ST_IDX.ab, QUAL = 1000;
    rows = rows.slice().sort((a, b) => {
      const qa = a[ab] >= QUAL ? 1 : 0, qb = b[ab] >= QUAL ? 1 : 0;
      if (qa !== qb) return qb - qa;
      return (stSortVal(a, key) - stSortVal(b, key)) * dir;
    });
  } else {
    rows = rows.slice().sort((a, b) => (stSortVal(a, key) - stSortVal(b, key)) * dir);
  }
  stFiltered = rows;

  stCountEl.textContent = stQuery
    ? `${rows.length.toLocaleString('en-US')} of ${ST.count.toLocaleString('en-US')} players`
    : `${ST.count.toLocaleString('en-US')} players`;

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
    const v = r[ST_IDX[ST.cols[c][0]]];
    tds += `<td>${v === '' || v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('en-US') : v)}</td>`;
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

// ---------- expand / collapse ----------
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

// ---------- sort / search ----------
stHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (stSortKey === key) stSortDir *= -1;
    else { stSortKey = key; stSortDir = (ST_TYPE[key] === 'str') ? 1 : -1; }
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

// ---------- scroll window ----------
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
