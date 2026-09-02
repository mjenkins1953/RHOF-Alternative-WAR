// Renders the Validation page from the VALIDATION global (js/validation-data.js).
// Four pieces: the correlation ladder, the Hall-of-Fame hit-rate table, the
// SAA-vs-bWAR scatter (with hover), and the two "biggest disagreement" columns.
(function () {
  if (typeof VALIDATION === 'undefined') return;
  const V = VALIDATION;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- fill the running totals in the prose ----
  document.querySelectorAll('[data-v="pool_n"]').forEach((e) => { e.textContent = V.pool_n.toLocaleString(); });
  document.querySelectorAll('[data-v="hof_n"]').forEach((e) => { e.textContent = V.hof_n; });
  document.querySelectorAll('[data-v="scatter_n"]').forEach((e) => { e.textContent = V.scatter_n; });
  document.querySelectorAll('[data-v="scatter_floor"]').forEach((e) => { e.textContent = V.scatter_floor; });

  // ---- correlation ladder ----
  const ladder = $('corrLadder');
  if (ladder) {
    let h = '<div class="corr-row corr-row--head">'
      + '<span>Compared across…</span><span>vs bWAR</span><span>vs bWAA</span><span>vs JAWS</span></div>';
    V.corr.forEach((r) => {
      const cell = (val, mod) => {
        const pct = Math.max(0, (val - 0.4)) / 0.6 * 100; // 0.4–1.0 → 0–100%
        return `<div class="corr-cell${mod || ''}" style="--w:${pct.toFixed(0)}%">${val.toFixed(2)}</div>`;
      };
      h += '<div class="corr-row">'
        + `<div class="corr-row__label">${esc(r.label)}<small>${r.n.toLocaleString()} players</small></div>`
        + cell(r.war) + cell(r.waa, ' corr-cell--waa') + cell(r.jaws)
        + '</div>';
    });
    ladder.innerHTML = h;
  }

  // ---- Hall-of-Fame hit-rate table ----
  const hr = $('hitRate');
  if (hr) {
    let h = '<thead><tr><th>Top N by…</th><th>SAA</th><th>bWAR</th><th>bWAA</th><th>JAWS</th></tr></thead><tbody>';
    V.hof.forEach((r) => {
      h += `<tr><td>top ${r.n}</td>`
        + `<td class="hitrate__saa">${r.saa}</td><td>${r.war}</td><td>${r.waa}</td><td>${r.jaws}</td></tr>`;
    });
    h += '</tbody>';
    hr.innerHTML = h;
  }

  // ---- spotlight table ----
  const sp = $('spotlightTable');
  if (sp && V.spotlight) {
    let h = '<thead><tr><th>Player</th><th>SAA</th><th>bWAR</th><th>bWAA</th><th>JAWS</th><th>Defense z</th></tr></thead><tbody>';
    V.spotlight.forEach((r) => {
      const dz = (r.def_z >= 0 ? '+' : '') + r.def_z.toFixed(2);
      h += `<tr><td class="spot-name">${esc(r.nm)}</td>`
        + `<td class="spot-saa">${r.saa}</td><td>${r.war}</td><td>${r.waa}</td><td>${r.jaws}</td><td>${dz}</td></tr>`;
    });
    h += '</tbody>';
    sp.innerHTML = h;
  }

  // ---- disagreement columns ----
  function fillCol(elId, rows) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = rows.map((r) => {
      const star = r.hof ? ' <span class="hof-star">★</span>' : '';
      return '<div class="disagree-item">'
        + '<div class="disagree-item__top">'
        + `<span class="disagree-item__name">${esc(r.nm)}${star}</span>`
        + `<span class="disagree-item__ranks">SAA <b>#${r.saa}</b> · bWAR #${r.war} · bWAA #${r.waa} · JAWS #${r.jaws}</span>`
        + '</div>'
        + `<p class="disagree-item__why">${esc(r.why)}</p>`
        + '</div>';
    }).join('');
  }
  fillCol('disagreeWar', V.war_over_saa);
  fillCol('disagreeSaa', V.saa_over_war);

  // ---- scatter ----
  const svg = $('scatterSvg');
  const tip = $('scatterTip');
  if (svg && V.scatter && V.scatter.length) {
    const NS = 'http://www.w3.org/2000/svg';
    const N = V.scatter_n;
    const W = 720, H = 560;
    const m = { l: 62, r: 18, t: 16, b: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const sx = (v) => m.l + (v - 1) / (N - 1) * iw;
    const sy = (v) => m.t + (v - 1) / (N - 1) * ih;
    const mk = (name, attrs, parent) => {
      const e = document.createElementNS(NS, name);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(e);
      return e;
    };

    // axes
    mk('line', { class: 'axis-line', x1: m.l, y1: m.t, x2: m.l, y2: m.t + ih });
    mk('line', { class: 'axis-line', x1: m.l, y1: m.t + ih, x2: m.l + iw, y2: m.t + ih });
    // "these two systems agree" diagonal
    mk('line', { class: 'agree-line', x1: sx(1), y1: sy(1), x2: sx(N), y2: sy(N) });

    // ticks
    [1, Math.round(N / 4), Math.round(N / 2), Math.round(3 * N / 4), N].forEach((t) => {
      mk('text', { class: 'tick-label', x: sx(t), y: m.t + ih + 16, 'text-anchor': 'middle' }).textContent = t;
      mk('text', { class: 'tick-label', x: m.l - 8, y: sy(t) + 3, 'text-anchor': 'end' }).textContent = t;
    });
    mk('text', { class: 'axis-label', x: m.l + iw / 2, y: H - 8, 'text-anchor': 'middle' })
      .textContent = 'Rank by bWAR  →  worse';
    const yl = mk('text', { class: 'axis-label', x: 14, y: m.t + ih / 2, 'text-anchor': 'middle',
      transform: `rotate(-90 14 ${m.t + ih / 2})` });
    yl.textContent = 'Rank by SAA  →  worse';

    // which-way labels
    mk('text', { class: 'band-label', x: sx(N) - 4, y: sy(1) + 14, 'text-anchor': 'end' })
      .textContent = 'SAA rates them higher';
    mk('text', { class: 'band-label', x: sx(1) + 6, y: sy(N) - 6, 'text-anchor': 'start' })
      .textContent = 'bWAR rates them higher';

    // dots — field first (context), Hall of Famers on top (highlight)
    const rows = V.scatter.slice().sort((a, b) => (a.h === b.h ? 0 : a.h ? 1 : -1));
    rows.forEach((d) => {
      const cx = sx(d.x), cy = sy(d.y);
      mk('circle', { class: d.h ? 'dot-hof' : 'dot-field', cx, cy, r: d.h ? 3.4 : 2.6 });
      const hit = mk('circle', { class: 'dot-hit', cx, cy, r: 7 });
      hit.addEventListener('mouseenter', () => {
        tip.innerHTML = `<b>${esc(d.nm)}</b>${d.h ? ' ★' : ''}`
          + `<span>SAA #${d.y}  ·  bWAR #${d.x}  (of ${N})</span>`;
        tip.style.opacity = '1';
        const box = svg.getBoundingClientRect();
        const px = box.left + window.scrollX + (cx / W) * box.width;
        const py = box.top + window.scrollY + (cy / H) * box.height;
        tip.style.left = `${px + 12}px`;
        tip.style.top = `${py - 10}px`;
      });
      hit.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
    });
  }
})();
