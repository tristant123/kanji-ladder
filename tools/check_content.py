#!/usr/bin/env python3
"""Check the hand-written content against the dictionaries.

    python3 tools/check_content.py

For every kanji mnemonic:
  - each <reading>X</reading> must be a real reading of that kanji;
  - each <ja>word</ja> written with kanji must be a real JMdict word;
  - each <ja>kana</ja> must be a reading of that kanji, or of a word the
    mnemonic mentions (so "<ja>今日</ja> is read <ja>きょう</ja>" passes).
Prints every problem; exits non-zero if there are any.
"""
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
db = sqlite3.connect(os.path.join(ROOT, ".sources", "jamdict.db"))
src = open(os.path.join(ROOT, "data", "kanji-data.js"), encoding="utf-8").read()
data = json.loads(src[src.index("=") + 1 :].rstrip().rstrip(";"))
kanji = {k["ch"]: k for k in data["kanji"]}

KANJI_RE = re.compile(r"[一-鿿々]")


def hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def kanji_readings(k):
    out = set()
    for r in k["on"]:
        out.add(hira(r).replace("-", ""))
    for r in k["kun"]:
        r = r.replace("-", "")
        stem, _, oku = r.partition(".")
        out.add(stem)
        out.add(stem + oku)
    return out


_word_cache = {}


def word_readings(w):
    """All readings JMdict has for a spelling (empty set if it isn't a word)."""
    if w not in _word_cache:
        rs = set()
        for (idseq,) in db.execute("select idseq from Kanji where text = ?", (w,)):
            for (kana,) in db.execute("select text from Kana where idseq = ?", (idseq,)):
                rs.add(hira(kana))
        if not rs and not KANJI_RE.search(w):
            if db.execute("select 1 from Kana where text = ?", (w,)).fetchone():
                rs.add(hira(w))
        _word_cache[w] = rs
    return _word_cache[w]


# Checked by hand: kana that are deliberately not this kanji's reading.
ALLOW = {
    "七": ("いち",),                     # "so it isn't confused with いち"
    "母": ("おかあさん",),               # お母さん
    "兄": ("おにいさん",),               # お兄さん
    "姉": ("おねえさん",),               # お姉さん
    "部": ("へ",),                       # 部屋 (へや)
    "息": ("むす",),                     # 息子 (むすこ)
    "腹": ("なか",),                     # お腹 (おなか)
}
# Names and set phrases that aren't JMdict headwords.
NOT_WORDS = {"田中", "田中君", "東京湾", "六畳", "二十才"}

problems = 0


def report(ch, field, msg):
    global problems
    problems += 1
    print("%s [%s] %s" % (ch, field, msg))


for ch, k in kanji.items():
    for field in ("mm", "rm"):
        text = k.get(field)
        if not text:
            continue
        mine = kanji_readings(k)
        for r in re.findall(r"<reading>(.*?)</reading>", text):
            if hira(r) not in mine:
                report(ch, field, "<reading>%s</reading> is not a reading of %s (%s)" % (r, ch, "、".join(sorted(mine))))
        jas = re.findall(r"<ja>(.*?)</ja>", text)
        mentioned = set()
        for w in jas:
            if KANJI_RE.search(w):
                rs = word_readings(w)
                if not rs and w not in NOT_WORDS:
                    report(ch, field, "<ja>%s</ja> is not in JMdict" % w)
                mentioned |= rs
        for w in jas:
            if KANJI_RE.search(w):
                continue
            h = hira(w)
            # a reading of the kanji, a whole word's reading, or the part of a
            # mentioned word's reading the kanji takes (居酒屋 -> ざか, 切符 -> ぷ)
            ok = (h in mine or h in mentioned or any(h.startswith(r) for r in mine if len(r) > 1)
                  or any(h in r for r in mentioned) or h in ALLOW.get(ch, ()))
            if not ok:
                report(ch, field, "<ja>%s</ja> is not a reading of %s or of a word mentioned" % (w, ch))

# "<ja>時計</ja> is a clock": the English should appear in the word's glosses.
def glosses(w):
    out = []
    for (idseq,) in db.execute("select idseq from Kanji where text = ?", (w,)):
        for (sid,) in db.execute("select id from Sense where idseq = ?", (idseq,)):
            out += [g.lower() for (g,) in db.execute("select text from SenseGloss where sid = ?", (sid,))]
    return " | ".join(out)


CLAIM = re.compile(r"<ja>([^<]+)</ja>(?: \(<ja>[^<]+</ja>\))? (?:is|are|means) (?:an? |the |to )?([a-zA-Z][a-zA-Z' -]*)")
claims = []
for ch, k in kanji.items():
    for field in ("mm", "rm"):
        for w, eng in CLAIM.findall(k.get(field) or ""):
            if not KANJI_RE.search(w):
                continue
            g = glosses(w)
            words = [x for x in re.split(r"[ -]", eng.lower()) if x not in ("a", "an", "the", "to", "of", "it", "one", "read", "also", "written")]
            if not words or not g:
                continue
            key = words[0].rstrip("s")
            if key[:4] not in g:
                claims.append("%s [%s] <ja>%s</ja> is \"%s\"; JMdict: %s" % (ch, field, w, eng.strip(), g[:110]))
print("\n".join(claims))
print("%d meaning claims to check by hand" % len(claims))
print("%d problems" % problems)
sys.exit(1 if problems else 0)
