# Kanji Ladder · Anime Edition

This branch (`claude/kanji-anime`) is the anime-flavoured fork. Same kanji,
levels, SRS and mnemonics as the main app, plus:

- **Anime example lines.** Vocabulary shows a sentence about a real series
  (One Piece, Demon Slayer, Frieren, Spirited Away, ~40 shows), with the
  word highlighted, a play button and a tap-to-reveal translation. Kanji
  pages show lines from their words. Lines are written the way a Japanese
  writer would, kanji and all: **hover (or tap) any kanji for its
  furigana**, or turn on *Always show furigana* in Settings. So far every
  N5 word and every anime word has a line.
- **Anime words.** 160 extra words you hear constantly in anime (魔法, 先輩,
  覚悟, 異世界, 必殺技, 貴様...), marked アニメ. They're real dictionary
  words and unlock with their kanji like everything else.
- **An Anime page** to browse lines by series, and a line of the day on the
  dashboard.
- **Your own pictures.** Drop a screenshot named after a series key (see
  `content/anime_series.json`, e.g. `onepiece.jpg`) into `img/anime/` and it
  appears next to that series' lines. That folder is git-ignored: the
  repository only ever contains original text, never anyone's artwork.

The lines are original sentences about the shows. A handful quote a famous
catchphrase of a few words (「海賊王に俺はなる！」, 「月にかわっておしおきよ！」),
credited to the series. They live in `content/anime_lines_*.json` as
`"word": ["series", "Japanese", "English"]`, and the build checks each one.

Furigana are generated at build time with the Sudachi morphological
analyser (`pip install sudachipy sudachidict_core`). Where it guesses wrong,
usually names and counters, write the reading into the line yourself:
`{炭治郎|たんじろう}`, `{四人|よにん}`. Those always win.


A WaniKani-style spaced-repetition trainer for all 2,136 Jōyō kanji, laid out
from JLPT N5 to N1. Radicals first, then the kanji built from them, then real
vocabulary that uses those kanji. Everything is typed: meanings in English,
readings in kana (type romaji and it turns into kana as you go).

It's a static web page with no build step and no server. Progress stays in
your browser.

## Running it

- **On your computer:** open `index.html` in a browser. That's it.
- **As a local server** (needed for offline mode and the WaniKani import):
  `python3 -m http.server -d kanji 8000`, then go to http://localhost:8000.
- **On your phone:** publish it with GitHub Pages. In the repo, go to
  Settings → Pages and set *Source* to **GitHub Actions**, then run the
  **kanji-pages** workflow from the Actions tab. Open the URL it prints and
  "Add to Home Screen"; it works offline after the first load.

Progress lives in the browser you study in. Use Settings → *Export progress*
to back it up or move it to another device.

## How it's organised

| Levels | JLPT | Kanji |
|---|---|---|
| 1–3 | N5 | 79 |
| 4–8 | N4 | 166 |
| 9–19 | N3 | 367 |
| 20–30 | N2 | 367 |
| 31–62 | N1 (and Jōyō kanji not on any JLPT list) | 1,157 |

Each level has its radicals, ~30 kanji and ~90 vocabulary words.

**Unlocking, as on WaniKani.** A kanji unlocks when every radical in it
reaches *Guru*. A word unlocks when every kanji in it reaches Guru. The next
level opens when 90% of this level's kanji are at Guru.

**Skipping what you already know.** *Skip to Guru* puts an item straight at
Guru 1, which unlocks everything built on it. It still comes back for one
review a week later, so a wrong guess about what you know gets caught. You'll
find it on every item page, in lessons, in the lesson quiz and reviews, on
each level page (the whole level at once) and in Settings → *Skip ahead*
(every level up to one you pick). *Burn* is the stronger option: the item is
never shown again.

**SRS stages and intervals.** Apprentice 1–4 (4h, 8h, 1d, 2d), Guru 1–2 (1w,
2w), Master (1 month), Enlightened (4 months), then Burned. A wrong answer
drops an item ⌈wrong/2⌉ stages, doubled from Guru up, the same formula
WaniKani uses. Reviews come due on the hour.

**In a review:** Enter submits and moves on. After a wrong answer press
<kbd>F</kbd> for the item's full page or <kbd>Backspace</kbd> if it was a
typo. Small spelling slips in meanings are accepted. For kanji readings, any
correct on'yomi or kun'yomi counts; the page tells you which one to learn
first.

## Mnemonics

Every radical has an original name and story. All N5 to N2 kanji (979)
have hand-written meaning and reading mnemonics. They reuse the radical names you
learned, and each reading ties to a fixed *sound anchor* (こう is always a
koala, かん a kangaroo, しょう a showman...) that's used across all kanji
with that sound.

For kanji without a written story yet, the page shows the radical equation
and the sound anchor so you can build your own, and a note box saves it.
Writing your own mnemonics is the best way to remember them anyway.

Where it helps, a kanji page also points out its **phonetic component**,
such as 青 in 晴, 清, 精, which all read せい.

### WaniKani's mnemonics

WaniKani's content is theirs and isn't copied into this project. If you have a
WaniKani account, Settings → *WaniKani mnemonics* pulls theirs into your own
browser with your personal API token (read-only is enough). They then show up
under a fold on the matching radical, kanji and vocabulary pages. Nothing is
uploaded anywhere. This needs the app served over http(s) (a local server or
GitHub Pages), not opened as a file.

## Adding mnemonics

Content lives in `content/`:

- `radicals.json`: radical names and stories.
- `mnemonics_*.json`: kanji stories, keyed by kanji:
  ```json
  "語": {"name": "Language", "also": ["word"], "primary": "on",
         "meaning": "You <radical>say</radical> things ...",
         "reading": "A <b>goat</b>, <reading>ご</reading>, ..."}
  ```
  Markup: `<radical>`, `<kanji>`, `<vocab>`, `<reading>`, `<ja>`, `<b>`.
- `names.json`: a better primary meaning for a kanji (and so for its radical).
- `reading_keywords.json`: the sound anchor for each on'yomi.

Then rebuild the data:

```
tools/fetch_sources.sh        # once; downloads the dictionaries into .sources/
python3 tools/build_data.py   # writes data/kanji-data.js and data/strokes.js
```

The build warns when a story mentions a radical the kanji isn't made of.
The reading a kanji story teaches is the one the quiz asks for first; for
kanji without a story it's whichever reading the kanji's words actually use.

Checking the content:

```
python3 tools/check_content.py   # every <reading>/<ja> in the stories against KANJIDIC/JMdict
```

Where JMdict has two words with the same spelling (人 じん/ひと, 石 こく/いし),
the build teaches the everyday one and accepts the others' readings too. If
it picks wrong, name the reading in `content/vocab.json` under `"primary"`.

## Tests

```
node --test tests/*.test.js   # SRS rules, answer checking, romaji input, data checks
node tools/smoke.js out/      # drives the real app in headless Chromium (needs playwright)
```

CI runs both on every change to `kanji/` (`.github/workflows/kanji.yml`).

## Data and credits

- Kanji readings and meanings: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project).
  Vocabulary: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html). Both © the
  Electronic Dictionary Research and Development Group, used under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Stroke order and component trees: [KanjiVG](https://kanjivg.tagaini.net) ©
  Ulrich Apel, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- JLPT levels: Jonathan Waller's lists, via
  [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data) (MIT).
- The level structure, SRS timings and approach follow
  [WaniKani](https://www.wanikani.com); the idea of building kanji stories from
  named components goes back to James Heisig's *Remembering the Kanji*. All
  radical names and mnemonics here are original.

Because the generated data files include CC BY-SA material, `data/` is
shared under CC BY-SA 4.0 too.
