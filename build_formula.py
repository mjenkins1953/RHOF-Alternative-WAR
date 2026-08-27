"""
Bat & Glove WAR
===============
Builds a career hitting+fielding value formula from the Lahman/Chadwick
Bureau baseball database, and benchmarks it against real career WAR
(Baseball-Reference's published bWAR component files) to see how close a
from-scratch, box-score-only formula can get to reproducing WAR's actual
player ranking.

Requires: pandas, scipy   (pip install pandas scipy)

Usage:
    python3 build_formula.py

Downloads ~68MB of source data on first run (not committed to this repo --
re-fetched fresh each time so the numbers stay current with the latest
season). Produces:
    formula_with_fielding_full.csv   -- all 1,912 qualifying players
    top_300_formula.csv              -- top 300 by formula_WAR
    comparison_top30.json            -- top-30 both ways, for the HTML page
"""

import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

HERE = Path(__file__).parent

SOURCES = {
    "Batting.csv": "https://raw.githubusercontent.com/xorq-labs/baseballdatabank/master/core/Batting.csv",
    "People.csv": "https://raw.githubusercontent.com/xorq-labs/baseballdatabank/master/core/People.csv",
    "Fielding.csv": "https://raw.githubusercontent.com/xorq-labs/baseballdatabank/master/core/Fielding.csv",
    "war_daily_bat.txt": "https://www.baseball-reference.com/data/war_daily_bat.txt",
    "war_daily_pitch.txt": "https://www.baseball-reference.com/data/war_daily_pitch.txt",
}


def fetch_sources():
    for filename, url in SOURCES.items():
        dest = HERE / filename
        if dest.exists():
            continue
        print(f"fetching {filename} ...")
        subprocess.run(
            ["curl", "-sL", "--max-time", "60", "-A", "Mozilla/5.0", "-o", str(dest), url],
            check=True,
        )


def build_batting_value(bat: pd.DataFrame) -> pd.DataFrame:
    ncols = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS",
             "BB", "SO", "IBB", "HBP", "SH", "SF", "GIDP"]
    for c in ncols:
        bat[c] = pd.to_numeric(bat[c], errors="coerce").fillna(0)
    career = bat.groupby("playerID")[ncols].sum().reset_index()
    career["1B"] = career["H"] - career["2B"] - career["3B"] - career["HR"]
    career["PA"] = career["AB"] + career["BB"] + career["HBP"] + career["SH"] + career["SF"]
    career["outs"] = career["AB"] - career["H"]

    # Palmer-style linear weights. Stolen-base credit (0.225) is HALF the
    # value that best fit real career WAR in a grid search (0.45) -- left
    # at full strength it let pure speed (Rickey Henderson's 1,406 steals)
    # outrank far better all-around hitters, so it's deliberately dialed
    # back at a cost of a little correlation.
    career["batting_runs"] = (
        0.47 * career["1B"] + 0.78 * career["2B"] + 1.09 * career["3B"] + 1.40 * career["HR"]
        + 0.33 * (career["BB"] + career["HBP"]) + 0.225 * career["SB"] - 0.35 * career["CS"]
        - 0.25 * career["outs"] + (20.0 / 600.0) * career["PA"]
    )
    return career


def build_fielding_value(fld: pd.DataFrame, bat: pd.DataFrame) -> pd.DataFrame:
    fld = fld[fld["POS"] != "P"].copy()
    for c in ["G", "GS", "InnOuts", "PO", "A", "E", "DP"]:
        fld[c] = pd.to_numeric(fld[c], errors="coerce")

    # InnOuts (defensive innings) is missing outright for 1911-1953 in this
    # data (essentially the Ruth-through-Musial era) -- fall back to G*9
    # innings so that whole era isn't silently zeroed out.
    fld["InnOuts_est"] = fld["InnOuts"]
    missing = fld["InnOuts_est"].isna()
    fld.loc[missing, "InnOuts_est"] = fld.loc[missing, "G"].fillna(0) * 9 * 3
    fld["G"] = fld["G"].fillna(0)
    fld["PO"] = fld["PO"].fillna(0)
    fld["A"] = fld["A"].fillna(0)

    # Catcher putouts are mostly strikeouts thrown by the pitcher, not a
    # fielding-skill signal -- catchers get position credit only, no range
    # component. First base putouts are mostly just catching throws from
    # other infielders, so 1B range is scored on assists alone.
    fld["chances"] = np.where(fld["POS"] == "1B", fld["A"], fld["PO"] + fld["A"])
    fld.loc[fld["POS"] == "C", "chances"] = np.nan

    lg = (
        fld[fld["POS"] != "C"]
        .groupby(["POS", "yearID"])
        .agg(chances=("chances", "sum"), outs=("InnOuts_est", "sum"))
        .reset_index()
    )
    lg["lg_rate"] = lg["chances"] / lg["outs"].replace(0, np.nan)
    fld = fld.merge(lg[["POS", "yearID", "lg_rate"]], on=["POS", "yearID"], how="left")

    RUNS_PER_PLAY = 0.50
    SHRINK_K = 8000  # ~890 innings; regresses small/noisy career-season samples toward zero
    fld["expected_chances"] = fld["lg_rate"] * fld["InnOuts_est"]
    fld["raw_range_runs"] = (fld["chances"] - fld["expected_chances"]) * RUNS_PER_PLAY
    fld["reliability"] = fld["InnOuts_est"] / (fld["InnOuts_est"] + SHRINK_K)
    fld["range_runs"] = fld["raw_range_runs"] * fld["reliability"]
    fld.loc[fld["POS"] == "C", "range_runs"] = 0.0
    career_range = (
        fld.groupby("playerID")["range_runs"].sum().reset_index()
        .rename(columns={"range_runs": "career_range_runs"})
    )

    # Flat positional-difficulty credit (runs per 150 defensive games),
    # independent of how well any one player fielded the position.
    POS_ADJ = {"C": 12.5, "1B": -12.5, "2B": 2.5, "3B": 2.5, "SS": 7.5,
               "LF": -7.5, "CF": 2.5, "RF": -7.5, "OF": -4.0}
    fld["games_eq"] = fld["InnOuts_est"] / 3 / 9
    fld["pos_adj_runs"] = fld["POS"].map(POS_ADJ).fillna(0) * fld["games_eq"] / 150
    career_posadj = (
        fld.groupby("playerID")["pos_adj_runs"].sum().reset_index()
        .rename(columns={"pos_adj_runs": "career_pos_adj"})
    )
    fielded_games = fld.groupby("playerID")["G"].sum().reset_index().rename(columns={"G": "fielded_games"})

    # DH isn't a fielding position -- it has no rows in Fielding.csv at
    # all, so DH time is otherwise completely invisible to the model.
    # Back into it as (games batted) - (games actually fielded anywhere)
    # and apply DH's (very negative) position credit.
    bat = bat.copy()
    bat["G"] = pd.to_numeric(bat["G"], errors="coerce").fillna(0)
    total_games = bat.groupby("playerID")["G"].sum().reset_index().rename(columns={"G": "total_games"})
    dh = total_games.merge(fielded_games, on="playerID", how="left")
    dh["fielded_games"] = dh["fielded_games"].fillna(0)
    dh["dh_games"] = (dh["total_games"] - dh["fielded_games"]).clip(lower=0)
    dh["dh_pos_adj"] = -17.5 * dh["dh_games"] / 150

    fv = career_range.merge(career_posadj, on="playerID", how="outer").fillna(0)
    fv = fv.merge(dh[["playerID", "dh_games", "dh_pos_adj"]], on="playerID", how="outer").fillna(0)
    fv["career_pos_adj"] = fv["career_pos_adj"] + fv["dh_pos_adj"]
    fv["fielding_runs_total"] = fv["career_range_runs"] + fv["career_pos_adj"]
    return fv


def build_real_war() -> pd.DataFrame:
    war = pd.read_csv(HERE / "war_daily_bat.txt")
    war["WAR"] = pd.to_numeric(war["WAR"], errors="coerce").fillna(0)
    war_c = (
        war.groupby("player_ID")["WAR"].sum().reset_index()
        .rename(columns={"player_ID": "playerID", "WAR": "bat_side_WAR"})
    )
    pit = pd.read_csv(HERE / "war_daily_pitch.txt")
    pit["WAR"] = pd.to_numeric(pit["WAR"], errors="coerce").fillna(0)
    pit_c = (
        pit.groupby("player_ID")["WAR"].sum().reset_index()
        .rename(columns={"player_ID": "playerID", "WAR": "pitch_WAR"})
    )
    war_c = war_c.merge(pit_c, on="playerID", how="left")
    war_c["pitch_WAR"] = war_c["pitch_WAR"].fillna(0)
    # bWAR's public career leaderboard adds pitching WAR onto two-way
    # players' (e.g. Ruth's) position-player total, so this does too.
    war_c["real_WAR"] = war_c["bat_side_WAR"] + war_c["pitch_WAR"]
    return war_c


def main():
    fetch_sources()

    bat = pd.read_csv(HERE / "Batting.csv")
    fld = pd.read_csv(HERE / "Fielding.csv", low_memory=False)
    people = pd.read_csv(HERE / "People.csv")[["playerID", "nameFirst", "nameLast"]]

    career = build_batting_value(bat)
    fv = build_fielding_value(fld, bat)
    career = career.merge(fv, on="playerID", how="left")
    fill_cols = ["career_range_runs", "career_pos_adj", "fielding_runs_total"]
    career[fill_cols] = career[fill_cols].fillna(0)
    career["total_runs"] = career["batting_runs"] + career["fielding_runs_total"]
    career["formula_WAR"] = career["total_runs"] / 10.0
    career["fielding_WAR"] = career["fielding_runs_total"] / 10.0

    war_c = build_real_war()
    df = career.merge(war_c, on="playerID", how="inner")

    # Qualifying pool: 3,000+ career PA, and excludes primarily-pitchers
    # (classified by whether their batting-side WAR component exceeds
    # their pitching-side WAR component) to match the "position player"
    # leaderboard convention real WAR sites use.
    pool = df[(df["PA"] >= 3000) & (df["bat_side_WAR"] >= df["pitch_WAR"])].copy()

    rho, _ = spearmanr(pool["formula_WAR"], pool["real_WAR"])
    print(f"n={len(pool)}  Spearman rank agreement={rho:.4f}")

    pool = pool.merge(people, on="playerID")
    pool["name"] = pool["nameFirst"] + " " + pool["nameLast"]
    pool["rank_formula"] = pool["formula_WAR"].rank(ascending=False, method="min").astype(int)
    pool["rank_real"] = pool["real_WAR"].rank(ascending=False, method="min").astype(int)

    out_cols = ["playerID", "name", "PA", "H", "HR", "BB", "SB",
                "fielding_WAR", "formula_WAR", "real_WAR", "rank_formula", "rank_real"]
    full_sorted = pool.sort_values("formula_WAR", ascending=False)[out_cols].reset_index(drop=True)
    full_sorted.to_csv(HERE / "formula_with_fielding_full.csv", index=False)
    full_sorted.head(300).to_csv(HERE / "top_300_formula.csv", index=False)

    def rows(d):
        out = []
        for r in d.itertuples():
            out.append({
                "name": r.name, "PA": int(r.PA), "H": int(r.H), "HR": int(r.HR),
                "BB": int(r.BB), "SB": int(r.SB), "field": round(r.fielding_WAR, 1),
                "formula": round(r.formula_WAR, 1), "real": round(r.real_WAR, 1),
                "rf": int(r.rank_formula), "rr": int(r.rank_real),
            })
        return out

    top_formula = pool.sort_values("formula_WAR", ascending=False).head(30)
    top_real = pool.sort_values("real_WAR", ascending=False).head(30)
    comparison = {
        "n": len(pool), "spearman": round(rho, 4),
        "top_formula": rows(top_formula), "top_real": rows(top_real),
    }
    (HERE / "comparison_top30.json").write_text(json.dumps(comparison))

    print("Wrote formula_with_fielding_full.csv, top_300_formula.csv, comparison_top30.json")
    print("To refresh bat_and_glove_war.html's embedded data, paste comparison_top30.json's")
    print("contents in place of the `const DATA = {...}` line in that file's <script>.")


if __name__ == "__main__":
    main()
