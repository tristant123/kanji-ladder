# Kanji Ladder

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
level opens when 90% of this level's kanji are at Guru. Already know N5? Go to
Settings → *Skip ahead*.

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
