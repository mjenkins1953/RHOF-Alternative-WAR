// THE REAL HALL OF FAME
// Loads data/players.json, computes each player's RHOF Score, ranks, renders.

const state = {
  players: [],
  formula: null,
  capacity: 500,
  role: 'all',
  sort: 'scoreDesc',
};

const grid = document.getElementById('plaqueGrid');
const formulaBox = document.getElementById('formulaBox');
const heroStrip = document.getElementById('heroStrip');

async function loadData() {
  try {
    const res = await fetch('data/players.json');
    if (!res.ok) throw new Error('Failed to load player data');
    const data = await res.json();
    state.formula = data.formula;
    state.capacity = data.capacity;
    state.players = data.players.map(scorePlayer);
    state.players.sort((a, b) => b.rhofScore - a.rhofScore);
    state.players.forEach((p, i) => { p.rank = i + 1; });
    renderFormula();
    renderHeroStrip();
    render();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">
      Couldn't load the roster (${escapeHtml(err.message)}).<br>
      If you're viewing this as a local file, serve it with a local HTTP server
      (e.g. <code>python3 -m http.server</code>) — browsers block fetch() on file:// URLs.
    </div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function scorePlayer(p) {
  const c = state.formula.constants;
  if (p.role === 'pitcher') {
    const { wins, losses, era, so } = p.stats;
    const decisions = wins + losses;
    const inningsProxy = decisions * c.inningsPerDecision;
    const rhofScore = (c.replacementEra - era) * inningsProxy
      + (c.soBonus * so)
      + (c.decisionBonus * (wins - losses));
    return { ...p, rhofScore, inningsProxy };
  }
  const { avg, hits, hr } = p.stats;
  const ab = hits / avg;
  const rhofScore = ((avg - c.replacementAvg) * ab) + (c.hrBonus * hr);
  return { ...p, rhofScore, ab };
}

function renderHeroStrip() {
  const total = state.players.length;
  const pitchers = state.players.filter(p => p.role === 'pitcher').length;
  const top = state.players[0];
  heroStrip.innerHTML = `
    <span><b>${total}</b> players on file (of ${state.capacity} spots)</span>
    <span><b>${pitchers}</b> pitchers ranked in the same list as hitters</span>
    <span><b>#1</b> ${escapeHtml(top.name)}, RHOF Score ${top.rhofScore.toFixed(1)}</span>
  `;
}

function renderFormula() {
  const c = state.formula.constants;
  formulaBox.innerHTML = `
    <div class="formula-row">
      <span class="formula-term">Hitters</span>
      <span class="formula-eq">=</span>
      <span class="formula-term">(AVG − ${c.replacementAvg.toFixed(3)}) × AB</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${c.hrBonus} × HR</span>
    </div>
    <div class="formula-row">
      <span class="formula-term">Pitchers</span>
      <span class="formula-eq">=</span>
      <span class="formula-term">(${c.replacementEra.toFixed(2)} − ERA) × ${c.inningsPerDecision} × Decisions</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${c.soBonus} × SO</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${c.decisionBonus} × (W − L)</span>
    </div>
    <p class="formula-desc">${escapeHtml(state.formula.description)}</p>
  `;
}

function applyFilters(players) {
  return players.filter(p => state.role === 'all' || p.role === state.role);
}

function applySort(players) {
  const arr = [...players];
  switch (state.sort) {
    case 'scoreDesc': return arr.sort((a, b) => b.rhofScore - a.rhofScore);
    case 'name': return arr.sort((a, b) => a.name.localeCompare(b.name));
    default: return arr;
  }
}

function statLine(p) {
  if (p.role === 'pitcher') {
    return `
      <span><b>${p.stats.wins}-${p.stats.losses}</b>W-L</span>
      <span><b>${p.stats.era.toFixed(2)}</b>ERA</span>
      <span><b>${p.stats.so.toLocaleString()}</b>SO</span>
    `;
  }
  return `
    <span><b>${p.stats.avg.toFixed(3).replace(/^0/, '')}</b>AVG</span>
    <span><b>${p.stats.hits.toLocaleString()}</b>H</span>
    <span><b>${p.stats.hr}</b>HR</span>
  `;
}

function plaqueCard(p) {
  const maxScore = state.players[0].rhofScore;
  const pct = Math.max(4, Math.round((p.rhofScore / maxScore) * 100));

  return `
    <article class="plaque" data-role="${p.role}">
      <span class="plaque__flag">#${p.rank}</span>
      <h3 class="plaque__name">${escapeHtml(p.name)}</h3>
      <p class="plaque__meta">${escapeHtml(p.position)} · ${escapeHtml(p.team)} · ${escapeHtml(p.years)}</p>

      <div class="plaque__jaws">
        <span class="plaque__jaws-num">${p.rhofScore.toFixed(1)}</span>
        <span class="plaque__jaws-label">RHOF Score</span>
      </div>
      <div class="plaque__bar-track">
        <div class="plaque__bar-fill above" style="width:${pct}%"></div>
      </div>
      <p class="plaque__bar-caption">${p.role === 'pitcher'
        ? `IP≈${Math.round(p.inningsProxy).toLocaleString()} &nbsp;·&nbsp; ERA edge ${(state.formula.constants.replacementEra - p.stats.era).toFixed(2)}`
        : `AB≈${Math.round(p.ab).toLocaleString()} &nbsp;·&nbsp; AVG edge +${(p.stats.avg - state.formula.constants.replacementAvg).toFixed(3).replace('+-', '-')}`}</p>

      <div class="plaque__statline">
        ${statLine(p)}
      </div>
    </article>
  `;
}

function render() {
  const filtered = applyFilters(state.players);
  const sorted = applySort(filtered);
  if (sorted.length === 0) {
    grid.innerHTML = `<div class="empty-state">No one on file matches those filters.</div>`;
    return;
  }
  grid.innerHTML = sorted.map(plaqueCard).join('');
}

document.getElementById('roleFilter').addEventListener('change', e => {
  state.role = e.target.value;
  render();
});
document.getElementById('sortBy').addEventListener('change', e => {
  state.sort = e.target.value;
  render();
});

loadData();
