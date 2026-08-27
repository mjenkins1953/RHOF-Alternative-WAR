# Bat & Glove WAR

A from-scratch career value formula built entirely from box-score hitting and
fielding statistics — no proprietary batted-ball tracking, no scouting
grades — checked against actual career Wins Above Replacement to see how
close plain arithmetic can get to reproducing WAR's real player ranking.

This is a companion/reference project to [`../RHOF`](../RHOF), not a part of
it. RHOF's own **RHOF Custom Score** is deliberately WAR-free (ratio-to-league
composites centered on 100). This project is the opposite experiment: start
from WAR as the target and see how far a hand-built formula can get toward
matching it.

**Current result:** Spearman rank correlation of **0.883** against real
career WAR, across 2,031 players with 3,000+ career plate appearances —
including, as of the 2025 Lahman release, qualifying Negro Leagues players
(Oscar Charleston, Josh Gibson, and others now score and rank alongside
everyone else; Buck Leonard still falls short of the 3,000 PA floor, since
Negro Leagues box scores don't survive as completely).

## The formula

**Batting Value** (Palmer-style linear weights, runs):

```
Bat = 0.47×1B + 0.78×2B + 1.09×3B + 1.40×HR + 0.33×(BB+HBP) + 0.225×SB
      - 0.35×CS - 0.25×(AB−H) + 0.033×PA
```

The last term restores a flat replacement-level credit (≈20 runs/600 PA).
The stolen-base weight (0.225) is deliberately half the value that best fit
real career WAR in a grid search (0.45) — left at full strength it let raw
speed (Rickey Henderson's 1,406 career steals) outrank far better all-around
hitters, so it's dialed back at a small cost to correlation.

**Fielding Value** (runs):

```
Field = Range Runs + Position Runs
```

- **Range Runs**: (chances − league-average chances at that position/year)
  × 0.5 runs, with career totals shrunk toward zero (regressed based on
  playing time) to tame small-sample noise.
- **Position Runs**: a flat credit for how hard the position is to play,
  independent of how well any one player fielded it — the same logic real
  WAR uses. Runs per 150 defensive games: C +12.5, SS +7.5, 2B/3B +2.5,
  CF +2.5, LF/RF −7.5, 1B −12.5, DH −17.5.

**Total** = (Bat + Field) / 10 runs-per-win.

## Three real data gotchas found along the way

1. **Catcher putouts are mostly strikeouts.** A catcher gets a putout credit
   for every strikeout their pitcher throws — that's about the pitching
   staff, not the catcher's glove. Catchers get Position Runs only, no Range
   Runs component.
2. **`InnOuts` (defensive innings) is missing outright for 1911–1953** in
   this data — essentially the Ruth-through-Musial era. Games played × 9
   stands in for innings there.
3. **DH isn't a fielding position**, so it has zero rows in `Fielding.csv` —
   David Ortiz's 2,130 career games at DH were completely invisible to the
   model until DH time was backed into as (games batted − games actually
   fielded anywhere) and given its own (very negative) position credit.

## Files

```
bat_and_glove_war.html          the page — open directly in a browser, no server needed
build_formula.py                regenerates everything below from source data
formula_with_fielding_full.csv  all 1,912 qualifying players, full detail
top_300_formula.csv             top 300 by formula_WAR
comparison_top30.json           top-30 both ways — this is what's embedded in the HTML page
```

Raw source data (`Batting.csv`, `People.csv`, `Fielding.csv`,
`war_daily_bat.txt`, `war_daily_pitch.txt`) is intentionally **not** kept in
this folder and is gitignored. `war_daily_bat.txt`/`war_daily_pitch.txt` are
always fetched fresh by `build_formula.py`. `Batting.csv`/`People.csv`/
`Fielding.csv` currently on disk were exported locally from a **Lahman 2025
Access database** (`Lahman_2025.mdb`, also gitignored) rather than fetched
from `build_formula.py`'s default GitHub mirror — see "Data sources" below
for why that matters.

## Regenerating

```bash
pip3 install pandas scipy
python3 build_formula.py
```

Skips re-fetching any of the five source files already present, rebuilds the
two CSVs and the comparison JSON, and prints the current Spearman
correlation. To push updated numbers into the HTML page, replace the
`const DATA = {...}` line in `bat_and_glove_war.html`'s `<script>` with the
contents of `comparison_top30.json`.

**Careful:** if `Batting.csv`, `People.csv`, or `Fielding.csv` ever get
deleted, `build_formula.py` will silently re-fetch its default source (an
old GitHub mirror frozen on 2022-10-31, predating Negro Leagues statistical
integration and several recent MLB seasons) instead of regenerating from
`Lahman_2025.mdb`. If that happens and you still have the `.mdb` on hand,
regenerate the three CSVs first:

```bash
pip3 install access_parser
python3 -c "
from access_parser import AccessParser
import csv
db = AccessParser('Lahman_2025.mdb')
def export(table, filename, cols):
    data = db.parse_table(table)
    with open(filename, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for row in zip(*[data[c] for c in cols]):
            w.writerow(['' if v is None else v for v in row])
export('Batting', 'Batting.csv',
       ['playerID','yearID','stint','teamID','lgID','G','AB','R','H','2B','3B','HR','RBI','SB','CS','BB','SO','IBB','HBP','SH','SF','GIDP'])
export('Fielding', 'Fielding.csv',
       ['playerID','yearID','stint','teamID','lgID','POS','G','GS','InnOuts','PO','A','E','DP','PB','WP','SB','CS','ZR'])
export('People', 'People.csv',
       ['playerID','birthYear','birthMonth','birthDay','deathYear','deathMonth','deathDay',
        'nameFirst','nameLast','nameGiven','weight','height','bats','throws','debut','bbrefID','finalGame','retroID'])
"
```

then run `build_formula.py` as usual.

## Data sources

- Hitting/fielding: a **Lahman 2025 Access database** (`Lahman_2025.mdb`),
  which folds in Negro Leagues statistics per MLB's 2020 recognition
  decision. `build_formula.py`'s own default fetch (Chadwick Bureau's
  continuation of the Lahman database, via a GitHub mirror) is a snapshot
  frozen on 2022-10-31 that predates both that integration and several
  recent MLB seasons — it's kept as the automatic fallback, but the CSVs
  actually in this folder right now come from the newer `.mdb` export
  described above.
- Real WAR: Baseball-Reference's published career WAR component files
  (`war_daily_bat.txt`, `war_daily_pitch.txt`) — pitching WAR is added onto
  two-way players' totals (e.g. Ruth) to match the public career leaderboard.
  Baseball-Reference's own WAR coverage already extends to qualifying Negro
  Leagues players, so no additional real-WAR source was needed for them.
- The qualifying pool excludes players classified as primarily pitchers
  (batting-side WAR component < pitching-side WAR component), matching the
  "position player" leaderboard convention.
