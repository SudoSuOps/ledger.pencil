#!/usr/bin/env python3
"""Build the static ledger site.

Reads every ledgers/<slug>/ledger.json, validates it with the Pencil ledger
script, and writes one HTML page per ledger plus an index into dist/.

A ledger that fails validation stops the build. The page shows only what
the script computes from the ledger file. Standard library only.

Usage: python3 build.py
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
import pencil_ledger as pl  # noqa: E402

LEDGERS = ROOT / "ledgers"
SITE = ROOT / "site"
DIST = ROOT / "dist"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

e = html.escape


def chip(state, kind=None):
    label = {"VERIFIED": "Verified", "UNKNOWN": "Unknown"}.get(state)
    if state == "NOT_VERIFIED":
        label = "Not verified: " + ("not checked" if kind == "NOT_CHECKED" else "does not hold")
    cls = {"VERIFIED": "ok", "UNKNOWN": "unk"}.get(state, "bad" if kind == "DOES_NOT_HOLD" else "open")
    return f'<span class="chip {cls}">{e(label)}</span>'


def page(title, body, depth=0):
    up = "../" * depth
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>{e(title)}</title>
<link rel="stylesheet" href="{up}style.css">
</head>
<body>
<header class="top"><a href="{up}">Pencil Ledger</a><span>Verified. Not verified. Unknown.</span></header>
<main>
{body}
</main>
<footer>
<p>A Pencil ledger is not a property disclosure and makes no recommendation on value or terms. Decisions belong to the parties.</p>
</footer>
</body>
</html>
"""


def review_banner(led):
    rev = led["review"]
    if rev["status"] == "REVIEWED":
        return f'<p class="banner reviewed">Reviewed by {e(rev["reviewer"])} on {e(rev["date"])}</p>'
    return '<p class="banner draft">Draft. Not reviewed by a human. Not for release.</p>'


def stated_cell(en):
    st = en.get("stated")
    if not st:
        return "—"
    return f'{e(st["value"])}<br><small>{e(st["source"])}</small>'


def ledger_page(slug, led):
    c, al = pl.counts(led), pl.alignments(led)
    act = pl.active_entries(led)
    h = pl.content_hash(led)
    B = []
    if led.get("demo"):
        B.append('<p class="banner demo">Demonstration ledger. Every fact on this page is invented.</p>')
    B.append(f"<h1>{e(led['subject'])}</h1>")
    B.append(review_banner(led))
    B.append('<dl class="meta">'
             f"<div><dt>Owner</dt><dd>{e(led['owner'])}</dd></div>"
             f"<div><dt>Authorized recipients</dt><dd>{e(', '.join(led['recipients']) or 'None named')}</dd></div>"
             f"<div><dt>As of</dt><dd>{e(led['as_of'])}</dd></div>"
             f"<div><dt>Stage</dt><dd>{e(led.get('stage') or 'Not stated')}</dd></div>"
             "</dl>")
    B.append('<section><h2>Count</h2><ul class="tiles">'
             f"<li><b>{c['verified']}</b> verified</li>"
             f"<li><b>{c['not_verified']}</b> not verified<small>{c['not_checked']} not checked, {c['does_not_hold']} do not hold</small></li>"
             f"<li><b>{c['unknown']}</b> unknown</li>"
             f"<li><b>{c['discoveries']}</b> discoveries open</li>"
             f"</ul><p class=\"note\">{c['objects']} objects. Counts, not odds: the ledger does not state a probability of closing.</p></section>")

    disc = [x for x in act if x.get("kind") == "DOES_NOT_HOLD" or x.get("omitted_from_documents") is True]
    if disc:
        B.append("<section><h2>Discoveries</h2>")
        for x in disc:
            st = x["stated"]
            B.append('<div class="disc">'
                     f"<h3>{e(x['object'])}</h3>"
                     f"<p><b>Stated:</b> {e(st['value'])} <small>[{e(st['source'])}]</small></p>"
                     f"<p><b>Verified:</b> {e(pl.checked_label(x.get('evidence')))}</p>"
                     f"<p><b>Result:</b> {e(x['result'])}</p></div>")
        B.append("</section>")

    if al:
        B.append('<section><h2>Alignment</h2><div class="scroll"><table><thead><tr>'
                 "<th>Term</th><th>Stated (days)</th><th>Party</th><th>Party requires (days)</th><th>Difference</th><th>Status</th>"
                 "</tr></thead><tbody>")
        for a in al:
            d = a["difference_days"]
            dtext = "0" if d == 0 else (f"{-d} short" if d < 0 else f"{d} to spare")
            ver = "verified" if a["required_state"] == "VERIFIED" else "not verified"
            B.append(f"<tr><td>{e(a['term'])}</td><td>{a['stated_days']}</td><td>{e(a['party'])}</td>"
                     f"<td>{a['required_days']} <small>({ver})</small></td><td>{e(dtext)}</td>"
                     f"<td>{e(a['status'].replace('_', ' '))}</td></tr>")
        B.append("</tbody></table></div>")
        notes = [f"{a['term']}: {n}." for a in al for n in a["notes"]]
        if notes:
            B.append("<ul>" + "".join(f"<li>{e(n)}</li>" for n in notes) + "</ul>")
        B.append("<h3>Cures supported by the evidence</h3>")
        cures = [a for a in al if a["cure_text"]]
        if cures:
            B.append("<ul>" + "".join(f"<li><b>{e(a['term'])}:</b> aligned terms on the verified facts: {e(a['cure_text'])}</li>" for a in cures) + "</ul>")
        else:
            B.append('<p class="note">None. A cure is stated only when the governing fact is verified and the terms do not align.</p>')
        B.append("</section>")

    B.append("<section><h2>Entries</h2>")
    groups = {}
    for x in act:
        groups.setdefault(x["key"].split(".")[0], []).append(x)
    for prefix, name in pl.CATEGORY.items():
        if prefix not in groups:
            continue
        B.append(f'<h3>{e(name)}</h3><div class="scroll"><table><thead><tr>'
                 "<th>Object</th><th>Stated</th><th>Checked against</th><th>State</th><th>Result</th></tr></thead><tbody>")
        for x in groups[prefix]:
            B.append(f"<tr><td>{e(x['object'])}<br><small class=\"mono\">{e(x['id'])} · {e(x['key'])}</small></td>"
                     f"<td>{stated_cell(x)}</td><td>{e(pl.checked_label(x.get('evidence')))}</td>"
                     f"<td>{chip(x['state'], x.get('kind'))}</td><td>{e(x['result'])}</td></tr>")
        B.append("</tbody></table></div>")
    B.append("</section>")

    opens = [x for x in act if x["state"] != "VERIFIED" and x.get("needs")]
    if opens:
        B.append("<section><h2>Open: what would settle each</h2><ul>"
                 + "".join(f"<li><b>{e(x['object'])}:</b> {e(x['needs'])}</li>" for x in opens) + "</ul></section>")

    superseded_ids = {x.get("supersedes") for x in led["entries"] if x.get("supersedes")}
    old = [x for x in led["entries"] if x["id"] in superseded_ids]
    if old:
        B.append("<section><h2>History</h2><p class=\"note\">Superseded entries are kept, never deleted.</p><ul>")
        for x in old:
            by = next(y for y in led["entries"] if y.get("supersedes") == x["id"])
            B.append(f"<li><span class=\"mono\">{e(x['id'])}</span> {e(x['object'])}: {e(x['result'])} "
                     f"<small>superseded by <span class=\"mono\">{e(by['id'])}</span></small></li>")
        B.append("</ul></section>")

    B.append('<section class="integrity"><h2>Integrity</h2>'
             f'<p>Ledger hash (SHA-256): <code id="hash">{h}</code></p>'
             '<p><button id="verify" type="button">Verify this page against the ledger file</button> '
             '<a href="ledger.json" download>Download ledger.json</a></p>'
             '<p id="verify-result" role="status" aria-live="polite"></p>'
             '<p class="note">The check downloads the ledger file, recomputes its hash in your browser, and compares it with the hash printed above.</p>'
             '</section><script src="../verify.js"></script>')
    return page(led["subject"], "\n".join(B), depth=1)


def index_page(items):
    B = ["<h1>Ledgers</h1>"]
    if not items:
        B.append("<p>No ledgers published.</p>")
    else:
        B.append('<div class="scroll"><table><thead><tr><th>Subject</th><th>Owner</th><th>As of</th><th>Review</th>'
                 "<th>Verified</th><th>Not verified</th><th>Unknown</th><th>Discoveries</th></tr></thead><tbody>")
        for slug, led in items:
            c = pl.counts(led)
            rev = "Reviewed" if led["review"]["status"] == "REVIEWED" else "Draft"
            B.append(f'<tr><td><a href="{e(slug)}/">{e(led["subject"])}</a></td><td>{e(led["owner"])}</td>'
                     f"<td>{e(led['as_of'])}</td><td>{rev}</td><td>{c['verified']}</td><td>{c['not_verified']}</td>"
                     f"<td>{c['unknown']}</td><td>{c['discoveries']}</td></tr>")
        B.append("</tbody></table></div>")
    return page("Pencil Ledger", "\n".join(B))


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    items, failed = [], False
    for d in sorted(p for p in LEDGERS.iterdir() if p.is_dir()):
        slug, f = d.name, d / "ledger.json"
        if not SLUG_RE.match(slug):
            print(f"SKIP {slug}: folder name must be lowercase letters, digits and hyphens"); failed = True; continue
        if not f.exists():
            print(f"SKIP {slug}: no ledger.json"); failed = True; continue
        led = json.loads(f.read_text(encoding="utf-8"))
        errs, warns = pl.validate(led)
        for w in warns:
            print(f"WARNING {slug}: {w}")
        if errs:
            failed = True
            print(f"INVALID {slug}:")
            for x in errs:
                print("  - " + x)
            continue
        out = DIST / slug
        out.mkdir()
        (out / "index.html").write_text(ledger_page(slug, led), encoding="utf-8")
        shutil.copy(f, out / "ledger.json")
        items.append((slug, led))
        print(f"OK {slug}: {pl.content_hash(led)[:16]}")
    if failed:
        print("Build stopped: fix the ledgers above. Nothing is published from an invalid ledger.")
        shutil.rmtree(DIST)
        return 1
    (DIST / "index.html").write_text(index_page(items), encoding="utf-8")
    for name in ("style.css", "verify.js", "_headers"):
        shutil.copy(SITE / name, DIST / name)
    print(f"Built {len(items)} ledger page(s) into dist/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
