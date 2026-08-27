"""Regenerate the hitters-list JS for the site from saa_full.csv.

Produces:
  - saa_top_300_hitters.csv         (top 300 slice)
  - js/hitters-embed.js  SAA_DATA    (300 rows: rank/name/pa/seasons/saa/rate/z*/hof/nel)
  - js/saa-career.js     SAA_CAREER  (career box-score line per rank, 1..300)

saa_full.csv is the committed full ranked pool from build_saa.py; taking the
top N from it reproduces the previously-committed numbers exactly (no pipeline
drift). Bump N here (and build_saa.py's tail) to change the list length.
"""
import csv
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path("/Users/martinjenkins/Personal/Claude Projects/RHOF Alternative War")
N = 300

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
        "saa": round(float(r["SAA_total"]), 2),
        "rate": round(float(r["SAA_rate"]), 3),
        "avg": round(float(r["z_AVG_career"]), 2),
        "iso": round(float(r["z_ISO_career"]), 2),
        "bb": round(float(r["z_BB_career"]), 2),
        "sb": round(float(r["z_SB_career"]), 2),
        "def": round(float(r["z_DEF_career"]), 2),
        "hof": r["playerID"] in hof,
        "nel": r["is_negro_leaguer"] == "True",
    })

embed_path = HERE / "js/hitters-embed.js"
src = embed_path.read_text()
new_line = "const SAA_DATA = " + json.dumps(saa_data, separators=(",", ":")) + ";"
src, n = re.subn(r"const SAA_DATA = \[.*?\];", lambda _m: new_line, src, count=1, flags=re.S)
assert n == 1, "could not find SAA_DATA array in hitters-embed.js"
embed_path.write_text(src)
print(f"js/hitters-embed.js: SAA_DATA -> {len(saa_data)} rows "
      f"({sum(d['hof'] for d in saa_data)} HoF, {sum(d['nel'] for d in saa_data)} NeL)")

# ---- SAA_CAREER (build_saa_cards.py logic, N rows) ----
top_df = pd.read_csv(HERE / f"saa_top_{N}_hitters.csv")
ids = set(top_df["playerID"])

bat = pd.read_csv(HERE / "Batting.csv")
num = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SF", "SH"]
for c in num:
    bat[c] = pd.to_numeric(bat[c], errors="coerce").fillna(0)
bat["yearID"] = pd.to_numeric(bat["yearID"], errors="coerce")
bat["PA"] = bat["AB"] + bat["BB"] + bat["HBP"] + bat["SF"] + bat["SH"]
b = bat[bat["playerID"].isin(ids)]
gb = b.groupby("playerID")
car = gb[num].sum()

seas_pa = b.groupby(["playerID", "yearID"])["PA"].sum()
qpa = seas_pa[seas_pa >= 200].groupby("playerID").sum()
car["yr_min"] = gb["yearID"].min()
car["yr_max"] = gb["yearID"].max()
car["TB"] = (car["H"] - car["2B"] - car["3B"] - car["HR"]) + 2 * car["2B"] + 3 * car["3B"] + 4 * car["HR"]
car["AVG"] = car["H"] / car["AB"].replace(0, np.nan)
car["OBP"] = (car["H"] + car["BB"] + car["HBP"]) / (car["AB"] + car["BB"] + car["HBP"] + car["SF"]).replace(0, np.nan)
car["SLG"] = car["TB"] / car["AB"].replace(0, np.nan)
car["OPS"] = car["OBP"] + car["SLG"]

fld = pd.read_csv(HERE / "Fielding.csv", low_memory=False)
fld["G"] = pd.to_numeric(fld["G"], errors="coerce").fillna(0)
fld = fld[fld["playerID"].isin(ids) & (fld["POS"] != "P")]
posg = fld.groupby(["playerID", "POS"])["G"].sum().reset_index()
primary = posg.sort_values("G").groupby("playerID").tail(1).set_index("playerID")["POS"]
fld_games = fld.groupby("playerID")["G"].sum()

war = pd.read_csv(HERE / "war_daily_bat.txt")
war["WAR"] = pd.to_numeric(war["WAR"], errors="coerce").fillna(0)
war["PA"] = pd.to_numeric(war["PA"], errors="coerce").fillna(0)
war["G"] = pd.to_numeric(war["G"], errors="coerce").fillna(0)
war["OPS_plus"] = pd.to_numeric(war["OPS_plus"], errors="coerce")
w = war[war["player_ID"].isin(ids)]
war_tot = w.groupby("player_ID")["WAR"].sum()
team = (w.groupby(["player_ID", "team_ID"])["G"].sum().reset_index()
        .sort_values("G").groupby("player_ID").tail(1).set_index("player_ID")["team_ID"])


def wops(d):
    m = d["OPS_plus"].notna() & (d["PA"] > 0)
    if not m.any():
        return None
    return float(np.average(d.loc[m, "OPS_plus"], weights=d.loc[m, "PA"]))


opsplus = w.groupby("player_ID").apply(wops)

out = {}
for _, row in top_df.iterrows():
    pid = row["playerID"]
    rank = int(row["rank_saa"])
    c = car.loc[pid]
    fg = float(fld_games.get(pid, 0.0))
    dh_share = (c["G"] - fg) / c["G"] if c["G"] else 0
    pos = primary.get(pid, "DH")
    if dh_share > 0.55:
        pos = "DH"
    op = opsplus.get(pid)
    out[rank] = {
        "pos": pos,
        "yrs": f"{int(c['yr_min'])}–{int(c['yr_max'])}",
        "team": (team.get(pid) or ""),
        "qpa": int(qpa.get(pid, 0)),
        "g": int(c["G"]), "ab": int(c["AB"]), "r": int(c["R"]), "h": int(c["H"]),
        "d2": int(c["2B"]), "d3": int(c["3B"]), "hr": int(c["HR"]), "rbi": int(c["RBI"]),
        "sb": int(c["SB"]), "cs": int(c["CS"]), "bb": int(c["BB"]), "so": int(c["SO"]),
        "avg": None if pd.isna(c["AVG"]) else round(float(c["AVG"]), 3),
        "obp": None if pd.isna(c["OBP"]) else round(float(c["OBP"]), 3),
        "slg": None if pd.isna(c["SLG"]) else round(float(c["SLG"]), 3),
        "ops": None if pd.isna(c["OPS"]) else round(float(c["OPS"]), 3),
        "opsPlus": None if op is None or pd.isna(op) else round(op),
        "war": round(float(war_tot.get(pid, row["real_WAR"])), 1),
    }

(HERE / "js/saa-career.js").write_text(
    f"// Career box-score lines for the Top {N} SAA hitters, keyed by SAA rank.\n"
    "// Generated by build_hitters_js.py from Lahman Batting/Fielding + BBRef WAR.\n"
    "const SAA_CAREER = " + json.dumps(out, separators=(",", ":")) + ";\n"
)
print(f"js/saa-career.js: SAA_CAREER -> {len(out)} players")

# ---- career lines for whoever now just misses the cut (the "leaves out" writeup) ----
just_miss = [r["name"] for r in full[N:N + 12]]
bb = bat[bat["playerID"].isin({r["playerID"] for r in full if r["name"] in just_miss})]
for name in just_miss:
    prow = next(r for r in full if r["name"] == name)
    d = bb[bb["playerID"] == prow["playerID"]]
    ab, h = d["AB"].sum(), d["H"].sum()
    ww = war[war["player_ID"] == prow["playerID"]]
    m = ww["OPS_plus"].notna() & (ww["PA"] > 0)
    op = round(float(np.average(ww.loc[m, "OPS_plus"], weights=ww.loc[m, "PA"]))) if m.any() else None
    print(f"#{prow['rank_saa']:>3} {name:<20} AVG {h/ab:.3f}  OPS+ {op}  H {int(h)}  "
          f"HR {int(d['HR'].sum())}  SB {int(d['SB'].sum())}  bWAR {ww['WAR'].sum():.1f}  "
          f"| z AVG {float(prow['z_AVG_career']):+.2f} ISO {float(prow['z_ISO_career']):+.2f} "
          f"BB {float(prow['z_BB_career']):+.2f} SB {float(prow['z_SB_career']):+.2f} "
          f"DEF {float(prow['z_DEF_career']):+.2f}")
