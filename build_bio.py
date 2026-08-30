"""Player bio lines for the Stats popup header, from the People table in
lahman_2025.mdb (the .mdb has birthCity/State/Country; People.csv doesn't).

player_bio(ids) -> {playerID: [ht, wt, born, place, bats, throws, debut, final]}
  ht     "6'3\""            (from height, inches)   "" if unknown
  wt     "205"             (from weight)            "" if unknown
  born   "08/02/1953"      (MM/DD/YYYY)             "" if incomplete
  place  "Westfield, AL  USA"                       "" if no city
  bats   "R" / "L" / "S"                            "" if unknown
  throws "R" / "L" / "S"                            "" if unknown
  debut  "1954-04-13"                               "" if unknown
  final  "1976-10-03"                               "" if unknown / active
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
MDB = HERE / "lahman_2025.mdb"


def _s(v):
    return "" if v is None else str(v).strip()


def _num(v):
    try:
        return str(int(float(v)))
    except (TypeError, ValueError):
        return ""


def player_bio(ids):
    from access_parser import AccessParser
    tbl = AccessParser(str(MDB)).parse_table("People")
    cols = list(tbl.keys())
    idx = {c: i for i, c in enumerate(cols)}
    ids = set(ids)

    out = {}
    for row in zip(*(tbl[c] for c in cols)):
        pid = _s(row[idx["playerID"]])
        if pid not in ids:
            continue

        h = _num(row[idx["height"]])
        ht = f"{int(h) // 12}'{int(h) % 12}\"" if h else ""
        wt = _num(row[idx["weight"]])

        y, m, d = _num(row[idx["birthYear"]]), _num(row[idx["birthMonth"]]), _num(row[idx["birthDay"]])
        born = f"{int(m):02d}/{int(d):02d}/{y}" if (y and m and d) else ""

        city, state, country = (_s(row[idx[k]]) for k in ("birthCity", "birthState", "birthCountry"))
        if city:
            place = city
            if state:
                place += f", {state}"
            if country:
                place += f"  {country}"
        else:
            place = country

        bats = {"B": "S"}.get(_s(row[idx["bats"]]), _s(row[idx["bats"]]))
        throws = _s(row[idx["throws"]])
        debut = _s(row[idx["debut"]])[:10]
        final = _s(row[idx["finalGame"]])[:10]

        out[pid] = [ht, wt, born, place, bats, throws, debut, final]
    return out
