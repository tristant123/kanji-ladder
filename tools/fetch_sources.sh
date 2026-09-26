#!/usr/bin/env bash
# Download the open datasets the build uses into kanji/.sources/ (git-ignored).
# You only need this to rebuild data/*.js; the app itself runs on what's committed.
#
#   KANJIDIC2 + JMdict  (EDRDG, CC BY-SA 4.0)   via the jamdict-data package on PyPI
#   JLPT levels          (kanji-data, MIT; levels from Jonathan Waller's lists)
#   KanjiVG              (Ulrich Apel, CC BY-SA 3.0)  stroke order + component trees
set -eu
cd "$(dirname "$0")/.."
SRC=.sources
mkdir -p "$SRC/kvg"
PY="${PYTHON:-python3}"

if [ ! -s "$SRC/jamdict.db" ]; then
  "$PY" -m pip download --no-deps jamdict-data==1.5 -d "$SRC/pip"
  tar xzf "$SRC"/pip/jamdict_data-1.5.tar.gz -C "$SRC/pip"
  xz -dc "$SRC"/pip/jamdict_data-1.5/jamdict_data/jamdict.db.xz > "$SRC/jamdict.db"
  rm -rf "$SRC/pip"
fi

[ -s "$SRC/kanji.json" ] || curl -sSfL -o "$SRC/kanji.json" \
  https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json

# One KanjiVG file per Jōyō kanji.
"$PY" - "$SRC" <<'PY' > "$SRC/joyo.txt"
import sqlite3, sys
db = sqlite3.connect(sys.argv[1] + "/jamdict.db")
for (lit,) in db.execute("select literal from character where grade in ('1','2','3','4','5','6','8')"):
    print("%05x" % ord(lit))
PY
xargs -P 24 -I{} sh -c 'test -s '"$SRC"'/kvg/{}.svg || curl -sSf -o '"$SRC"'/kvg/{}.svg https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/{}.svg' < "$SRC/joyo.txt"
echo "sources ready: $(ls "$SRC/kvg" | wc -l) KanjiVG files"
