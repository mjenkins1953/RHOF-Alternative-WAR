"""Career box-score lines for hitters, keyed by playerID.

Extracted from build_hitters_js.py so both the Top-300 list build and the
Your Hall build can share it (the list re-keys by SAA rank; Your Hall keeps
playerID, since its ranking is recomputed client-side).
"""
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent

_NUM = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SF", "SH"]


def hitter_cards(ids, war_fallback=None):
    """{playerID: {pos, yrs, team, qpa, g, ab, r, h, d2, d3, hr, rbi, sb, cs,
    bb, so, avg, obp, slg, ops, opsPlus, war}} for the given playerIDs."""
    ids = set(ids)
    war_fallback = war_fallback or {}

    bat = pd.read_csv(HERE / "Batting.csv")
    for c in _NUM:
        bat[c] = pd.to_numeric(bat[c], errors="coerce").fillna(0)
    bat["yearID"] = pd.to_numeric(bat["yearID"], errors="coerce")
    bat["PA"] = bat["AB"] + bat["BB"] + bat["HBP"] + bat["SF"] + bat["SH"]
    b = bat[bat["playerID"].isin(ids)]
    gb = b.groupby("playerID")
    car = gb[_NUM].sum()

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

    # war_daily_bat keys on the BBRef id -- differs from the Lahman playerID for
    # a handful of players (sabatcc01 -> sabatc.01 etc.); People.csv bridges them.
    bbref = pd.read_csv(HERE / "People.csv").set_index("playerID")["bbrefID"].to_dict()
    bbref_ids = {bbref.get(i, i) for i in ids}
    lahman_of = {bbref.get(i, i): i for i in ids}

    war = pd.read_csv(HERE / "war_daily_bat.txt")
    war["WAR"] = pd.to_numeric(war["WAR"], errors="coerce").fillna(0)
    war["PA"] = pd.to_numeric(war["PA"], errors="coerce").fillna(0)
    war["G"] = pd.to_numeric(war["G"], errors="coerce").fillna(0)
    war["OPS_plus"] = pd.to_numeric(war["OPS_plus"], errors="coerce")
    w = war[war["player_ID"].isin(bbref_ids)].copy()
    w["player_ID"] = w["player_ID"].map(lambda x: lahman_of.get(x, x))  # back to Lahman ids
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
    for pid in ids:
        if pid not in car.index:
            continue
        c = car.loc[pid]
        fg = float(fld_games.get(pid, 0.0))
        dh_share = (c["G"] - fg) / c["G"] if c["G"] else 0
        pos = primary.get(pid, "DH")
        if dh_share > 0.55:
            pos = "DH"
        op = opsplus.get(pid)
        out[pid] = {
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
            "war": round(float(war_tot.get(pid, war_fallback.get(pid, 0.0))), 1),
        }
    return out
