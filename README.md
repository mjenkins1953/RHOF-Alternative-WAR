# The REAL Hall of Fame

A single, merit-ranked list of the 500 greatest players ever to play — hitters and
pitchers together, no position quotas, no reference to the actual Cooperstown Hall.
Every player is scored with the **RHOF Score**:

```
RHOF Score = (0.50 × Career WAR) + (0.35 × WAR7) + (0.15 × WAR3)
```

Career WAR rewards a long, valuable career. WAR7 (best 7 seasons) rewards a genuinely
great prime. WAR3 (best 3 seasons) rewards peak dominance even if it was brief. Because
WAR is already computed on one shared scale for hitters and pitchers, nothing needs
position-adjusting — everyone is ranked on the same ladder.

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
    "name": "RHOF Score",
    "weights": { "careerWAR": 0.50, "war7": 0.35, "war3": 0.15 },
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
      "war": 75.0,
      "war7": 37.9,
      "war3": 18.9,
      "stats": { "avg": 0.276, "hits": 2369, "hr": 244 }
                // or, for role: "pitcher" -> { "wins": 417, "losses": 279, "era": 2.17, "so": 3509 }
    }
  ]
}
```

The front end computes each player's RHOF Score and rank at load time from `war`,
`war7`, `war3`, and the `formula.weights` — nothing is pre-baked, so re-sorting or
re-weighting only requires editing the `weights` object.

**To regenerate this file from the Lahman database:** write a script that computes
`war` (career WAR), `war7` (sum of a player's best 7 WAR seasons), and `war3` (sum of
their best 3 WAR seasons) per player, for both hitters and pitchers, and dumps the
result in the shape above, capped at (or trimmed to) the top 500 by RHOF Score. As
long as the field names match, the front end needs no changes.

## Extending the site

- **Add players:** append to the `players` array with `role`, `position`, `war`,
  `war7`, `war3`, and a `stats` object shaped for their role. No code changes needed.
- **Change the formula:** edit `formula.weights` in the JSON. The site recomputes
  every score and re-ranks automatically.

## Deploying

This is a fully static site — no build step, no server-side code. It will run as-is on:

- **GitHub Pages** — push this folder to a repo, enable Pages on the `main` branch
  (or a `/docs` folder), done.
- **Netlify / Vercel** — drag-and-drop the folder or connect the repo.

A custom domain can be attached later on either platform for ~$10-15/yr through any
registrar (Namecheap, Cloudflare, etc.) — it's independent of where you host.
