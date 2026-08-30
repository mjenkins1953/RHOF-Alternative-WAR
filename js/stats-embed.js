// Stats — every player in the Lahman database, one career line each.
// No RHOF scoring: STATS_BATTERS holds the raw career totals. The table can
// hold ~24k rows, so it renders in chunks and grows as you scroll.

const ST = {
  rows: STATS_BATTERS,             // [id, name, yrs, g, ab, r, h, 2b, 3b, hr, rbi, sb, bb, so, avg, obp, slg, ops]
  cols: STATS_COLS,                // [[key, label], ...]  (col i -> row index i+1)
  count: STATS_META.count,
};

// per-column sort type, keyed by STATS_COLS key
const ST_TYPE = {
  name: 'str', yrs: 'int',
  g: 'num', ab: 'num', r: 'num', h: 'num', d2: 'num', d3: 'num', hr: 'num',
  rbi: 'num', sb: 'num', bb: 'num', so: 'num',
  avg: 'rate', obp: 'rate', slg: 'rate', ops: 'rate',
};
const ST_IDX = {};              // key -> row-array index
ST.cols.forEach(([k], i) => { ST_IDX[k] = i + 1; });

// "last first" alpha key, derived once from the display name (no cost in the
// data file). Trailing Jr./Sr./II–IV don't count as the surname.
const ST_SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
const stSortName = new Map();
for (const r of ST.rows) {
  const parts = r[1].split(' ');
  let li = parts.length - 1;
  if (li > 1 && ST_SUFFIX.test(parts[li])) li -= 1;
  const last = parts.slice(li).join(' ');
  const first = parts.slice(0, li).join(' ');
  stSortName.set(r, `${last} ${first}`.trim().toLowerCase());
}

const stTbody = document.getElementById('statsRows');
const stEmptyEl = document.getElementById('statsEmpty');
const stQEcho = document.getElementById('statsQEcho');
const stCountEl = document.getElementById('statsCount');
const stSearchInput = document.getElementById('statsQ');
const stHeaders = Array.from(document.querySelectorAll('.saa-embed th[data-key]'));
const stShell = document.querySelector('.saa-embed .table-shell');

let stSortKey = 'g';
let stSortDir = -1;              // 1 asc, -1 desc
let stQuery = '';
let stFiltered = ST.rows;
let stRendered = 0;
const ST_CHUNK = 150;

function stSortVal(row, key) {
  const v = row[ST_IDX[key]];
  const t = ST_TYPE[key];
  if (t === 'str') return v;
  if (t === 'int') return parseInt(v, 10) || 0;
  if (t === 'rate') { const n = parseFloat(v); return Number.isNaN(n) ? -Infinity : n; }
  return v;                      // 'num' -- already a number
}

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
    // rate-stat sorts keep everyone, but list the "qualified" (1,000+ career
    // AB) ahead of the rest so a 1-for-1 cameo doesn't top the AVG column
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

function stRenderMore() {
  const rows = stFiltered;
  if (stRendered >= rows.length) return;
  const end = Math.min(stRendered + ST_CHUNK, rows.length);
  const html = [];
  for (let i = stRendered; i < end; i++) {
    const r = rows[i];
    let tds = `<td class="name">${r[1]}</td>`;
    for (let c = 1; c < ST.cols.length; c++) {   // skip 'name' (col 0)
      const v = r[ST_IDX[ST.cols[c][0]]];
      tds += `<td>${v === '' || v == null ? '—' : (typeof v === 'number' ? v.toLocaleString('en-US') : v)}</td>`;
    }
    html.push(`<tr>${tds}</tr>`);
  }
  stTbody.insertAdjacentHTML('beforeend', html.join(''));
  stRendered = end;
}

// grow the list as it scrolls near the bottom
if (stShell) {
  stShell.addEventListener('scroll', () => {
    if (stShell.scrollTop + stShell.clientHeight >= stShell.scrollHeight - 240) stRenderMore();
  }, { passive: true });
}

stHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (stSortKey === key) {
      stSortDir *= -1;
    } else {
      stSortKey = key;
      stSortDir = (ST_TYPE[key] === 'str') ? 1 : -1;   // text A→Z, numbers high→low
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

// size the scroll window to ~15 rows + the sticky header
function stSizeScroll() {
  if (!stShell) return;
  const head = stShell.querySelector('thead');
  const row = stShell.querySelector('tbody tr');
  if (!head || !row) return;
  const h = head.getBoundingClientRect().height + row.getBoundingClientRect().height * 15;
  stShell.style.maxHeight = Math.round(h) + 'px';
}

const stPoolEl = document.getElementById('statsPool');
if (stPoolEl) stPoolEl.textContent = ST.count.toLocaleString('en-US');

// mark the default-sorted column
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
