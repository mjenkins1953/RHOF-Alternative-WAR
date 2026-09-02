"""
SAA validation: how does the SAA ranking compare to the established
"total value" systems it is an alternative to?

For every hitter in the SAA qualifying pool this joins:
  - SAA_final           (this site's metric)
  - bWAR                 Baseball-Reference Wins Above Replacement, career
  - bWAA                 Baseball-Reference Wins Above *Average*, career
                         (the closest external analog to what SAA measures)
  - JAWS                 (bWAR + WAR7) / 2, the Hall-of-Fame yardstick
                         Jay Jaffe / Baseball-Reference use for induction cases

Then: Spearman rank correlations, Hall-of-Fame hit rates at several cutoffs,
and the biggest disagreements in each direction (with the SAA category
z-scores, so each disagreement is explainable rather than mysterious).

Outputs:
  saa_vs_war.csv            full join, one row per ranked hitter
  validation_summary.txt    correlations + HOF hit rates + disagreement tables
  js/validation-data.js     the numbers the Validation page renders from
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.stats import spearmanr

HERE = Path(__file__).parent
WAR7_N = 7
SCATTER_WAR_FLOOR = 25   # the Validation page scatter plots everyone at/above this bWAR
DISAGREE_N = 12          # rows per "biggest disagreement" column on the page


def season_war():
    """Per player-season total WAR (bat side + pitch side, summed over stints)."""
    frames = []
    for fn in ("war_daily_bat.txt", "war_daily_pitch.txt"):
        w = pd.read_csv(HERE / fn, usecols=["player_ID", "year_ID", "WAR", "WAA"])
        w["WAR"] = pd.to_numeric(w["WAR"], errors="coerce").fillna(0.0)
        w["WAA"] = pd.to_numeric(w["WAA"], errors="coerce").fillna(0.0)
        frames.append(w)
    w = pd.concat(frames, ignore_index=True)
    ps = w.groupby(["player_ID", "year_ID"], as_index=False)[["WAR", "WAA"]].sum()
    return ps.rename(columns={"player_ID": "playerID"})


def career_metrics(ps):
    def per_player(d):
        war7 = d["WAR"].sort_values(ascending=False).head(WAR7_N).sum()
        war = d["WAR"].sum()
        return pd.Series({"bWAR": war, "bWAA": d["WAA"].sum(),
                          "WAR7": war7, "JAWS": (war + war7) / 2.0})
    return ps.groupby("playerID").apply(per_player).reset_index()


def hof_players():
    hof = pd.read_csv(HERE / "HallOfFame.csv")
    ind = hof[(hof["inducted"] == "Y") & (hof["category"] == "Player")]
    return set(ind["playerID"])


def rank_desc(s):
    return s.rank(ascending=False, method="min")


def main():
    saa = pd.read_csv(HERE / "saa_full.csv")
    cm = career_metrics(season_war())
    df = saa.merge(cm, on="playerID", how="left")

    # a handful of the pool (mostly Negro Leagues via the carve-out) have no
    # bbref daily-WAR row; keep them in the file but drop from the correlation
    hof = hof_players()
    df["is_hof"] = df["playerID"].isin(hof)

    for col, r in [("SAA_final", "saa_rank"), ("bWAR", "bwar_rank"),
                   ("bWAA", "bwaa_rank"), ("JAWS", "jaws_rank")]:
        df[r] = rank_desc(df[col])

    df["d_war"] = df["bwar_rank"] - df["saa_rank"]    # +ve: SAA ranks them higher than bWAR does
    df["d_waa"] = df["bwaa_rank"] - df["saa_rank"]
    df["d_jaws"] = df["jaws_rank"] - df["saa_rank"]

    keep = ["saa_rank", "name", "SAA_final", "bWAR", "bwar_rank", "bWAA",
            "bwaa_rank", "JAWS", "jaws_rank", "WAR7", "d_war", "d_waa", "d_jaws",
            "z_AVG_career", "z_ISO_career", "z_BB_career", "z_SB_career",
            "z_DEF_career", "qualifying_seasons", "is_hof", "is_nel_ranked"]
    out = df[keep].sort_values("saa_rank")
    out.to_csv(HERE / "saa_vs_war.csv", index=False)

    lines = []
    def p(s=""):
        lines.append(s)
        print(s)

    c = df.dropna(subset=["bWAR", "bWAA", "JAWS"]).copy()
    p("=" * 72)
    p("SAA VALIDATION  vs Baseball-Reference WAR / WAA / JAWS")
    p("=" * 72)
    p(f"{len(c)} hitters in the SAA pool with a Baseball-Reference WAR record")
    p("")

    p("--- Spearman rank correlation (whole pool) ---")
    for lab, col in [("bWAR", "bWAR"), ("bWAA", "bWAA"), ("JAWS", "JAWS")]:
        p(f"  SAA_final vs {lab:5s} : {spearmanr(c['SAA_final'], c[col]).correlation:.3f}")
    p(f"  (reference)  bWAR vs JAWS : {spearmanr(c['bWAR'], c['JAWS']).correlation:.3f}")
    p(f"  (reference)  bWAR vs bWAA : {spearmanr(c['bWAR'], c['bWAA']).correlation:.3f}")
    p("")

    for lo in (30, 45, 60):
        s = c[c["bWAR"] >= lo]
        p(f"--- Spearman among the {len(s)} hitters with bWAR >= {lo} ---")
        for lab, col in [("bWAR", "bWAR"), ("bWAA", "bWAA"), ("JAWS", "JAWS")]:
            p(f"  SAA_final vs {lab:5s} : {spearmanr(s['SAA_final'], s[col]).correlation:.3f}")
        p("")

    p("--- Hall-of-Fame hit rate: how many of the top-N are BBWAA/Vet inductees ---")
    p(f"  (pool contains {c['is_hof'].sum()} inducted players out of {len(c)})")
    p(f"  {'cutoff':>7} | {'by SAA':>8} | {'by bWAR':>8} | {'by bWAA':>8} | {'by JAWS':>8}")
    for n in (50, 100, 150, 200, 300):
        row = f"  {'top '+str(n):>7} |"
        for col in ("SAA_final", "bWAR", "bWAA", "JAWS"):
            top = c.nlargest(n, col)
            row += f" {top['is_hof'].sum():>4}/{n:<3} |"
        p(row.rstrip("|") + "|")
    p("")

    def table(title, sort_col, asc, note):
        p("-" * 72)
        p(title)
        p(note)
        p("-" * 72)
        sub = c.sort_values(sort_col, ascending=asc).head(20)
        p(f"{'name':<20} {'SAA#':>5} {'bWAR#':>6} {'bWAA#':>6} {'JAWS#':>6}  "
          f"{'AVG':>5} {'ISO':>5} {'BB':>5} {'SB':>5} {'DEF':>5}")
        for _, r in sub.iterrows():
            p(f"{r['name']:<20} {int(r['saa_rank']):>5} {int(r['bwar_rank']):>6} "
              f"{int(r['bwaa_rank']):>6} {int(r['jaws_rank']):>6}  "
              f"{r['z_AVG_career']:>5.2f} {r['z_ISO_career']:>5.2f} {r['z_BB_career']:>5.2f} "
              f"{r['z_SB_career']:>5.2f} {r['z_DEF_career']:>5.2f}")
        p("")

    # only compare where both systems have an opinion that matters: bWAR >= 40
    c = c[c["bWAR"] >= 40].copy()
    table("BIGGEST DISAGREEMENTS: bWAR rates them far above SAA",
          "d_war", True,
          "career-value / longevity players SAA discounts (rate-vs-average + averaged composite)")
    table("BIGGEST DISAGREEMENTS: SAA rates them far above bWAR",
          "d_war", False,
          "peak-rate players bWAR discounts (short careers, or value concentrated in a dominant peak)")
    table("BIGGEST DISAGREEMENTS: bWAA (wins above AVERAGE) rates them far above SAA",
          "d_waa", True,
          "the fairest external comparison - where SAA still diverges from an above-average yardstick")

    (HERE / "validation_summary.txt").write_text("\n".join(lines) + "\n")
    print("\nWrote saa_vs_war.csv and validation_summary.txt")

    emit_js(df)


def _reason_war_over_saa(r):
    """One honest line for why bWAR ranks a player well above SAA."""
    bat = (r["z_AVG_career"] + r["z_ISO_career"]) / 2
    if r["z_DEF_career"] >= 0.8 and bat < 0.2:
        return "glove-first value — averaging five z-scores dilutes a single elite category"
    if r["qualifying_seasons"] >= 16:
        return "long, steady career — an above-average yardstick banks less for longevity than WAR"
    if r["z_ISO_career"] <= -0.35:
        return "light power — SAA leans 60% of the bat score on average + isolated power"
    return "value spread thinly across categories — no single number SAA weighs heavily"


def _reason_saa_over_war(r):
    """One honest line for why SAA ranks a player well above bWAR."""
    bat = (r["z_AVG_career"] + r["z_ISO_career"]) / 2
    short = r["qualifying_seasons"] <= 12
    if short and bat >= 1.0:
        return "a short career built on an elite bat — SAA scores the rate and the peak, bWAR the totals"
    if short:
        return "short career — SAA's peak half scores the prime, not the plate-appearance count"
    if bat >= 1.0:
        return "elite rate hitter — bWAR counts total value accrued, SAA rewards the rate"
    return "peak seasons far above a modest career length"


def emit_js(df):
    # Negro Leagues players are dropped from every comparison here: their
    # Baseball-Reference WAR/WAA is built on a far shorter official league
    # schedule (a full season was ~50-80 games), so a rank against it is not
    # comparable to SAA's season-length-normalized carve-out. Keeping them in
    # would make SAA look "right" for the wrong reason.
    c = df.dropna(subset=["bWAR", "bWAA", "JAWS"])
    c = c[~c["is_nel_ranked"]].copy()

    def corr_row(sub, label):
        return {
            "label": label, "n": int(len(sub)),
            "war": round(spearmanr(sub["SAA_final"], sub["bWAR"]).correlation, 2),
            "waa": round(spearmanr(sub["SAA_final"], sub["bWAA"]).correlation, 2),
            "jaws": round(spearmanr(sub["SAA_final"], sub["JAWS"]).correlation, 2),
        }

    corr = [corr_row(c, "Every ranked hitter")]
    for lo, lab in [(30, "Solid regulars & up (bWAR 30+)"),
                    (45, "Genuine stars (bWAR 45+)"),
                    (60, "Inner-circle careers (bWAR 60+)")]:
        corr.append(corr_row(c[c["bWAR"] >= lo], lab))

    n_hof = int(c["is_hof"].sum())
    hof_rows = []
    for n in (50, 100, 150, 200, 300):
        row = {"n": n}
        for key, col in [("saa", "SAA_final"), ("war", "bWAR"), ("waa", "bWAA"), ("jaws", "JAWS")]:
            row[key] = int(c.nlargest(n, col)["is_hof"].sum())
        hof_rows.append(row)

    # the scatter ranks each metric WITHIN the plotted set, so the 45-degree
    # line is a true "these two systems agree" diagonal
    sc = c[c["bWAR"] >= SCATTER_WAR_FLOOR].copy()
    sc["sx"] = sc["bWAR"].rank(ascending=False, method="min").astype(int)
    sc["sy"] = sc["SAA_final"].rank(ascending=False, method="min").astype(int)
    scatter = [
        {"nm": r["name"], "x": int(r["sx"]), "y": int(r["sy"]), "h": bool(r["is_hof"])}
        for _, r in sc.sort_values("sx").iterrows()
    ]

    pool = c[c["bWAR"] >= 40].copy()

    def disagree(sort_asc, reason_fn):
        sub = pool.sort_values("d_war", ascending=sort_asc).head(DISAGREE_N)
        return [
            {"nm": r["name"], "saa": int(r["saa_rank"]), "war": int(r["bwar_rank"]),
             "waa": int(r["bwaa_rank"]), "jaws": int(r["jaws_rank"]),
             "hof": bool(r["is_hof"]), "why": reason_fn(r)}
            for _, r in sub.iterrows()
        ]

    spotlight_names = ["Derek Jeter", "Alan Trammell", "Lou Whitaker", "Barry Larkin"]
    spot = [
        {"nm": r["name"], "saa": int(r["saa_rank"]), "war": int(r["bwar_rank"]),
         "waa": int(r["bwaa_rank"]), "jaws": int(r["jaws_rank"]),
         "def_z": round(r["z_DEF_career"], 2)}
        for nm in spotlight_names
        for _, r in c[c["name"] == nm].iterrows()
    ]

    payload = {
        "pool_n": int(len(c)),
        "hof_n": n_hof,
        "scatter_floor": SCATTER_WAR_FLOOR,
        "scatter_n": len(scatter),
        "corr": corr,
        "hof": hof_rows,
        "scatter": scatter,
        "war_over_saa": disagree(True, _reason_war_over_saa),
        "saa_over_war": disagree(False, _reason_saa_over_war),
        "spotlight": spot,
    }
    js = ("// SAA vs Baseball-Reference WAR / WAA / JAWS -- the Validation page's data.\n"
          "// Generated by build_validation.py from saa_full.csv + war_daily_*.txt + HallOfFame.csv.\n"
          "const VALIDATION = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    (HERE / "js" / "validation-data.js").write_text(js)
    print(f"Wrote js/validation-data.js ({len(js):,} bytes, {len(scatter)} scatter points)")


if __name__ == "__main__":
    main()
