#!/usr/bin/env python3
"""Build data/kanji-data.js and data/strokes.js from the open datasets.

    tools/fetch_sources.sh        # once: downloads into .sources/
    python3 tools/build_data.py   # regenerates data/*.js

Inputs
  .sources/jamdict.db    KANJIDIC2 (kanji, readings, meanings) + JMdict (vocab)
  .sources/kanji.json    new-JLPT level per kanji (only that field is used)
  .sources/kvg/*.svg     KanjiVG: stroke paths, component tree, phonetic marks
  content/*.json         our own writing: radical names, mnemonics, overrides

Everything the app shows that isn't dictionary data (radical names, mnemonics,
reading keywords) is original to this project and lives in content/.
"""
import collections
import json
import os
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, ".sources")
CONTENT = os.path.join(ROOT, "content")
OUT = os.path.join(ROOT, "data")

KV = "{http://kanjivg.tagaini.net}"
SVG = "{http://www.w3.org/2000/svg}"

# Kanji per level inside each JLPT tier. WaniKani runs ~30-40 kanji a level.
LEVEL_SIZE = {5: 27, 4: 34, 3: 34, 2: 34, 1: 36}
VOCAB_PER_KANJI = 3

# Components we treat as radicals even though they are not Jōyō kanji:
# the RADKFILE set plus the positional variants KanjiVG names.
PRIMITIVES = set(
    "一丨丶ノ乙亅二亠人个儿入ハ丷冂冖冫几凵刀力勹匕匚十卜卩厂厶又マ九ユ乃口囗土士夂夕"
    "大女子宀寸小尢尸屮山川巛工已巾干幺广廴廾弋弓ヨ彑彡彳也亡及久老心戈戸手支攵文斗斤"
    "方无日曰月木欠止歹殳比毛氏气水火爪父爻爿片牛犬王元井勿尤五屯巴毋玄瓦甘生用田疋癶"
    "白皮皿目矛矢石示禾穴立世巨冊母買牙瓜竹米糸缶羊羽而耒耳聿肉自至臼舌舟艮色虍虫血行"
    "衣西臣見角言谷豆豕豸貝赤走足身車辛辰酉釆里舛麦金長門隶隹雨青非免斉面革韭音頁風飛"
    "食首香品馬骨高髟鬼竜韋魚鳥鹵鹿麻亀黄黒黍歯鼓鼻丿乚亻氵艹辶⻌⻖⻏阝忄扌礻犭衤疒灬⺌"
    "刂罒⺤⺍⺨𠂉彐"
)

POS = [
    ("suru verb", "する verb"),
    ("Ichidan", "ichidan verb"),
    ("Godan", "godan verb"),
    ("adjective (keiyoushi)", "い adjective"),
    ("adjectival nouns", "な adjective"),
    ("adverb", "adverb"),
    ("counter", "counter"),
    ("numeric", "numeral"),
    ("suffix", "suffix"),
    ("prefix", "prefix"),
    ("pronoun", "pronoun"),
    ("expressions", "expression"),
    ("noun", "noun"),
]


def load_json(name, default):
    path = os.path.join(CONTENT, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def kata_to_hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


# --------------------------------------------------------------------- kanji
def load_kanjidic(db):
    kanji = {}
    q = "select id, literal, grade, freq, stroke_count from character where grade in ('1','2','3','4','5','6','8')"
    for cid, lit, grade, freq, strokes in db.execute(q).fetchall():
        on, kun, mean = [], [], []
        for rtype, val in db.execute(
            "select r_type, value from reading r join rm_group g on r.gid = g.id where g.cid = ?", (cid,)
        ):
            if rtype == "ja_on":
                v = kata_to_hira(val)
                if v not in on:
                    on.append(v)
            elif rtype == "ja_kun" and val not in kun:
                kun.append(val)
        for (m,) in db.execute(
            "select value from meaning m join rm_group g on m.gid = g.id where g.cid = ? "
            "and (m_lang = '' or m_lang is null or m_lang = 'en')", (cid,)
        ):
            if m not in mean:
                mean.append(m)
        kanji[lit] = {
            "ch": lit,
            "grade": int(grade),
            "freq": int(freq) if freq else None,
            "strokes": int(strokes),
            "on": on,
            "kun": kun,
            "meanings": mean,
        }
    return kanji


# ------------------------------------------------------------------- KanjiVG
def kvg_root(ch):
    path = os.path.join(SRC, "kvg", "%05x.svg" % ord(ch))
    for g in ET.parse(path).getroot().iter(SVG + "g"):
        if g.get("id") == "kvg:%05x" % ord(ch):
            return g
    raise ValueError("no KanjiVG root for " + ch)


def is_g(e):
    return e.tag == SVG + "g"


def elem(g):
    return g.get(KV + "element")


def has_named_child(g):
    return any(is_g(c) and elem(c) for c in g.iter() if c is not g)


def paths(g):
    return [p.get("d") for p in g.iter(SVG + "path")]


def decompose(ch, root, joyo):
    """Top-level meaningful parts of a kanji, WaniKani style.

    We stop descending at anything that is a Jōyō kanji or a recognised radical;
    other named groups (e.g. 吾 in 語) are broken into their own parts.
    Returns (parts, groups) where groups maps part -> first <g> seen for it.
    """
    found, groups, bare = [], {}, [False]

    def walk(g, depth):
        for c in g:
            if is_g(c):
                e = elem(c)
                if e and (e in joyo or e in PRIMITIVES or c.get(KV + "radical") or not has_named_child(c)):
                    found.append(e)
                    # a split element (kvg:part) only holds some of its strokes
                    if not c.get(KV + "part"):
                        groups.setdefault(e, c)
                else:
                    walk(c, depth + 1)
            elif depth == 0:
                bare[0] = True

    walk(root, 0)
    parts = []
    for p in found:
        if p not in parts:
            parts.append(p)
    # A kanji with no parts, one part plus loose strokes, or that is just one
    # named element, is taught as its own radical (口, 石, 一 ...).
    if not parts or (len(parts) == 1 and (bare[0] or len(found) == 1)):
        return [ch], {ch: root}
    return parts, groups


def phonetic(root):
    for g in root.iter(SVG + "g"):
        if g.get(KV + "phon"):
            return elem(g) or g.get(KV + "phon")
    return None


def bbox(ds):
    pts = [pt for d in ds for pt in _abs_points(d)]
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _abs_points(d):
    tokens = re.findall(r"[MmCcSsLlZz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    x = y = 0.0
    cmd = None
    i = 0
    out = []
    arity = {"M": 2, "L": 2, "C": 6, "S": 4}
    while i < len(tokens):
        t = tokens[i]
        if t.isalpha():
            cmd = t
            i += 1
            continue
        n = arity[cmd.upper()]
        vals = [float(v) for v in tokens[i : i + n]]
        i += n
        if cmd.islower():
            pts = [(x + vals[j], y + vals[j + 1]) for j in range(0, n, 2)]
        else:
            pts = [(vals[j], vals[j + 1]) for j in range(0, n, 2)]
        out.extend(pts)
        x, y = pts[-1]
        if cmd == "m":
            cmd = "l"
        elif cmd == "M":
            cmd = "L"
    return out


def radical_strokes(g):
    """Stroke paths of a component, reframed to fill a 109x109 box."""
    ds = paths(g)
    x0, y0, x1, y1 = bbox(ds)
    w, h = max(x1 - x0, 1), max(y1 - y0, 1)
    s = min(85 / w, 85 / h, 2.2)
    tx = 54.5 - (x0 + w / 2) * s
    ty = 54.5 - (y0 + h / 2) * s
    return {"d": ds, "t": [round(s, 3), round(tx, 2), round(ty, 2)]}


# -------------------------------------------------------------------- JMdict
PRIO_RANK = {"news1": 0, "ichi1": 0, "spec1": 1, "spec2": 2, "news2": 2, "gai1": 3}


def load_vocab(db, joyo):
    """Common JMdict words written only with Jōyō kanji (and kana)."""
    kanji_re = re.compile(r"[一-鿿々]")
    words = {}
    rows = db.execute(
        "select k.id, k.idseq, k.text, group_concat(p.text) from Kanji k join KJP p on p.kid = k.id group by k.id"
    ).fetchall()
    for kid, idseq, text, prio in rows:
        chars = [c for c in text if kanji_re.match(c) and c != "々"]
        if not chars or any(c not in joyo for c in chars) or len(text) > 5:
            continue
        tags = prio.split(",")
        nf = [int(t[2:]) for t in tags if t.startswith("nf")]
        rank = min(PRIO_RANK.get(t, 9) for t in tags)
        if rank > 2:
            continue
        if db.execute("select 1 from KJI where kid = ?", (kid,)).fetchone():
            continue  # irregular / outdated spelling
        score = (nf[0] if nf else 30 + rank * 10) + rank * 4
        prev = words.get(text)
        if prev and prev["score"] <= score:
            continue
        words[text] = {"idseq": idseq, "score": score, "chars": chars}

    out = {}
    for text, w in words.items():
        idseq = w["idseq"]
        readings = []
        for kana_id, kana, nokanji in db.execute("select id, text, nokanji from Kana where idseq = ?", (idseq,)):
            if nokanji:
                continue
            restr = [r for (r,) in db.execute("select text from KNR where kid = ?", (kana_id,))]
            if restr and text not in restr:
                continue
            prio = db.execute("select 1 from KNP where kid = ?", (kana_id,)).fetchone()
            readings.append((0 if prio else 1, kana))
        readings = [r for _, r in sorted(readings, key=lambda t: t[0])][:2]
        if not readings:
            continue
        senses, pos, usually_kana = [], None, False
        for (sid,) in db.execute("select id from Sense where idseq = ? order by id", (idseq,)):
            stagk = [t for (t,) in db.execute("select text from stagk where sid = ?", (sid,))]
            if stagk and text not in stagk:
                continue
            gl = [g for (g,) in db.execute("select text from SenseGloss where sid = ?", (sid,))]
            ps = [p for (p,) in db.execute("select text from pos where sid = ?", (sid,))]
            misc = [m for (m,) in db.execute("select text from misc where sid = ?", (sid,))]
            if not senses and any("usually written using kana" in m for m in misc):
                usually_kana = True
            if pos is None and ps:
                for key, label in POS:
                    if any(key in p for p in ps):
                        pos = label
                        break
            if gl:
                senses.append(gl)
            if len(senses) >= 3:
                break
        if not senses or usually_kana:
            continue
        meanings = []
        for s in senses:
            for g in s[:3]:
                if g not in meanings:
                    meanings.append(g)
        out[text] = {
            "w": text,
            "r": readings,
            "m": meanings[:6],
            "pos": pos or "",
            "k": list(dict.fromkeys(w["chars"])),
            "score": w["score"],
        }
    return out


def strip_kun(r):
    return r.split(".")[0].replace("-", "")


def primary_reading(k, vocab_list):
    """'on' or 'kun': whichever the common vocabulary actually uses more."""
    if not k["on"]:
        return "kun"
    if not k["kun"]:
        return "on"
    on_hits = kun_hits = 0
    kun_stems = [strip_kun(r) for r in k["kun"]]
    for v in vocab_list:
        reading = v["r"][0]
        if len(v["k"]) == 1:
            if any(reading.startswith(s) for s in kun_stems if s):
                kun_hits += 2 if v["w"][0] == k["ch"] else 1
        else:
            if any(o in reading for o in k["on"]):
                on_hits += 1
    # On'yomi is what compounds use, so it's the default (as on WaniKani);
    # kun'yomi wins only for kanji that mostly live on their own.
    return "kun" if kun_hits > 2 * on_hits + 1 else "on"


# --------------------------------------------------------------------- build
def main():
    db = sqlite3.connect(os.path.join(SRC, "jamdict.db"))
    with open(os.path.join(SRC, "kanji.json"), encoding="utf-8") as f:
        jlpt_src = json.load(f)

    kanji = load_kanjidic(db)
    joyo = set(kanji)
    print(len(joyo), "Jōyō kanji")

    radical_content = load_json("radicals.json", {})
    mnemonics = {}
    for name in sorted(os.listdir(CONTENT)):
        if name.startswith("mnemonics") and name.endswith(".json"):
            mnemonics.update(load_json(name, {}))
    vocab_content = load_json("vocab.json", {})
    names = load_json("names.json", {})
    for ch, name in names.items():
        mnemonics.setdefault(ch, {}).setdefault("name", name)

    strokes = {}
    groups_by_part = {}
    for ch, k in kanji.items():
        root = kvg_root(ch)
        parts, groups = decompose(ch, root, joyo)
        k["parts"] = parts
        for p, g in groups.items():
            groups_by_part.setdefault(p, g)
        ph = phonetic(root)
        if ph and ph != ch:
            k["phon"] = ph
        strokes[ch] = paths(root)
        k["jlpt"] = jlpt_src.get(ch, {}).get("jlpt_new") or 1

    # --- order: tier, then school grade, then frequency, then stroke count; a
    # kanji that another kanji in the same tier is built from goes first.
    def key(k):
        return (-k["jlpt"], k["grade"], k["freq"] or 3000, k["strokes"])

    ordered = []
    for tier in (5, 4, 3, 2, 1):
        batch = sorted((k for k in kanji.values() if k["jlpt"] == tier), key=key)
        placed = set()
        for k in batch:
            for p in k["parts"]:
                if p in kanji and kanji[p]["jlpt"] == tier and p not in placed and p != k["ch"]:
                    ordered.append(kanji[p])
                    placed.add(p)
            if k["ch"] not in placed:
                ordered.append(k)
                placed.add(k["ch"])
    levels = []
    level_no = 0
    for tier in (5, 4, 3, 2, 1):
        batch = [k for k in ordered if k["jlpt"] == tier]
        n = max(1, round(len(batch) / LEVEL_SIZE[tier]))
        size = len(batch) / n
        for i in range(n):
            level_no += 1
            chunk = batch[round(i * size) : round((i + 1) * size)]
            for k in chunk:
                k["level"] = level_no
            levels.append({"n": level_no, "jlpt": tier})

    # --- radicals
    radicals = {}
    for k in sorted(kanji.values(), key=lambda k: (k["level"], ordered.index(k))):
        for p in k["parts"]:
            if p in radicals:
                continue
            info = radical_content.get(p, {})
            name = info.get("name")
            if not name and p in kanji:
                name = mnemonics.get(p, {}).get("name") or clean_meaning(kanji[p]["meanings"])
            if not name:
                name = p
                print("  radical without a name:", p, file=sys.stderr)
            r = {"ch": p, "name": name, "level": k["level"]}
            if info.get("alt"):
                r["alt"] = info["alt"]
            if info.get("mnemonic"):
                r["mn"] = info["mnemonic"]
            g = groups_by_part.get(p)
            if p in kanji:
                r["svg"] = {"d": strokes[p], "t": [1, 0, 0]}
            elif g is not None:
                r["svg"] = radical_strokes(g)
            radicals[p] = r

    # --- vocabulary
    all_vocab = load_vocab(db, joyo)
    by_kanji = collections.defaultdict(list)
    for v in all_vocab.values():
        for c in v["k"]:
            by_kanji[c].append(v)
    chosen = {}
    for k in ordered:
        cands = by_kanji.get(k["ch"], [])
        lvl = lambda v: max(kanji[c]["level"] for c in v["k"])
        # Prefer words you can read by this level, short ones, common ones.
        cands = sorted(
            cands,
            key=lambda v: (
                lvl(v) > k["level"],
                0 if v["w"] == k["ch"] else 1,
                v["score"] + (len(v["k"]) - 1) * 3 + max(0, len(v["w"]) - 3) * 4,
            ),
        )
        mine = [c for c in cands if c["w"] in chosen][:VOCAB_PER_KANJI]
        extra_wanted = VOCAB_PER_KANJI - len(mine)
        for v in cands:
            if extra_wanted <= 0:
                break
            if v["w"] in chosen:
                continue
            chosen[v["w"]] = dict(v, level=lvl(v))
            extra_wanted -= 1
        k["primary"] = primary_reading(k, cands[:12])
    for w, over in vocab_content.items():
        if w in chosen:
            chosen[w].update(over)

    # --- assemble
    out_kanji = {}
    for k in ordered:
        mn = mnemonics.get(k["ch"], {})
        rec = {
            "ch": k["ch"],
            "level": k["level"],
            "jlpt": k["jlpt"],
            "grade": k["grade"],
            "strokes": k["strokes"],
            "freq": k["freq"],
            "m": order_meanings(k["meanings"], mn.get("name"), mn.get("also")),
            "on": k["on"],
            "kun": k["kun"],
            "pr": mn.get("primary", k["primary"]),
            "parts": k["parts"],
        }
        if k.get("phon"):
            rec["phon"] = k["phon"]
        if mn.get("meaning"):
            rec["mm"] = mn["meaning"]
        if mn.get("reading"):
            rec["rm"] = mn["reading"]
        out_kanji[k["ch"]] = rec

    out_vocab = {}
    for v in sorted(chosen.values(), key=lambda v: (v["level"], v["score"])):
        rec = {"w": v["w"], "r": v["r"], "m": v["m"], "pos": v["pos"], "k": v["k"], "level": v["level"]}
        if v.get("mm"):
            rec["mm"] = v["mm"]
        out_vocab[v["w"]] = rec

    data = {
        "version": 1,
        "levels": levels,
        "radicals": list(radicals.values()),
        "kanji": list(out_kanji.values()),
        "vocab": list(out_vocab.values()),
        "readingKeys": load_json("reading_keywords.json", {}),
    }
    os.makedirs(OUT, exist_ok=True)
    write_js(os.path.join(OUT, "kanji-data.js"), "KANJI_DATA", data)
    write_js(os.path.join(OUT, "strokes.js"), "KANJI_STROKES", strokes)

    check_mnemonics(out_kanji, radicals)
    tiers = collections.Counter(k["jlpt"] for k in kanji.values())
    print("levels:", len(levels), " radicals:", len(radicals), " vocab:", len(out_vocab))
    print("kanji per tier:", {"N%d" % t: tiers[t] for t in (5, 4, 3, 2, 1)})
    print("hand-written kanji mnemonics:", sum(1 for k in out_kanji.values() if "mm" in k))


JUNK = re.compile(r"kokuji|radical|counter for|\(no\.|^\W")


def order_meanings(ms, name=None, also=None):
    """Primary meaning first: ours if we wrote one, else the first clean one."""
    ms = [m for m in ms if not JUNK.search(m)] or ms
    first = name or clean_meaning(ms)
    out = [first] + list(also or [])
    for m in ms:
        if m.lower() not in (o.lower() for o in out):
            out.append(m)
    return out


def clean_meaning(ms):
    for m in ms:
        m = re.sub(r"\s*\(.*?\)", "", m).strip()
        if m and not m.endswith("-") and len(m) < 18:
            return m[0].upper() + m[1:]
    return ms[0] if ms else ""


def check_mnemonics(kanji, radicals):
    """Warn when a story names a radical the kanji isn't built from."""
    names = {}
    for r in radicals.values():
        names[r["ch"]] = {n.lower() for n in [r["name"]] + r.get("alt", [])}
    bad = 0
    for k in kanji.values():
        if "mm" not in k:
            continue
        allowed = set()
        for p in k["parts"]:
            allowed |= names.get(p, set())
        for used in re.findall(r"<radical>(.*?)</radical>", k["mm"]):
            u = used.lower()
            stems = {u, u.rstrip("s"), re.sub(r"(ing|ed|es)$", "", u), re.sub(r"ing$", "e", u)}
            if not any(st == a or st == a.rstrip("s") for st in stems for a in allowed):
                print("  %s: story mentions <radical>%s</radical>; parts are %s"
                      % (k["ch"], used, ", ".join(sorted(allowed))), file=sys.stderr)
                bad += 1
    if bad:
        print("  %d radical mismatches in mnemonics" % bad, file=sys.stderr)


def write_js(path, var, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_data.py. Do not edit; edit content/ and rebuild.\n")
        f.write("window.%s = " % var)
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("wrote", os.path.relpath(path, ROOT), "%.0f KB" % (os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()
