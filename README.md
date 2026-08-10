# The REAL Hall of Fame

A single, merit-ranked list of the 500 greatest players ever to play — hitters and
pitchers together, no position quotas, no reference to the actual Cooperstown Hall.
Every player is scored with the **RHOF Custom Score**, a formula built entirely from
career counting stats — no WAR involved:

```
Hitters  = (AVG − 0.230) × AB + 2 × HR          (AB = Hits / AVG)
Pitchers = (4.20 − ERA) × 3 × (Wins + Losses) + 0.1 × SO + 2 × (Wins − Losses)
```

Hitters earn value for batting above a replacement-level .230 average, scaled by
career at-bats (so a long career at a good clip outscores a short one), plus a flat
bonus per home run. Pitchers earn value for an ERA below a replacement-level 4.20,
scaled by an innings estimate built off career decisions, plus bonuses for strikeouts
and net wins. Both branches land in a comparable range so hitters and pitchers can
share one ladder, but — unlike WAR — there's no defense, baserunning, park, or era
adjustment baked in, so treat cross-era and cross-role comparisons as rough.

## Running it locally

Browsers block `fetch()` on `file://` URLs, so don't just double-click `index.html`.
From this folder, run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Project structure

```
real-hof-site/
├── index.html          # page markup
├── css/style.css        # all styling (design tokens at the top)
├── js/app.js            # loads data, renders plaque cards, filter/sort logic
├── data/players.json    # the roster — edit by hand or regenerate
└── README.md
```

## Data schema (`data/players.json`)

```json
{
  "formula": {
    "name": "RHOF Custom Score",
    "constants": {
      "replacementAvg": 0.230,
      "replacementEra": 4.20,
      "hrBonus": 2,
      "soBonus": 0.1,
      "decisionBonus": 2,
      "inningsPerDecision": 3
    },
    "description": "..."
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
      "stats": { "avg": 0.276, "hits": 2369, "hr": 244 }
                // or, for role: "pitcher" -> { "wins": 417, "losses": 279, "era": 2.17, "so": 3509 }
    }
  ]
}
```

The front end computes each player's RHOF Custom Score and rank at load time from
`stats` and `formula.constants` — nothing is pre-baked, so re-tuning the formula only
requires editing the `constants` object.

**To regenerate this file from the Lahman database:** write a script that pulls each
player's career `avg`, `hits`, `hr` (hitters) or `wins`, `losses`, `era`, `so`
(pitchers) from the Lahman Batting/Pitching tables and dumps the result in the shape
above, capped at (or trimmed to) the top 500 by RHOF Custom Score. As long as the
field names match, the front end needs no changes.

## Extending the site

- **Add players:** append to the `players` array with `role`, `position`, and a
  `stats` object shaped for their role. No code changes needed.
- **Change the formula:** edit `formula.constants` in the JSON. The site recomputes
  every score and re-ranks automatically.

## Deploying

This is a fully static site — no build step, no server-side code. It will run as-is on:

- **GitHub Pages** — push this folder to a repo, enable Pages on the `main` branch
  (or a `/docs` folder), done.
- **Netlify / Vercel** — drag-and-drop the folder or connect the repo.

A custom domain can be attached later on either platform for ~$10-15/yr through any
registrar (Namecheap, Cloudflare, etc.) — it's independent of where you host.
