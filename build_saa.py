"""
Stat Above Average (SAA)
========================
An alternative to Bat & Glove WAR's linear-weights formula. Instead of
converting box-score events into borrowed run-value constants (Palmer's
linear weights), this scores each player-season directly against that
season's actual league average and spread. The four offensive inputs use
no external run values at all -- just rate stats vs the league. Defense is
the exception: fielding has no clean box-score rate, so SAA takes
Baseball-Reference's Fielding Runs for that one input rather than invent a
worse home-grown substitute.

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
  - Defense         (Baseball-Reference Fielding Runs -- range/fielding
                      runs + catcher defense + good-play adjustments + the
                      positional adjustment -- taken per season and
                      z-scored against that season's league like the other
                      four. This replaced a home-grown putout/assist range
                      metric + a fixed POS_ADJ table: the old version was
                      the one piece of SAA that leaned on hand-built run
                      values and it couldn't see catcher defense at all.)

Runs and RBI were deliberately left out: both are lineup-context stats
(they depend on who's on base ahead of you and where you hit in the
order), not a clean measure of the player's own output -- exactly the
problem this metric is trying to avoid by not borrowing external run
values either.

Defense input (Baseball-Reference Fielding Runs): the fifth z-score is
built from BBRef's per-season defensive runs -- runs_field (range) +
runs_catcher + runs_good_plays + runs_position (the positional / DH
adjustment) -- divided by games and z-scored against the league like the
rest. Earlier builds used a putout+assist range factor with a hand-set
POS_ADJ table; that was crude (no catcher defense, arbitrary constants)
and it was the only place SAA relied on invented run values. runs_position
carries the position and DH adjustments now, so POS_ADJ is gone.

Position-relative baseline (POSREL_STRENGTH): the four offensive z's are
not measured against every hitter, but against a blend pulled
POSREL_STRENGTH of the way from the whole-league season baseline toward
the player's own position-group baseline that season (SS / 2B / C / 3B /
OF / 1B / DH). A good-hitting shortstop still looks average next to a
league full of corner sluggers, which buried the up-the-middle greats
(Jeter, Ripken, Trammell, Bench) hundreds of spots low; scoring the bat
against other shortstops fixes that. Full strength over-corrects (it
floats no-hit glovemen up), so this ships at 0.60.

Decline-season weighting (DECLINE_SEASON_WEIGHT): a below-average season
scores negative, so the average-baseline formula docks a great player for
compiling past his prime. Negative single-season SAA is multiplied by
0.40 before the career total is summed -- a past-prime year still costs
something, but a mediocre tail no longer erases a genuinely great middle.
The peak-N total is untouched (a decline season never makes the peak).

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
# History: the five categories were equal-weight (0.20 each) through the
# first builds; then walks were dialed back to 0.12 (a walks-only bat like
# Gene Tenace could ride that one category in). This build re-centres the
# score on hitting: batting average and isolated power carry 30% each,
# defense 20%, and walk rate and stolen-base rate 10% each. Steals joined
# walks as a dialed-back category -- a fifth of the score riding on
# baserunning was floating pure speed merchants (Brock, Wills, Vince
# Coleman) onto the list ahead of complete hitters, and neutralising it
# pulled the list ~5 points closer to the actual Hall of Fame.
SAA_WEIGHTS = {"z_AVG": 0.30, "z_ISO": 0.30, "z_BB": 0.10, "z_SB": 0.10, "z_DEF": 0.20}

# --- Position-relative scoring ---------------------------------------
# The four offensive z-scores (AVG/ISO/BB/SB) are measured against a blend
# of the whole-league season baseline and the player's position-group
# baseline that season (SS/2B/C/3B/OF/1B/DH). Scoring a shortstop's bat
# against every hitter buried the up-the-middle greats (Jeter, Ripken,
# Trammell, Bench) hundreds of spots below where every external system has
# them -- a good-hitting SS still looks average next to a lineup full of
# corner sluggers. Scoring him against other shortstops fixes that, but at
# full strength it over-corrects: it tells the formula "a .240-hitting SS
# is average" and floats no-hit glovemen (Campaneris, Maranville,
# Concepción) into the top 300. POSREL_STRENGTH dials between the two:
# 0.0 = pure league baseline (the old behaviour), 1.0 = pure position-
# group baseline. 0.60 is the settled compromise -- it lands the
# up-the-middle stars sensibly while keeping the no-hit glovemen out.
POSREL_STRENGTH = 0.60
POSGRP_SHRINK_K = 12  # a position-group/season mean regresses toward the
                      # league mean by this many phantom league-average
                      # players, so a thin group (early-years catchers)
                      # doesn't take a wild baseline off a handful of bats

# --- Decline-season weighting ---------------------------------------
# SAA scores every season against league average, so a below-average
# season subtracts from the career total -- the formula actively punishes
# a great player for hanging on past his prime (Rose's age-41-45 years,
# Jeter's last four, Mays as a Met, Yaz's DH tail). That over-corrects the
# other way: a past-prime season is still a real season the player
# showed up for, and a mediocre year shouldn't erase value already
# banked. Negative single-season SAA is multiplied by this weight before
# the career total is summed (positive seasons and the peak-N total are
# untouched -- a decline season never makes the peak anyway). 1.0 = old
# behaviour (full penalty); 0.0 = a decline season is free. 0.40 keeps a
# real cost on bad years while not letting a compiler's tail wreck a
# career that was genuinely great in the middle.
DECLINE_SEASON_WEIGHT = 0.40

# Peak: a player's best PEAK_N single seasons of SAA value. The ranking
# metric is JAWS-style -- the average of career total and peak total -- so
# a short, dominant career (Kiner, Greenberg, a banned Joe Jackson) is
# scored on its best years instead of being buried under compilers, and a
# thin-but-long career (Tenace, Figgins) gets no rescue because its best
# seven seasons ARE basically its whole career.
PEAK_N = 7

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


def build_fielding_position(hitters: set) -> pd.DataFrame:
    """Primary fielding position + total games fielded, per player-season,
    from Fielding.csv. Feeds the position-relative BATTING baseline and the
    DH detection (batting games not spent in the field). The defensive RUN
    value is a separate input now -- see bbref_defense_season()."""
    fld = pd.read_csv(HERE / "Fielding.csv", low_memory=False)
    fld = fld[fld["playerID"].isin(hitters)].copy()
    fld = fld[fld["POS"] != "P"].copy()
    fld["G"] = pd.to_numeric(fld["G"], errors="coerce").fillna(0)
    fld["yearID"] = pd.to_numeric(fld["yearID"], errors="coerce")

    fielded = fld.groupby(["playerID", "yearID"]).agg(
        fielded_games=("G", "sum"),
    ).reset_index()

    # primary fielding position that season = the POS (C/1B/2B/3B/SS/OF)
    # with the most games; ties break down the defensive spectrum
    _spec = {"C": 0, "SS": 1, "2B": 2, "3B": 3, "OF": 4, "1B": 5}
    fp = fld[fld["POS"].isin(_spec)].groupby(["playerID", "yearID", "POS"])["G"].sum().reset_index()
    fp["pri"] = fp["POS"].map(_spec)
    fp = fp.sort_values(["G", "pri"], ascending=[False, True]).groupby(["playerID", "yearID"]).head(1)
    fielded = fielded.merge(fp[["playerID", "yearID", "POS"]].rename(columns={"POS": "fld_pos"}),
                            on=["playerID", "yearID"], how="left")
    return fielded


def bbref_defense_season() -> pd.DataFrame:
    """Per player-season defensive runs from Baseball-Reference's WAR data:
    runs_field (range/fielding) + runs_catcher (catcher throwing, framing,
    game-calling) + runs_good_plays + runs_position (the positional and DH
    adjustment). This is the SAA defense input -- it replaced a home-grown
    putout/assist range factor plus a fixed POS_ADJ table. war_daily_bat's
    player_ID is treated as the Lahman playerID, matching classify_hitters;
    seasons are summed over mid-year stints."""
    w = pd.read_csv(HERE / "war_daily_bat.txt",
                    usecols=["player_ID", "year_ID", "runs_field", "runs_catcher",
                             "runs_good_plays", "runs_position"], low_memory=False)
    for c in ["runs_field", "runs_catcher", "runs_good_plays", "runs_position"]:
        w[c] = pd.to_numeric(w[c], errors="coerce").fillna(0.0)
    w["yearID"] = pd.to_numeric(w["year_ID"], errors="coerce")
    w = w.dropna(subset=["yearID"])
    w["fielding_runs"] = (w["runs_field"] + w["runs_catcher"]
                          + w["runs_good_plays"] + w["runs_position"])
    out = (w.groupby(["player_ID", "yearID"], as_index=False)["fielding_runs"].sum()
             .rename(columns={"player_ID": "playerID"}))
    out["yearID"] = out["yearID"].astype(int)
    return out


def main():
    season, negro_leaguers = load_batting_season()
    cls = classify_hitters()
    hitters = set(cls.loc[cls["is_hitter"], "playerID"])
    hseason = season[season["playerID"].isin(hitters)].copy()

    fielded = build_fielding_position(hitters)
    hseason = hseason.merge(fielded, on=["playerID", "yearID"], how="left")
    hseason["fielded_games"] = hseason["fielded_games"].fillna(0)

    hseason = hseason.merge(bbref_defense_season(), on=["playerID", "yearID"], how="left")
    hseason["fielding_runs"] = hseason["fielding_runs"].fillna(0.0)

    # DH time this season = batting games not spent anywhere in the field.
    # Only used to route the season to the DH bat baseline -- the run cost
    # of DHing is already inside runs_position.
    hseason["dh_games"] = (hseason["G"] - hseason["fielded_games"]).clip(lower=0)

    # position group that season, for the position-relative baseline: DH if
    # unfielded games dominate, else the primary fielding position; unknown
    # -> "OF" (a safe middle-of-the-road bat bar)
    hseason["pos_grp"] = np.where(
        hseason["dh_games"] > hseason["fielded_games"], "DH",
        hseason["fld_pos"].fillna("OF"))
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

    # Reference means the four offensive z's are measured against: the
    # whole-league season baseline by default, or (POSREL_STRENGTH > 0) a
    # blend pulled POSREL_STRENGTH of the way toward the player's
    # position-group baseline that season. See the POSREL_STRENGTH note up top.
    m_AVG, m_ISO, m_BB, m_SB = (hseason["lg_AVG_mean"], hseason["lg_ISO_mean"],
                                hseason["lg_BB_rate_mean"], hseason["lg_SB_rate_mean"])
    if POSREL_STRENGTH:
        q = hseason[hseason["PA"] >= SEASON_PA_FLOOR]
        g = q.groupby(["pos_grp", "yearID"]).agg(
            H=("H", "sum"), AB=("AB", "sum"), TB=("TB", "sum"),
            BB=("BB", "sum"), SB=("SB", "sum"), PA=("PA", "sum"), n=("PA", "size"),
        ).reset_index()
        g["g_AVG"] = g["H"] / g["AB"]
        g["g_ISO"] = g["TB"] / g["AB"] - g["g_AVG"]
        g["g_BB"] = g["BB"] / g["PA"]
        g["g_SB"] = g["SB"] / g["PA"]
        g = g.merge(lg[["yearID", "lg_AVG_mean", "lg_ISO_mean", "lg_BB_rate_mean", "lg_SB_rate_mean"]], on="yearID")
        K = POSGRP_SHRINK_K
        for s, lgc in [("AVG", "lg_AVG_mean"), ("ISO", "lg_ISO_mean"),
                       ("BB", "lg_BB_rate_mean"), ("SB", "lg_SB_rate_mean")]:
            shrunk = (g["n"] * g[f"g_{s}"] + K * g[lgc]) / (g["n"] + K)
            g[f"ref_{s}"] = g[lgc] + POSREL_STRENGTH * (shrunk - g[lgc])
        hseason = hseason.merge(
            g[["pos_grp", "yearID", "ref_AVG", "ref_ISO", "ref_BB", "ref_SB"]],
            on=["pos_grp", "yearID"], how="left")
        m_AVG = hseason["ref_AVG"].fillna(hseason["lg_AVG_mean"])
        m_ISO = hseason["ref_ISO"].fillna(hseason["lg_ISO_mean"])
        m_BB = hseason["ref_BB"].fillna(hseason["lg_BB_rate_mean"])
        m_SB = hseason["ref_SB"].fillna(hseason["lg_SB_rate_mean"])

    hseason["z_AVG"] = (hseason["AVG"] - m_AVG) / hseason["sd_AVG"]
    hseason["z_ISO"] = (hseason["ISO"] - m_ISO) / hseason["sd_ISO"]
    hseason["z_BB"] = (hseason["BB_rate"] - m_BB) / hseason["sd_BB"]
    hseason["z_SB"] = (hseason["SB_rate"] - m_SB) / hseason["sd_SB"]
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
    # Decline-season weighting: a below-average season subtracts less from
    # the career total than it used to (see DECLINE_SEASON_WEIGHT up top).
    # season_saa_ct is what the career TOTAL is summed from; the raw
    # season_saa still drives the peak-N total (a decline season never
    # makes the peak, so the two are identical there).
    qseason["season_saa_ct"] = np.where(
        qseason["season_saa"] < 0,
        qseason["season_saa"] * DECLINE_SEASON_WEIGHT,
        qseason["season_saa"])

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
        total = d["season_saa_ct"].dropna().sum()         # career total (compiler-friendly; decline seasons dampened)
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
    # is_nel_ranked: has at least one QUALIFYING season (200+ PA, i.e. a season
    # that actually feeds the career total / peak / z-averages) whose primary
    # league was a Negro Major League. This is the flag the site shows -- it
    # marks players whose ranking is partly built on Negro Leagues play, not
    # players who merely appeared in one (Mays' 48-PA 1948, etc.).
    nel_ranked = set(qseason.loc[qseason["lgID"].isin(NEGRO_LEAGUE_CODES), "playerID"])
    career["is_nel_ranked"] = career["playerID"].isin(nel_ranked)

    qualifies = (career["career_PA"] >= CAREER_PA_FLOOR) | (
        career["is_negro_leaguer"] & (career["season_equivalents"] >= NEL_SEASON_EQUIV_FLOOR)
    )
    pool = career[qualifies].copy()
    pool = pool.sort_values("SAA_final", ascending=False).reset_index(drop=True)
    pool["rank_saa"] = pool.index + 1

    out_cols = ["rank_saa", "playerID", "name", "career_PA", "qualifying_seasons",
                "SAA_final", "SAA_total", "SAA_peak", "SAA_rate",
                "z_AVG_career", "z_ISO_career", "z_BB_career", "z_SB_career", "z_DEF_career", "real_WAR",
                "is_negro_leaguer", "is_nel_ranked", "season_equivalents"]
    pool[out_cols].to_csv(HERE / "saa_full.csv", index=False)
    pool[out_cols].head(300).to_csv(HERE / "saa_top_300_hitters.csv", index=False)

    # Per-season z-score matrix for every ranked hitter -- the raw inputs the
    # "Your Hall" page needs to re-score the pool under user-chosen weights.
    # Just the raw per-season z's + PA; the composite/peak/blend is redone
    # client-side. Missing z (a part-time fielder has no z_DEF, a few 1800s
    # seasons have no SB spread) is left blank.
    pool_ids = set(pool["playerID"])
    seasons_out = (
        qseason[qseason["playerID"].isin(pool_ids)]
        [["playerID", "yearID", "z_AVG", "z_ISO", "z_BB", "z_SB", "z_DEF", "PA"]]
        .sort_values(["playerID", "yearID"])
    )
    seasons_out.to_csv(HERE / "saa_seasons_hitters.csv", index=False)
    print(f"Wrote saa_seasons_hitters.csv ({len(seasons_out)} player-seasons "
          f"across {seasons_out['playerID'].nunique()} hitters)")

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
