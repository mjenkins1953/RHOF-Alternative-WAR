#!/usr/bin/env python3
"""Build the self-contained claude.ai Artifact bundle for the True Hall of Fame.

index.html + methodology.html + css/ + js/ are the source of truth. This
script *derives* rhof-home.artifact.html by inlining every external asset.

index.html is the landing page (hero only, since v1.040). A single file
can't navigate between pages, so the build splices in two more sections to
keep the bundle a usable showcase:
  * hitters.html's "Top 300 Hitters" <main> section + list
  * methodology.html's <main> (How SAA works, glossary, why-not-WAR)
Both go in just ahead of the footer. The pitchers list is NOT spliced --
its embed script reuses the same globals / element ids as the hitters one,
so both can't run in one document. The bundle's Pitchers / Your Hall /
Stats menu links are therefore inert; Methodology points at the spliced
section's #methodology anchor. Do not hand-edit the output.
"""
import base64
import pathlib

root = pathlib.Path("/Users/martinjenkins/Personal/Claude Projects/RHOF Alternative War")
out = root / "rhof-home.artifact.html"

html = (root / "index.html").read_text()
hitters_html = (root / "hitters.html").read_text()
methodology_html = (root / "methodology.html").read_text()
style_css = (root / "css/style.css").read_text()
embed_css = (root / "css/hitters-embed.css").read_text()
prefs_js = (root / "js/prefs.js").read_text()
career_js = (root / "js/saa-career.js").read_text()
embed_js = (root / "js/hitters-embed.js").read_text()
board_js = (root / "js/board-collapse.js").read_text()
# about.js carries RHOF_VERSION / RHOF_BUILD verbatim -- the single source
# of truth, hand-bumped by .001 on every commit + push.
about_js = (root / "js/about.js").read_text()

# pull the inside of <main>…</main> out of each source page, to be merged
# into ONE <main> in the bundle
saa_inner = hitters_html.split("<main>\n", 1)[1].split("\n</main>", 1)[0]
assert 'id="saaRows"' in saa_inner, "hitters.html SAA table missing"

method_inner = methodology_html.split("<main>\n", 1)[1].split("\n</main>", 1)[0]
assert 'id="methodology"' in method_inner, "methodology.html #methodology section missing"

img_data_uri = "data:image/png;base64," + base64.b64encode(
    (root / "img/hero-hall.png").read_bytes()).decode()

subs = [
    ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n',
     '<meta charset="utf-8">\n'),
    ('<link rel="stylesheet" href="css/style.css">\n'
     '</head>\n<body>\n',
     f"<style>\n{style_css}\n</style>\n<style>\n{embed_css}\n</style>\n"),
    ('\n</body>\n</html>\n', '\n'),
    ('<img src="img/hero-hall.png"', f'<img src="{img_data_uri}"'),
    # "Resume where you left off" is a multi-page idea -- drop it from the bundle
    ('      <p class="hero__resume" hidden><a href="#"></a></p>\n', ''),
    # splice the hitters list + the methodology sections in ahead of the
    # footer, wrapped in one <main>
    ('<footer class="site-foot">',
     f'<main>\n{saa_inner}\n\n{method_inner}\n</main>\n\n<footer class="site-foot">'),
    # hitters.html is unreachable in the single file -> scroll to the spliced section
    ('<a href="hitters.html" class="site-menu__link">Hitters</a>',
     '<a href="#view-hitters" class="site-menu__link">Hitters</a>'),
    # methodology.html is spliced in -> anchor to it
    ('<a href="methodology.html" class="site-menu__link">Methodology</a>',
     '<a href="#methodology" class="site-menu__link">Methodology</a>'),
    # pitchers list isn't in the bundle -> neutralise the link
    ('<a href="pitchers.html" class="site-menu__link">Pitchers</a>',
     '<a href="#" class="site-menu__link" aria-disabled="true">Pitchers</a>'),
    # Your Hall is its own page, not in the single-file bundle -> neutralise
    ('<a href="yourhall.html" class="site-menu__link">Your Hall</a>',
     '<a href="#" class="site-menu__link" aria-disabled="true">Your Hall</a>'),
    # Stats is its own page too -> neutralise
    ('<a href="stats.html" class="site-menu__link">Stats</a>',
     '<a href="#" class="site-menu__link" aria-disabled="true">Stats</a>'),
    # wordmark "home" link has nowhere to go in one file
    ('<a href="index.html" class="mark">', '<a href="#" class="mark">'),
    ('<script src="js/prefs.js"></script>\n'
     '<script src="js/resume.js"></script>\n'
     '<script src="js/about.js"></script>\n',
     f"<script>\n{prefs_js}\n</script>\n"
     f"<script>\n{career_js}\n</script>\n"
     f"<script>\n{embed_js}\n</script>\n"
     f"<script>\n{board_js}\n</script>\n"
     f"<script>\n{about_js}\n</script>\n"),
]
for old, new in subs:
    assert old in html, f"expected snippet not found in index.html:\n{old[:120]}"
    html = html.replace(old, new, 1)

out.write_text(html)
print(f"wrote {out}  ({len(html):,} bytes)")
