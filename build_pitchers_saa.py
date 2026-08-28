"""
Pitchers: Stat Above Average
============================
The mound version of build_saa.py. Same idea -- every pitcher-season scored
only against that season's own league distribution, no borrowed run values --
but with the five inputs and weights from the site's RHOF Score:

  25%  ERA vs league     (earned-run average; lower is better -> z negated)
  25%  WHIP vs league     ((H + BB) / IP; lower is better -> z negated)
  20%  K/9 vs league      (SO * 9 / IP)
  20%  Win %              (W / (W + L), vs the .500 league mean)
  10%  Saves vs league     (raw save count vs the qualifying-pitcher mean)

Each is a per-season z-score against the qualifying-pitcher population that
year; season_score is the weight-normalised blend (a season with no
decisions drops Win% and renormalises the other four). Career SAA sums
season_score * IP / 200 over qualifying seasons -- a workload-weighted
total, so a long steady career and a short dominant peak can both add up.

Qualifying pool: 1,000+ career IP. Season counts toward the career total
if it cleared 40 IP; the league spread each year is measured from 50+ IP
seasons so tiny samples don't inflate it.

Source: the Pitching table read straight out of lahman_2025.mdb (through
2025) via access-parser, so it matches the 2025 hitter data. Plus
Baseball-Reference war_daily_pitch for WAR/ERA+, and HallOfFame.csv.
Requires: pandas, access-parser  (pip install pandas access-parser)
"""
import csv
import numpy as np
import pandas as pd
from pathlib import Path

HERE = Path(__file__).parent
MDB = HERE / "lahman_2025.mdb"


SEASON_IP_FLOOR = 40      # a season must clear this to count toward career SAA
SPREAD_IP_FLOOR = 50      # league SD each year measured from seasons over this
DECISIONS_FLOOR = 5       # Win% z only counts for seasons with >= this many W+L
CAREER_IP_FLOOR = 1000
IP_NORM = 200.0           # "one full starter season" -- the per-season scale

WEIGHTS = {"era": 0.25, "whip": 0.25, "k9": 0.20, "wpct": 0.20, "sv": 0.10}

# recognised major leagues + the Negro Major Leagues (MLB, 2020). Everything
# else in the Lahman file (EAS, WES, IND, INT, NAC) is minor/independent and
# is dropped so it neither qualifies compilers nor skews the league baselines.
MAJOR_LGS = {"AL", "NL", "AA", "FL", "PL", "NA", "UA"}
NEGRO_LGS = {"NN1", "NN2", "NNL", "NAL", "ECL", "EWL", "ANL", "NSL"}


def load_pitching() -> pd.DataFrame:
    """Pitching table out of the Access DB, majors + Negro Majors only."""
    from access_parser import AccessParser
    tbl = AccessParser(str(MDB)).parse_table("Pitching")
    df = pd.DataFrame({k: list(v) for k, v in tbl.items()})
    return df[df["lgID"].isin(MAJOR_LGS | NEGRO_LGS)].copy()


def main():
    p = load_pitching()
    for c in ["W", "L", "G", "GS", "SV", "IPouts", "H", "ER", "BB", "SO"]:
        p[c] = pd.to_numeric(p[c], errors="coerce").fillna(0)
    p["yearID"] = pd.to_numeric(p["yearID"], errors="coerce")
    p["lgID"] = p["lgID"].fillna("UNK")

    # primary league for the season (most outs pitched)
    lg_lookup = (p.groupby(["playerID", "yearID", "lgID"])["IPouts"].sum().reset_index()
                 .sort_values("IPouts").groupby(["playerID", "yearID"]).tail(1)
                 .set_index(["playerID", "yearID"])["lgID"])

    s = p.groupby(["playerID", "yearID"]).agg(
        W=("W", "sum"), L=("L", "sum"), G=("G", "sum"), GS=("GS", "sum"), SV=("SV", "sum"),
        IPouts=("IPouts", "sum"), H=("H", "sum"), ER=("ER", "sum"), BB=("BB", "sum"), SO=("SO", "sum"),
    ).reset_index()
    s = s.merge(lg_lookup.rename("lgID"), on=["playerID", "yearID"])
    s["IP"] = s["IPouts"] / 3.0
    s = s[s["IP"] > 0].copy()
    s["ERA"] = s["ER"] * 9 / s["IP"]
    s["WHIP"] = (s["H"] + s["BB"]) / s["IP"]
    s["K9"] = s["SO"] * 9 / s["IP"]
    dec = s["W"] + s["L"]
    s["WPCT"] = np.where(dec >= DECISIONS_FLOOR, s["W"] / dec.replace(0, np.nan), np.nan)

    # ---- league baseline + spread per season ----
    spread = s[s["IP"] >= SPREAD_IP_FLOOR].copy()
    lg = spread.groupby("yearID").agg(
        lg_ER=("ER", "sum"), lg_IP=("IP", "sum"), lg_H=("H", "sum"),
        lg_BB=("BB", "sum"), lg_SO=("SO", "sum"),
        sd_ERA=("ERA", "std"), sd_WHIP=("WHIP", "std"), sd_K9=("K9", "std"),
        sd_WPCT=("WPCT", "std"), sd_SV=("SV", "std"), mean_SV=("SV", "mean"),
    ).reset_index()
    lg["lg_ERA"] = lg["lg_ER"] * 9 / lg["lg_IP"]
    lg["lg_WHIP"] = (lg["lg_H"] + lg["lg_BB"]) / lg["lg_IP"]
    lg["lg_K9"] = lg["lg_SO"] * 9 / lg["lg_IP"]

    s = s.merge(lg[["yearID", "lg_ERA", "lg_WHIP", "lg_K9", "mean_SV",
                    "sd_ERA", "sd_WHIP", "sd_K9", "sd_WPCT", "sd_SV"]], on="yearID", how="left")

    s["z_era"] = (s["lg_ERA"] - s["ERA"]) / s["sd_ERA"]        # lower ERA -> positive
    s["z_whip"] = (s["lg_WHIP"] - s["WHIP"]) / s["sd_WHIP"]    # lower WHIP -> positive
    s["z_k9"] = (s["K9"] - s["lg_K9"]) / s["sd_K9"]
    s["z_wpct"] = (s["WPCT"] - 0.500) / s["sd_WPCT"]
    s["z_sv"] = (s["SV"] - s["mean_SV"]) / s["sd_SV"]

    q = s[s["IP"] >= SEASON_IP_FLOOR].copy()

    def season_score(row):
        parts = [("era", row["z_era"]), ("whip", row["z_whip"]), ("k9", row["z_k9"]),
                 ("wpct", row["z_wpct"]), ("sv", row["z_sv"])]
        num = den = 0.0
        for key, z in parts:
            if pd.notna(z):
                num += WEIGHTS[key] * z
                den += WEIGHTS[key]
        return num / den if den else np.nan

    q["season_score"] = q.apply(season_score, axis=1)
    q = q[q["season_score"].notna()].copy()
    q["season_saa"] = q["season_score"] * q["IP"] / IP_NORM

    def career(d):
        w = d["IP"]
        return pd.Series({
            "SAA_total": d["season_saa"].sum(),
            "SAA_rate": np.average(d["season_score"], weights=w),
            "z_era": np.average(d["z_era"].fillna(0), weights=w),
            "z_whip": np.average(d["z_whip"].fillna(0), weights=w),
            "z_k9": np.average(d["z_k9"].fillna(0), weights=w),
            "z_wpct": np.average(d["z_wpct"].fillna(0), weights=w),
            "z_sv": np.average(d["z_sv"].fillna(0), weights=w),
            "qualifying_seasons": len(d),
            "qualifying_IP": w.sum(),
        })

    car = q.groupby("playerID").apply(career).reset_index()

    # career counting totals (all seasons, not just qualifying)
    tot = s.groupby("playerID").agg(
        W=("W", "sum"), L=("L", "sum"), SV=("SV", "sum"), SO=("SO", "sum"),
        IP=("IP", "sum"), ER=("ER", "sum"), H=("H", "sum"), BB=("BB", "sum"),
        G=("G", "sum"), GS=("GS", "sum"), yr_min=("yearID", "min"), yr_max=("yearID", "max"),
    ).reset_index()
    tot["career_ERA"] = tot["ER"] * 9 / tot["IP"]
    tot["career_WHIP"] = (tot["H"] + tot["BB"]) / tot["IP"]
    tot["G"] = tot["G"].round().astype(int)
    tot["GS"] = tot["GS"].round().astype(int)

    # primary team (most outs pitched, career)
    team = (p.groupby(["playerID", "teamID"])["IPouts"].sum().reset_index()
            .sort_values("IPouts").groupby("playerID").tail(1).set_index("playerID")["teamID"])
    tot = tot.merge(team.rename("team"), on="playerID", how="left")

    war = pd.read_csv(HERE / "war_daily_pitch.txt")
    war["WAR"] = pd.to_numeric(war["WAR"], errors="coerce").fillna(0)
    war["IPouts"] = pd.to_numeric(war["IPouts"], errors="coerce").fillna(0)
    war["ERA_plus"] = pd.to_numeric(war["ERA_plus"], errors="coerce")
    wtot = war.groupby("player_ID")["WAR"].sum().rename("real_WAR")

    def weighted_eraplus(d):
        m = d["ERA_plus"].notna() & (d["IPouts"] > 0)
        if not m.any():
            return np.nan
        return float(np.average(d.loc[m, "ERA_plus"], weights=d.loc[m, "IPouts"]))
    eplus = war.groupby("player_ID").apply(weighted_eraplus).rename("ERA_plus")

    # war_daily_pitch keys on the BBRef id, which differs from the Lahman
    # playerID for a handful of pitchers (sabatcc01 -> sabatc.01, etc.);
    # People.csv's bbrefID bridges them.
    people = pd.read_csv(HERE / "People.csv")[["playerID", "nameFirst", "nameLast", "bbrefID"]]

    df = (car.merge(tot, on="playerID")
             .merge(people, on="playerID", how="left")
             .merge(wtot, left_on="bbrefID", right_index=True, how="left")
             .merge(eplus, left_on="bbrefID", right_index=True, how="left"))
    df["name"] = df["nameFirst"] + " " + df["nameLast"]
    df["real_WAR"] = df["real_WAR"].fillna(0)
    df["role"] = np.where(df["GS"] >= 0.5 * df["G"], "SP", "RP")

    hof = set()
    for r in csv.DictReader(open(HERE / "HallOfFame.csv")):
        if r["inducted"] == "Y" and r["category"] == "Player":
            hof.add(r["playerID"])
    df["hof"] = df["playerID"].isin(hof)

    pool = df[df["IP"] >= CAREER_IP_FLOOR].copy()
    pool = pool.sort_values("SAA_total", ascending=False).reset_index(drop=True)
    pool["rank_saa"] = pool.index + 1

    cols = ["rank_saa", "playerID", "name", "role", "team", "IP", "qualifying_IP",
            "qualifying_seasons", "W", "L", "SV", "SO", "G", "GS",
            "career_ERA", "career_WHIP", "ERA_plus", "real_WAR",
            "SAA_total", "SAA_rate", "z_era", "z_whip", "z_k9", "z_wpct", "z_sv",
            "yr_min", "yr_max", "hof"]
    pool[cols].to_csv(HERE / "saa_pitchers_full.csv", index=False)
    pool[cols].head(200).to_csv(HERE / "saa_top_200_pitchers.csv", index=False)

    print(f"Qualifying pool: {len(pool)} pitchers (career IP >= {CAREER_IP_FLOOR})")
    print(f"  top 200: {int(pool.head(200)['hof'].sum())} in Cooperstown, "
          f"{int((pool.head(200)['role'] == 'RP').sum())} relievers")
    print("\n--- top 25 ---")
    for r in pool.head(25).itertuples():
        star = " *HOF" if r.hof else ""
        print(f"{r.rank_saa:>3}  {r.name:<22} {r.role}  SAA={r.SAA_total:6.2f}  "
              f"{int(r.W)}-{int(r.L)}  {r.career_ERA:.2f} ERA  {int(r.SV)} SV  "
              f"ERA+ {r.ERA_plus:.0f}  {r.real_WAR:.0f} bWAR{star}")
    print("\n--- sanity ---")
    for name in ["Mariano Rivera", "Roger Clemens", "Walter Johnson", "Sandy Koufax",
                 "Nolan Ryan", "Trevor Hoffman", "Greg Maddux", "Jim Palmer",
                 "Whitey Ford", "Pedro Martinez", "Clayton Kershaw"]:
        row = pool[pool["name"] == name]
        if row.empty:
            print(f"{name}: not in top {len(pool)}")
        else:
            r = row.iloc[0]
            print(f"{name}: #{int(r['rank_saa'])}  SAA={r['SAA_total']:.2f}  "
                  f"z(ERA {r['z_era']:+.2f} WHIP {r['z_whip']:+.2f} K9 {r['z_k9']:+.2f} "
                  f"W% {r['z_wpct']:+.2f} SV {r['z_sv']:+.2f})")


if __name__ == "__main__":
    main()
