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

function parseYears(yearsStr) {
  const [start, end] = yearsStr.split(/[–-]/).map(s => parseInt(s.trim(), 10));
  return { start, end };
}

function eraBaseline(start, end) {
  let totalYears = 0;
  const sums = { era: 0, whip: 0, k9: 0, saves: 0, obp: 0, iso: 0, sbValue: 0 };
  state.formula.eraBaselines.forEach(b => {
    const overlapStart = Math.max(start, b.start);
    const overlapEnd = Math.min(end, b.end);
    const years = overlapEnd - overlapStart + 1;
    if (years > 0) {
      totalYears += years;
      sums.era += b.era * years;
      sums.whip += b.whip * years;
      sums.k9 += b.k9 * years;
      sums.saves += b.saves * years;
      sums.obp += b.obp * years;
      sums.iso += b.iso * years;
      sums.sbValue += b.sbValue * years;
    }
  });
  return {
    era: sums.era / totalYears,
    whip: sums.whip / totalYears,
    k9: sums.k9 / totalYears,
    saves: sums.saves / totalYears,
    obp: sums.obp / totalYears,
    iso: sums.iso / totalYears,
    sbValue: sums.sbValue / totalYears,
  };
}

function positionGroup(position) {
  if (position === '1B') return '1B';
  if (position === 'C') return 'C';
  if (position === '2B' || position === '3B' || position === 'SS') return 'IF';
  return 'OF'; // LF, CF, RF
}

function fieldingBaseline(group, start, end) {
  let totalYears = 0;
  let sum = 0;
  state.formula.fieldingBaselines
    .filter(b => b.position === group)
    .forEach(b => {
      const overlapStart = Math.max(start, b.start);
      const overlapEnd = Math.min(end, b.end);
      const years = overlapEnd - overlapStart + 1;
      if (years > 0) {
        totalYears += years;
        sum += b.fieldingPct * years;
      }
    });
  return sum / totalYears;
}

function scorePlayer(p) {
  if (p.role === 'pitcher') {
    const w = state.formula.pitcherWeights;
    const { wins, losses, era, so, ip, bb, hitsAllowed, saves } = p.stats;
    const { start, end } = parseYears(p.years);
    const league = eraBaseline(start, end);

    const whip = (bb + hitsAllowed) / ip;
    const k9 = (so * 9) / ip;
    const eraScore = (league.era / era) * 100;
    const whipScore = (league.whip / whip) * 100;
    const k9Score = (k9 / league.k9) * 100;
    const winsIndex = (wins / (wins + losses)) * 100;
    const savesIndex = (saves / league.saves) * 100;

    const rhofScore = (w.era * eraScore) + (w.whip * whipScore) + (w.k9 * k9Score)
      + (w.wins * winsIndex) + (w.saves * savesIndex);

    return { ...p, rhofScore, whip, k9, league, eraScore, whipScore, k9Score, winsIndex, savesIndex };
  }
  const sbv = state.formula.sbRunValues;
  const hw = state.formula.hitterWeights;
  const { avg, slg, obp, sb, cs, pa, fieldingPct } = p.stats;
  const { start, end } = parseYears(p.years);
  const league = eraBaseline(start, end);
  const group = positionGroup(p.position);
  const posBaseline = fieldingBaseline(group, start, end);

  const iso = slg - avg;
  const netSbValue = ((sb * sbv.sb) + (cs * sbv.cs)) / pa;

  const hitScore = (obp / league.obp) * 100;
  const powerScore = (iso / league.iso) * 100;
  const fieldScore = (fieldingPct / posBaseline) * 100;
  const runScore = 100 + ((netSbValue - league.sbValue) * state.formula.sbValueScale);

  const rhofScore = (hw.hit * hitScore) + (hw.power * powerScore)
    + (hw.field * fieldScore) + (hw.run * runScore);
  return { ...p, rhofScore, iso, netSbValue, league, posBaseline, hitScore, powerScore, fieldScore, runScore };
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
  const pw = state.formula.pitcherWeights;
  const hw = state.formula.hitterWeights;
  formulaBox.innerHTML = `
    <div class="formula-row">
      <span class="formula-term">Hitters</span>
      <span class="formula-eq">=</span>
      <span class="formula-term">${(hw.hit * 100).toFixed(0)}% OBP vs league</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(hw.power * 100).toFixed(0)}% ISO vs league</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(hw.field * 100).toFixed(0)}% Fielding% vs position</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(hw.run * 100).toFixed(0)}% Net SB value vs league</span>
    </div>
    <div class="formula-row">
      <span class="formula-term">Pitchers</span>
      <span class="formula-eq">=</span>
      <span class="formula-term">${(pw.era * 100).toFixed(0)}% ERA vs league</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(pw.whip * 100).toFixed(0)}% WHIP vs league</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(pw.k9 * 100).toFixed(0)}% K/9 vs league</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(pw.wins * 100).toFixed(0)}% Win%</span>
      <span class="formula-plus">+</span>
      <span class="formula-term">${(pw.saves * 100).toFixed(0)}% Saves vs league</span>
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
    <span><b>${p.stats.obp.toFixed(3).replace(/^0/, '')}</b>OBP</span>
    <span><b>${p.stats.slg.toFixed(3).replace(/^0/, '')}</b>SLG</span>
    <span><b>${p.stats.sb}</b>SB</span>
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
        ? `WHIP ${p.whip.toFixed(2)} &nbsp;·&nbsp; K/9 ${p.k9.toFixed(1)} &nbsp;·&nbsp; vs league ERA ${p.league.era.toFixed(2)}/WHIP ${p.league.whip.toFixed(2)}`
        : `Hit ${p.hitScore.toFixed(0)} &nbsp;·&nbsp; Pwr ${p.powerScore.toFixed(0)} &nbsp;·&nbsp; Fld ${p.fieldScore.toFixed(0)} &nbsp;·&nbsp; Run ${p.runScore.toFixed(0)}`}</p>

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
