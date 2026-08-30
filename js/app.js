// THE TRUE HALL OF FAME
// Loads data/players.json, computes each player's SAA (Stat Above Average), ranks, renders.

const state = {
  players: [],
  formula: null,
  capacity: 500,
};

const formulaBox = document.getElementById('formulaBox');

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
  } catch (err) {
    console.error('RHOF: could not load player data —', err);
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
  if (position === 'DH') return 'DH';
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
    const winsIndex = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
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
  // DH doesn't field at all -- there's no positional fielding baseline to
  // compare against, so DH gets a flat 0 (no defensive value), not a
  // crash or a silent NaN from dividing by an undefined baseline.
  const posBaseline = group === 'DH' ? null : fieldingBaseline(group, start, end);

  const iso = slg - avg;
  const netSbValue = ((sb * sbv.sb) + (cs * sbv.cs)) / pa;

  const hitScore = (obp / league.obp) * 100;
  const powerScore = (iso / league.iso) * 100;
  const fieldScore = group === 'DH' ? 0 : (fieldingPct / posBaseline) * 100;
  const runScore = 100 + ((netSbValue - league.sbValue) * state.formula.sbValueScale);

  const rhofScore = (hw.hit * hitScore) + (hw.power * powerScore)
    + (hw.field * fieldScore) + (hw.run * runScore);
  return { ...p, rhofScore, iso, netSbValue, league, posBaseline, hitScore, powerScore, fieldScore, runScore };
}

function renderFormula() {
  const pw = state.formula.pitcherWeights;
  const hw = state.formula.hitterWeights;
  formulaBox.innerHTML = `
    <p class="formula-desc formula-desc--lede">${escapeHtml(state.formula.hitterDescription)}</p>
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
    <hr class="formula-divider">
    <p class="formula-desc formula-desc--lede">${escapeHtml(state.formula.pitcherDescription)}</p>
    <div class="formula-row formula-row--last">
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
  `;
}

loadData();
