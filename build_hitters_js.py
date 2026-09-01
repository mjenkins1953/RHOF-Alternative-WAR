"""Regenerate the hitters-list JS for the site from saa_full.csv.

Produces:
  - saa_top_300_hitters.csv         (top 300 slice)
  - js/hitters-embed.js  SAA_DATA    (300 rows: rank/name/pa/seasons/saa/total/peak/z*/hof/nel)
  - js/saa-career.js     SAA_CAREER  (career box-score line per rank, 1..300)

saa_full.csv is the ranked pool from build_saa.py (SAA_final = the JAWS-style
average of career total and best-7-season peak, weighted z's). Bump N here and
build_saa.py's tail to change the list length.
"""
import csv
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from build_cards import hitter_cards

HERE = Path(__file__).resolve().parent
N = 300
BUBBLE_N = 20   # ranks N+1 .. N+BUBBLE_N shown in the "On the bubble" strip

# ---- HoF: playerIDs inducted as a Player ----
hof = set()
for r in csv.DictReader(open(HERE / "HallOfFame.csv")):
    if r["inducted"] == "Y" and r["category"] == "Player":
        hof.add(r["playerID"])

full = list(csv.DictReader(open(HERE / "saa_full.csv")))
top = full[:N]

# ---- top-N csv ----
with open(HERE / f"saa_top_{N}_hitters.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=full[0].keys())
    w.writeheader()
    w.writerows(top)

# ---- SAA_DATA ----
saa_data = []
for r in top:
    saa_data.append({
        "rank": int(r["rank_saa"]),
        "name": r["name"],
        "pa": int(round(float(r["career_PA"]))),
        "seasons": int(round(float(r["qualifying_seasons"]))),
        "saa": round(float(r["SAA_final"]), 2),
        "total": round(float(r["SAA_total"]), 2),
        "peak": round(float(r["SAA_peak"]), 2),
        "avg": round(float(r["z_AVG_career"]), 2),
        "iso": round(float(r["z_ISO_career"]), 2),
        "bb": round(float(r["z_BB_career"]), 2),
        "sb": round(float(r["z_SB_career"]), 2),
        "def": round(float(r["z_DEF_career"]), 2),
        "hof": r["playerID"] in hof,
        # NeL flag = Negro Leagues seasons actually feed this player's ranking
        # (a 200+ PA qualifying season in a Negro Major League), not merely a
        # cameo appearance -- see build_saa.py's is_nel_ranked.
        "nel": r["is_nel_ranked"] == "True",
    })

# ---- SAA_BUBBLE: the next BUBBLE_N, just outside the cut ----
bubble = [{
    "rank": int(r["rank_saa"]),
    "name": r["name"],
    "saa": round(float(r["SAA_final"]), 2),
    "hof": r["playerID"] in hof,
    "nel": r["is_nel_ranked"] == "True",
} for r in full[N:N + BUBBLE_N]]

# ---- SAA_MISSING: HoF hitters who qualified for the pool but rank outside the cut ----
# (excludes anyone already honoured on the pitchers list, e.g. two-way players)
try:
    pit_top_ids = {r["playerID"] for r in
                   list(csv.DictReader(open(HERE / "saa_top_150_pitchers.csv")))}
except FileNotFoundError:
    pit_top_ids = set()
missing = []
for r in full[N:]:
    if r["playerID"] not in hof or r["playerID"] in pit_top_ids:
        continue
    missing.append({
        "rank": int(r["rank_saa"]),
        "name": r["name"],
        "pa": int(round(float(r["career_PA"]))),
        "seasons": int(round(float(r["qualifying_seasons"]))),
        "saa": round(float(r["SAA_final"]), 2),
        "total": round(float(r["SAA_total"]), 2),
        "peak": round(float(r["SAA_peak"]), 2),
        "avg": round(float(r["z_AVG_career"]), 2),
        "iso": round(float(r["z_ISO_career"]), 2),
        "bb": round(float(r["z_BB_career"]), 2),
        "sb": round(float(r["z_SB_career"]), 2),
        "def": round(float(r["z_DEF_career"]), 2),
        "hof": True,
        "nel": r["is_nel_ranked"] == "True",
    })

embed_path = HERE / "js/hitters-embed.js"
src = embed_path.read_text()
new_line = "const SAA_DATA = " + json.dumps(saa_data, separators=(",", ":")) + ";"
src, n = re.subn(r"const SAA_DATA = \[.*?\];", lambda _m: new_line, src, count=1, flags=re.S)
assert n == 1, "could not find SAA_DATA array in hitters-embed.js"
bub_line = "const SAA_BUBBLE = " + json.dumps(bubble, separators=(",", ":")) + ";"
src, n = re.subn(r"const SAA_BUBBLE = \[.*?\];", lambda _m: bub_line, src, count=1, flags=re.S)
assert n == 1, "could not find SAA_BUBBLE array in hitters-embed.js"
miss_line = "const SAA_MISSING = " + json.dumps(missing, separators=(",", ":")) + ";"
src, n = re.subn(r"const SAA_MISSING = \[.*?\];", lambda _m: miss_line, src, count=1, flags=re.S)
assert n == 1, "could not find SAA_MISSING array in hitters-embed.js"
embed_path.write_text(src)
print(f"js/hitters-embed.js: SAA_DATA -> {len(saa_data)} rows "
      f"({sum(d['hof'] for d in saa_data)} HoF, {sum(d['nel'] for d in saa_data)} NeL), "
      f"SAA_BUBBLE -> {len(bubble)} (#{bubble[0]['rank']}-{bubble[-1]['rank']}), "
      f"SAA_MISSING -> {len(missing)} HoF outside the top {N}")

# ---- SAA_CAREER (career box-score line per rank, 1..N) ----
top_df = pd.read_csv(HERE / f"saa_top_{N}_hitters.csv")
war_fallback = dict(zip(top_df["playerID"], top_df["real_WAR"].astype(float)))
cards = hitter_cards(set(top_df["playerID"]), war_fallback)
out = {int(row["rank_saa"]): cards[row["playerID"]]
       for _, row in top_df.iterrows() if row["playerID"] in cards}

(HERE / "js/saa-career.js").write_text(
    f"// Career box-score lines for the Top {N} SAA hitters, keyed by SAA rank.\n"
    "// Generated by build_hitters_js.py from Lahman Batting/Fielding + BBRef WAR.\n"
    "const SAA_CAREER = " + json.dumps(out, separators=(",", ":")) + ";\n"
)
print(f"js/saa-career.js: SAA_CAREER -> {len(out)} players")

# ---- career lines for whoever now just misses the cut (the "leaves out" writeup) ----
# Console diagnostic only -- writes nothing; used when drafting the writeup.
_num = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SF", "SH"]
bbref = pd.read_csv(HERE / "People.csv").set_index("playerID")["bbrefID"].to_dict()
just_miss = [r["name"] for r in full[N:N + 20]]
_jm_ids = {r["playerID"] for r in full if r["name"] in just_miss}
bb = pd.read_csv(HERE / "Batting.csv")
for c in _num:
    bb[c] = pd.to_numeric(bb[c], errors="coerce").fillna(0)
bb = bb[bb["playerID"].isin(_jm_ids)]
_jm_war = pd.read_csv(HERE / "war_daily_bat.txt")
_jm_war["WAR"] = pd.to_numeric(_jm_war["WAR"], errors="coerce").fillna(0)
_jm_war["PA"] = pd.to_numeric(_jm_war["PA"], errors="coerce").fillna(0)
_jm_war["OPS_plus"] = pd.to_numeric(_jm_war["OPS_plus"], errors="coerce")
_jm_war["player_ID"] = _jm_war["player_ID"].map({v: k for k, v in bbref.items()}).fillna(_jm_war["player_ID"])
for name in just_miss:
    prow = next(r for r in full if r["name"] == name)
    d = bb[bb["playerID"] == prow["playerID"]]
    ab, h = d["AB"].sum(), d["H"].sum()
    ww = _jm_war[_jm_war["player_ID"] == prow["playerID"]]
    m = ww["OPS_plus"].notna() & (ww["PA"] > 0)
    op = round(float(np.average(ww.loc[m, "OPS_plus"], weights=ww.loc[m, "PA"]))) if m.any() else None
    print(f"#{prow['rank_saa']:>3} {name:<20} AVG {h/ab:.3f}  OPS+ {op}  H {int(h)}  "
          f"HR {int(d['HR'].sum())}  SB {int(d['SB'].sum())}  bWAR {ww['WAR'].sum():.1f}  "
          f"| z AVG {float(prow['z_AVG_career']):+.2f} ISO {float(prow['z_ISO_career']):+.2f} "
          f"BB {float(prow['z_BB_career']):+.2f} SB {float(prow['z_SB_career']):+.2f} "
          f"DEF {float(prow['z_DEF_career']):+.2f}")
