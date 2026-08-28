"""
Stat Above Average (SAA)
========================
An alternative to Bat & Glove WAR's linear-weights formula. Instead of
converting box-score events into borrowed run-value constants (Palmer's
linear weights), this scores each player-season directly against that
season's actual league average and spread -- no external run-value table
anywhere in the calculation.

Five inputs, each turned into a z-score against that season's league
distribution, then averaged. Each is a genuinely separate skill -- none
is a sub-ingredient of another, unlike an earlier version of this script
that scored OPS, isolated power, AND walk rate together (ISO and walk
rate are literally components already inside OPS, so that version
counted power and patience twice):
  - Batting average (H / AB)   -- contact/hit skill, on its own
  - Isolated Power  (SLG - AVG) -- raw power, independent of average
  - Walk rate       (BB / PA)   -- plate discipline, independent of AVG
  - Stolen-base rate (SB / PA)
  - Defense         (range runs + positional credit, same shape as Bat &
                      Glove WAR's fielding component, but computed and
                      z-scored per season rather than as a career total)

Runs and RBI were deliberately left out: both are lineup-context stats
(they depend on who's on base ahead of you and where you hit in the
order), not a clean measure of the player's own output -- exactly the
problem this metric is trying to avoid by not borrowing external run
values either.

Method for the league baseline (same as before):
  - League average per season = SUM(stat) / SUM(PA-or-games) across the
    qualifying hitter population, not a naive per-player average (which
    lets tiny-sample pinch-hitters and pitcher-at-bats drag it down).
  - League standard deviation per season is computed only from player-
    seasons clearing a playing-time floor (200+ PA for offense, 50+ team
    games for defense), so single-digit-PA cameos don't inflate the
    spread with nonsense rates.
  - Career SAA = career-PA-weighted average of season composite-z scores,
    restricted to 3,000+ PA career hitters (matching Bat & Glove WAR's
    qualifying pool) and their qualifying seasons only.

Requires the same local files build_formula.py uses (Batting.csv,
Fielding.csv, People.csv, war_daily_bat.txt, war_daily_pitch.txt).
"""

import numpy as np
import pandas as pd
from pathlib import Path

HERE = Path(__file__).parent
SEASON_PA_FLOOR = 200
SEASON_GAMES_FLOOR = 50
CAREER_PA_FLOOR = 5000

# --- SAA scoring knobs -------------------------------------------------
# The five categories were equal-weight (0.20 each) through the first
# builds. Walks are now dialed back: a walks-only bat (Gene Tenace) could
# ride that one category into the list while all-around 18-year regulars
# (Tony Gwynn) fell just short.
SAA_WEIGHTS = {"z_AVG": 0.22, "z_ISO": 0.22, "z_BB": 0.12, "z_SB": 0.22, "z_DEF": 0.22}

# Peak: a player's best PEAK_N single seasons of SAA value. The ranking
# metric is JAWS-style -- the average of career total and peak total -- so
# a short, dominant career (Kiner, Greenberg, a banned Joe Jackson) is
# scored on its best years instead of being buried under compilers, and a
# thin-but-long career (Tenace, Figgins) gets no rescue because its best
# seven seasons ARE basically its whole career.
PEAK_N = 7
SHRINK_K_SEASON = 1200  # ~133 innings; regresses partial-season defensive
                        # samples toward zero without crushing a full season
                        # (Bat & Glove WAR uses 8000 for CAREER totals --
                        # a season needs a much smaller constant)

# Negro Leagues qualifying carve-out: the flat CAREER_PA_FLOOR assumes a
# 150+ game MLB schedule every year. Negro Leagues teams played far fewer
# official league games (a full Josh Gibson season was ~48 games), and on
# top of that, the surviving record undercounts them further -- exhibition,
# barnstorming, and winter-league games that were a huge part of their
# actual careers were never entered into any official ledger the way MLB
# games were. A shorter recorded MLB career reflects a genuinely shorter
# career; a shorter recorded Negro Leagues career often just reflects a
# less complete paper trail. So Negro Leagues players qualify on a
# separate, season-length-normalized standard instead of raw PA.
NEGRO_LEAGUE_CODES = {"NN2", "NNL", "NAL", "ECL", "EWL", "ANL", "NSL"}
NEL_SEASON_EQUIV_FLOOR = 9.0  # Josh Gibson's own value (~9.03) -- the
                              # explicit case this carve-out exists for

POS_ADJ = {"C": 12.5, "1B": -12.5, "2B": 2.5, "3B": 2.5, "SS": 7.5,
           "LF": -7.5, "CF": 2.5, "RF": -7.5, "OF": -4.0, "DH": -17.5}


def load_batting_season():
    bat = pd.read_csv(HERE / "Batting.csv")
    ncols = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "HBP", "SH", "SF"]
    for c in ncols:
        bat[c] = pd.to_numeric(bat[c], errors="coerce").fillna(0)
    bat["yearID"] = pd.to_numeric(bat["yearID"], errors="coerce")
    bat["lgID"] = bat["lgID"].fillna("UNK")
    bat["PA"] = bat["AB"] + bat["BB"] + bat["HBP"] + bat["SH"] + bat["SF"]
    bat["TB"] = (bat["H"] - bat["2B"] - bat["3B"] - bat["HR"]) + 2 * bat["2B"] + 3 * bat["3B"] + 4 * bat["HR"]

    negro_leaguers = set(bat.loc[bat["lgID"].isin(NEGRO_LEAGUE_CODES), "playerID"])

    # primary league for the season (most-played, for players who changed
    # teams/leagues mid-year)
    lg_lookup = bat.groupby(["playerID", "yearID"])["lgID"].agg(lambda s: s.value_counts().idxmax())

    season = bat.groupby(["playerID", "yearID"]).agg(
        G=("G", "sum"), PA=("PA", "sum"), AB=("AB", "sum"), H=("H", "sum"), BB=("BB", "sum"),
        HBP=("HBP", "sum"), SF=("SF", "sum"), TB=("TB", "sum"), SB=("SB", "sum"),
    ).reset_index()
    season = season.merge(lg_lookup.reset_index(), on=["playerID", "yearID"])
    season["SLG"] = season["TB"] / season["AB"].replace(0, np.nan)
    season["AVG"] = season["H"] / season["AB"].replace(0, np.nan)
    season["ISO"] = season["SLG"].fillna(0) - season["AVG"].fillna(0)
    season["BB_rate"] = season["BB"] / season["PA"].replace(0, np.nan)
    season["SB_rate"] = season["SB"] / season["PA"].replace(0, np.nan)
    return season, negro_leaguers


def classify_hitters():
    bat_c = pd.read_csv(HERE / "Batting.csv")
    for c in ["AB", "BB", "HBP", "SH", "SF"]:
        bat_c[c] = pd.to_numeric(bat_c[c], errors="coerce").fillna(0)
    career_pa = bat_c.groupby("playerID").apply(
        lambda d: (d["AB"] + d["BB"] + d["HBP"] + d["SH"] + d["SF"]).sum()
    ).reset_index(name="career_PA")

    war = pd.read_csv(HERE / "war_daily_bat.txt")
    war["WAR"] = pd.to_numeric(war["WAR"], errors="coerce").fillna(0)
    bat_side = war.groupby("player_ID")["WAR"].sum().reset_index().rename(
        columns={"player_ID": "playerID", "WAR": "bat_side_WAR"})

    pit = pd.read_csv(HERE / "war_daily_pitch.txt")
    pit["WAR"] = pd.to_numeric(pit["WAR"], errors="coerce").fillna(0)
    pitch_side = pit.groupby("player_ID")["WAR"].sum().reset_index().rename(
        columns={"player_ID": "playerID", "WAR": "pitch_WAR"})

    cls = bat_side.merge(pitch_side, on="playerID", how="left")
    cls["pitch_WAR"] = cls["pitch_WAR"].fillna(0)
    cls = cls.merge(career_pa, on="playerID", how="left")
    cls["is_hitter"] = cls["bat_side_WAR"] >= cls["pitch_WAR"]
    cls["real_WAR"] = cls["bat_side_WAR"] + cls["pitch_WAR"]
    return cls


def build_defense_season(hitters: set) -> pd.DataFrame:
    fld = pd.read_csv(HERE / "Fielding.csv", low_memory=False)
    fld = fld[fld["playerID"].isin(hitters)].copy()
    fld = fld[fld["POS"] != "P"].copy()
    for c in ["G", "GS", "InnOuts", "PO", "A", "E", "DP"]:
        fld[c] = pd.to_numeric(fld[c], errors="coerce")
    fld["yearID"] = pd.to_numeric(fld["yearID"], errors="coerce")

    fld["InnOuts_est"] = fld["InnOuts"]
    missing = fld["InnOuts_est"].isna()
    fld.loc[missing, "InnOuts_est"] = fld.loc[missing, "G"].fillna(0) * 9 * 3
    fld["G"] = fld["G"].fillna(0)
    fld["PO"] = fld["PO"].fillna(0)
    fld["A"] = fld["A"].fillna(0)

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
    fld["expected_chances"] = fld["lg_rate"] * fld["InnOuts_est"]
    fld["raw_range_runs"] = (fld["chances"] - fld["expected_chances"]) * RUNS_PER_PLAY
    fld["reliability"] = fld["InnOuts_est"] / (fld["InnOuts_est"] + SHRINK_K_SEASON)
    fld["range_runs"] = fld["raw_range_runs"] * fld["reliability"]
    fld.loc[fld["POS"] == "C", "range_runs"] = 0.0

    fld["games_eq"] = fld["InnOuts_est"] / 3 / 9
    fld["pos_adj_runs"] = fld["POS"].map(POS_ADJ).fillna(0) * fld["games_eq"] / 150

    fielded = fld.groupby(["playerID", "yearID"]).agg(
        fielded_runs=("range_runs", "sum"),
        fielded_pos_adj=("pos_adj_runs", "sum"),
        fielded_games=("G", "sum"),
    ).reset_index()
    return fielded


def main():
    season, negro_leaguers = load_batting_season()
    cls = classify_hitters()
    hitters = set(cls.loc[cls["is_hitter"], "playerID"])
    hseason = season[season["playerID"].isin(hitters)].copy()

    fielded = build_defense_season(hitters)
    hseason = hseason.merge(fielded, on=["playerID", "yearID"], how="left")
    hseason["fielded_runs"] = hseason["fielded_runs"].fillna(0)
    hseason["fielded_pos_adj"] = hseason["fielded_pos_adj"].fillna(0)
    hseason["fielded_games"] = hseason["fielded_games"].fillna(0)

    # DH time this season = games played minus games actually fielded anywhere.
    hseason["dh_games"] = (hseason["G"] - hseason["fielded_games"]).clip(lower=0)
    hseason["dh_pos_adj"] = POS_ADJ["DH"] * hseason["dh_games"] / 150
    hseason["fielding_runs"] = hseason["fielded_runs"] + hseason["fielded_pos_adj"] + hseason["dh_pos_adj"]
    hseason["def_rate"] = hseason["fielding_runs"] / hseason["G"].replace(0, np.nan)

    # League average per season, SUM-over-SUM (playing-time weighted)
    lg = hseason.groupby("yearID").agg(
        lg_H=("H", "sum"), lg_BB=("BB", "sum"), lg_HBP=("HBP", "sum"), lg_SF=("SF", "sum"),
        lg_AB=("AB", "sum"), lg_TB=("TB", "sum"), lg_PA=("PA", "sum"), lg_SB=("SB", "sum"),
        lg_fielding_runs=("fielding_runs", "sum"), lg_G=("G", "sum"),
    ).reset_index()
    lg["lg_SLG"] = lg["lg_TB"] / lg["lg_AB"]
    lg["lg_AVG_mean"] = lg["lg_H"] / lg["lg_AB"]
    lg["lg_ISO_mean"] = lg["lg_SLG"] - lg["lg_AVG_mean"]
    lg["lg_BB_rate_mean"] = lg["lg_BB"] / lg["lg_PA"]
    lg["lg_SB_rate_mean"] = lg["lg_SB"] / lg["lg_PA"]
    lg["lg_def_rate_mean"] = lg["lg_fielding_runs"] / lg["lg_G"]

    # Spread computed only from seasons clearing the playing-time floor
    qoffense = hseason[hseason["PA"] >= SEASON_PA_FLOOR].copy()
    qdefense = hseason[hseason["G"] >= SEASON_GAMES_FLOOR]

    # Negro Leagues qualifying carve-out: how big a "typical" qualifying
    # season was, in THAT SPECIFIC league and year (a Negro Leagues season
    # is compared to other Negro Leagues seasons, not to a 154/162-game MLB
    # schedule), then sum each player's season/league-average ratio across
    # their career -- a season-length-normalized substitute for raw PA.
    lg_season_size = qoffense.groupby(["lgID", "yearID"])["PA"].mean().rename("lg_avg_season_PA")
    qoffense = qoffense.merge(lg_season_size, on=["lgID", "yearID"], how="left")
    qoffense["season_equiv"] = qoffense["PA"] / qoffense["lg_avg_season_PA"]
    season_equivalents = qoffense.groupby("playerID")["season_equiv"].sum().rename("season_equivalents")
    spread_off = qoffense.groupby("yearID").agg(
        sd_AVG=("AVG", "std"), sd_ISO=("ISO", "std"), sd_BB=("BB_rate", "std"), sd_SB=("SB_rate", "std"),
    ).reset_index()
    spread_def = qdefense.groupby("yearID").agg(sd_def=("def_rate", "std")).reset_index()

    lg = lg.merge(spread_off, on="yearID", how="left").merge(spread_def, on="yearID", how="left")

    hseason = hseason.merge(
        lg[["yearID", "lg_AVG_mean", "lg_ISO_mean", "lg_BB_rate_mean", "lg_SB_rate_mean", "lg_def_rate_mean",
            "sd_AVG", "sd_ISO", "sd_BB", "sd_SB", "sd_def"]],
        on="yearID", how="left")

    hseason["z_AVG"] = (hseason["AVG"] - hseason["lg_AVG_mean"]) / hseason["sd_AVG"]
    hseason["z_ISO"] = (hseason["ISO"] - hseason["lg_ISO_mean"]) / hseason["sd_ISO"]
    hseason["z_BB"] = (hseason["BB_rate"] - hseason["lg_BB_rate_mean"]) / hseason["sd_BB"]
    hseason["z_SB"] = (hseason["SB_rate"] - hseason["lg_SB_rate_mean"]) / hseason["sd_SB"]
    hseason["z_DEF"] = (hseason["def_rate"] - hseason["lg_def_rate_mean"]) / hseason["sd_def"]

    # A season only counts toward the career average if it clears the
    # offense floor (PA>=200); if it also clears the defense floor its
    # z_DEF is used, otherwise defense is left out of that season's
    # average rather than penalizing a part-time-fielding season with a
    # noisy z score.
    qseason = hseason[hseason["PA"] >= SEASON_PA_FLOOR].copy()
    qseason.loc[qseason["G"] < SEASON_GAMES_FLOOR, "z_DEF"] = np.nan
    # weighted composite, renormalised over whichever categories that season
    # actually has (a handful of 19th-c seasons have no SB spread, a
    # part-time fielder has no z_DEF)
    _zc = list(SAA_WEIGHTS)
    _w = pd.Series(SAA_WEIGHTS)
    qseason["z_composite"] = (
        qseason[_zc].mul(_w).sum(axis=1, min_count=1)
        / qseason[_zc].notna().mul(_w).sum(axis=1).replace(0, np.nan)
    )
    qseason["season_saa"] = qseason["z_composite"] * qseason["PA"] / 600.0

    def wavg_skipna(vals, w):
        # A handful of 19th-century seasons have no defined league spread
        # for a given stat (e.g. stolen bases barely tracked pre-1887),
        # leaving that season's z as NaN -- skip those seasons for THIS
        # stat's career average rather than letting one NaN season blank
        # out the player's whole career number.
        mask = vals.notna()
        if not mask.any():
            return 0.0
        return np.average(vals[mask], weights=w[mask])

    def weighted(d):
        w = d["PA"]
        s = d["season_saa"].dropna()
        total = s.sum()                                   # career total (compiler-friendly)
        peak = s.sort_values(ascending=False).head(PEAK_N).sum()   # best PEAK_N seasons
        return pd.Series({
            # SAA_final: the ranking metric. JAWS-style blend of the career
            # total and the peak total, so length and dominance both count.
            "SAA_final": (total + peak) / 2.0,
            "SAA_total": total,
            "SAA_peak": peak,
            # SAA_rate: PA-weighted average season composite -- quality per
            # PA, kept as context only.
            "SAA_rate": wavg_skipna(d["z_composite"], w),
            "z_AVG_career": wavg_skipna(d["z_AVG"], w),
            "z_ISO_career": wavg_skipna(d["z_ISO"], w),
            "z_BB_career": wavg_skipna(d["z_BB"], w),
            "z_SB_career": wavg_skipna(d["z_SB"], w),
            "z_DEF_career": wavg_skipna(d["z_DEF"], w),
            "qualifying_seasons": len(d),
            "qualifying_PA": w.sum(),
        })

    career = qseason.groupby("playerID").apply(weighted).reset_index()

    people = pd.read_csv(HERE / "People.csv")[["playerID", "nameFirst", "nameLast"]]
    career = career.merge(people, on="playerID", how="left")
    career["name"] = career["nameFirst"] + " " + career["nameLast"]
    career = career.merge(cls[["playerID", "career_PA", "real_WAR"]], on="playerID", how="left")
    career = career.merge(season_equivalents, on="playerID", how="left")
    career["season_equivalents"] = career["season_equivalents"].fillna(0)
    career["is_negro_leaguer"] = career["playerID"].isin(negro_leaguers)

    qualifies = (career["career_PA"] >= CAREER_PA_FLOOR) | (
        career["is_negro_leaguer"] & (career["season_equivalents"] >= NEL_SEASON_EQUIV_FLOOR)
    )
    pool = career[qualifies].copy()
    pool = pool.sort_values("SAA_final", ascending=False).reset_index(drop=True)
    pool["rank_saa"] = pool.index + 1

    out_cols = ["rank_saa", "playerID", "name", "career_PA", "qualifying_seasons",
                "SAA_final", "SAA_total", "SAA_peak", "SAA_rate",
                "z_AVG_career", "z_ISO_career", "z_BB_career", "z_SB_career", "z_DEF_career", "real_WAR",
                "is_negro_leaguer", "season_equivalents"]
    pool[out_cols].to_csv(HERE / "saa_full.csv", index=False)
    pool[out_cols].head(300).to_csv(HERE / "saa_top_300_hitters.csv", index=False)

    n_nel_via_carveout = ((pool["is_negro_leaguer"]) & (pool["career_PA"] < CAREER_PA_FLOOR)).sum()
    print(f"Qualifying pool: {len(pool)} hitters "
          f"(career PA >= {CAREER_PA_FLOOR}, OR Negro Leagues with "
          f"{NEL_SEASON_EQUIV_FLOOR}+ season-equivalents)")
    print(f"  -> {n_nel_via_carveout} of those qualify ONLY via the Negro Leagues carve-out")
    print("Wrote saa_full.csv and saa_top_300_hitters.csv")

    print()
    print("--- sanity checks ---")
    for name in ["Bill Mazeroski", "Harold Baines", "Lou Whitaker",
                 "Brady Anderson", "Eddie Murray", "Ernie Banks", "George Sisler",
                 "Josh Gibson", "Oscar Charleston", "Buck Leonard", "Martín Dihigo"]:
        row = pool[pool["name"] == name]
        if row.empty:
            print(f"{name}: not in qualifying pool at all")
        else:
            r = row.iloc[0]
            via = " [via NeL carve-out]" if (r["is_negro_leaguer"] and r["career_PA"] < CAREER_PA_FLOOR) else ""
            print(f"{name}: rank {int(r['rank_saa'])} of {len(pool)}{via}  "
                  f"(SAA_final={r['SAA_final']:.2f} [total={r['SAA_total']:.2f}, peak={r['SAA_peak']:.2f}], "
                  f"AVG={r['z_AVG_career']:.2f} ISO={r['z_ISO_career']:.2f} BB={r['z_BB_career']:.2f} "
                  f"SB={r['z_SB_career']:.2f} DEF={r['z_DEF_career']:.2f}, seasons={int(r['qualifying_seasons'])})")


if __name__ == "__main__":
    main()
