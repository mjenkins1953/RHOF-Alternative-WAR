# The TRUE Hall of Fame

A single, merit-ranked list of the greatest players ever to play — hitters and
pitchers together, no position quotas, no reference to the actual Cooperstown
Hall. Every player is scored with the **RHOF Custom Score**, a formula built
entirely from career stats benchmarked against the league averages and
positional norms of the exact years and position that player played — no WAR
involved, and no single fixed "replacement level" applied blindly across
every era.

```
Pitchers = 0.25 × eraScore + 0.25 × whipScore + 0.20 × k9Score
           + 0.20 × winsIndex + 0.10 × savesIndex

Hitters  = 0.35 × hitScore + 0.35 × powerScore
           + 0.15 × fieldScore + 0.15 × runScore
```

Each component is a ratio (or, for stolen-base value, a difference) against
a league baseline for that player's specific years and position — a
dead-ball-era line is judged against dead-ball-era competition, not a modern
one. League and positional-fielding baselines are blended across whichever
era buckets overlap a player's career, so someone who played across two
regimes gets a proportional blend instead of one arbitrary constant.

See `data/players.json`'s `formula._schema_notes` for the exact per-stat
formulas, weights, and the caveats behind them (including why stolen-base
value is scored as a difference from league rather than a ratio).

## Running it locally

Browsers block `fetch()` on `file://` URLs, so don't just double-click
`index.html`. From this folder, run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Project structure

```
index.html          # page markup
css/style.css        # all styling (design tokens at the top)
js/app.js            # loads data, computes scores, renders plaque cards, filter/sort logic
data/players.json    # the roster and formula — edit by hand or regenerate
README.md
```

(This folder also hosts a separate, unrelated data-analysis project — see
`ANALYSIS.md` — that isn't part of the website itself.)

## Data schema (`data/players.json`)

```json
{
  "formula": {
    "name": "RHOF Custom Score",
    "hitterWeights": { "hit": 0.35, "power": 0.35, "field": 0.15, "run": 0.15 },
    "pitcherWeights": { "era": 0.25, "whip": 0.25, "k9": 0.2, "wins": 0.2, "saves": 0.1 },
    "sbRunValues": { "sb": 0.2, "cs": -0.4 },
    "sbValueScale": 15000,
    "eraBaselines": [ { "start": 1876, "end": 1899, "era": 4.1, "whip": 1.45, "...": "..." } ],
    "fieldingBaselines": [ { "position": "1B", "start": 1876, "end": 1919, "fieldingPct": 0.973 } ]
  },
  "capacity": 500,
  "players": [
    {
      "id": "unique-slug",
      "name": "Player Name",
      "role": "hitter" | "pitcher",
      "position": "2B" | "P" | etc,
      "years": "1977–1995",
      "team": "Team Name",
      "stats": { "avg": 0.276, "hits": 2369, "hr": 244, "obp": 0.360, "slg": 0.433, "sb": 22, "cs": 9, "pa": 9967, "fieldingPct": 0.984 }
                // or, for role: "pitcher" -> { "wins": 417, "losses": 279, "era": 2.17, "so": 3509, "ip": 5914.1, "bb": 1363, "hitsAllowed": 4913, "saves": 34 }
    }
  ]
}
```

The front end computes each player's RHOF Custom Score and rank at load time
from `stats` and the era/position baselines — nothing is pre-baked, so
re-tuning the formula only requires editing `formula` in the JSON.

**To regenerate this file from the Lahman database:** pull each player's
career `avg`/`hits`/`hr`/`obp`/`slg`/`sb`/`cs`/`pa`/`fieldingPct` (hitters) or
`wins`/`losses`/`era`/`so`/`ip`/`bb`/`hitsAllowed`/`saves` (pitchers), keeping
these exact field names. As long as the field names match, the front end
needs no changes.

## Extending the site

- **Add players:** append to the `players` array with `role`, `position`, and
  a `stats` object shaped for their role. No code changes needed.
- **Change the formula:** edit `formula` (weights or baselines) in the JSON.
  The site recomputes every score and re-ranks automatically.

## Deploying

This is a fully static site — no build step, no server-side code. It will
run as-is on:

- **GitHub Pages** — push this folder to a repo, enable Pages on the `main`
  branch (or a `/docs` folder), done.
- **Netlify / Vercel** — drag-and-drop the folder or connect the repo.

A custom domain can be attached later on either platform for ~$10-15/yr
through any registrar (Namecheap, Cloudflare, etc.) — it's independent of
where you host.
