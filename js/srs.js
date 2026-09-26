// Spaced repetition, unlocking and answer checking. No DOM here, so it can be
// unit-tested in node (tests/srs.test.js).
//
// The schedule follows WaniKani's: nine stages, reviews rounded down to the
// hour, and wrong answers knocking an item back further the higher it was.
(function (root) {
  "use strict";

  const HOUR = 3600 * 1000;
  // Hours until the next review after reaching each stage (index = stage).
  const INTERVAL_H = [0, 4, 8, 23, 47, 167, 335, 719, 2879];
  const BURNED = 9;
  const GURU = 5;

  const STAGES = [
    { name: "Lesson", group: "lesson" },
    { name: "Apprentice 1", group: "apprentice" },
    { name: "Apprentice 2", group: "apprentice" },
    { name: "Apprentice 3", group: "apprentice" },
    { name: "Apprentice 4", group: "apprentice" },
    { name: "Guru 1", group: "guru" },
    { name: "Guru 2", group: "guru" },
    { name: "Master", group: "master" },
    { name: "Enlightened", group: "enlightened" },
    { name: "Burned", group: "burned" },
  ];

  function floorHour(t) {
    return Math.floor(t / HOUR) * HOUR;
  }

  function nextReviewAt(stage, now) {
    if (stage >= BURNED) return null;
    return floorHour(now + INTERVAL_H[stage] * HOUR);
  }

  // WaniKani's formula: drop ceil(wrong/2) stages, doubled from Guru up.
  function nextStage(stage, incorrect) {
    if (!incorrect) return Math.min(stage + 1, BURNED);
    const penalty = stage >= GURU ? 2 : 1;
    return Math.max(1, stage - Math.ceil(incorrect / 2) * penalty);
  }

  // ------------------------------------------------------------ the catalogue
  // Wraps KANJI_DATA with ids and lookups.
  function Catalogue(data) {
    const items = [];
    const byId = new Map();
    const add = (it) => {
      items.push(it);
      byId.set(it.id, it);
    };
    for (const r of data.radicals) add(Object.assign({ id: "r:" + r.ch, type: "radical" }, r));
    for (const k of data.kanji) add(Object.assign({ id: "k:" + k.ch, type: "kanji" }, k));
    for (const v of data.vocab) add(Object.assign({ id: "v:" + v.w, type: "vocab", ch: v.w }, v));
    items.forEach((it, i) => (it.order = i));

    const levels = data.levels;
    const byLevel = new Map(levels.map((l) => [l.n, { radical: [], kanji: [], vocab: [] }]));
    for (const it of items) byLevel.get(it.level)[it.type].push(it);

    // Reverse links: which kanji use a radical, which vocab use a kanji.
    const usedIn = new Map();
    const link = (from, to) => {
      if (!usedIn.has(from)) usedIn.set(from, []);
      usedIn.get(from).push(to);
    };
    for (const k of data.kanji) for (const p of k.parts) link("r:" + p, "k:" + k.ch);
    for (const v of data.vocab) for (const c of v.k) link("k:" + c, "v:" + v.w);

    // Kanji that share a phonetic component.
    const phonetic = new Map();
    for (const k of data.kanji) {
      if (!k.phon) continue;
      if (!phonetic.has(k.phon)) phonetic.set(k.phon, []);
      phonetic.get(k.phon).push("k:" + k.ch);
    }

    return {
      items,
      levels,
      byId,
      get: (id) => byId.get(id),
      level: (n) => byLevel.get(n),
      usedIn: (id) => usedIn.get(id) || [],
      phonetic: (ch) => phonetic.get(ch) || [],
      maxLevel: levels.length,
      // The items that must reach Guru before this one unlocks.
      prereqs(it) {
        if (it.type === "kanji") return it.parts.map((p) => "r:" + p);
        if (it.type === "vocab") return it.k.map((c) => "k:" + c);
        return [];
      },
    };
  }

  // ------------------------------------------------------------ progress
  // progress.items[id] = { stage, at (next review ms), unlocked, learned,
  //   burned, mc, mi, rc, ri }   (meaning/reading correct/incorrect totals)
  function stageOf(progress, id) {
    const p = progress.items[id];
    return p && p.stage ? p.stage : 0;
  }

  // The level you're on: level N is open once 90% of level N-1's kanji are
  // at Guru or above (WaniKani's rule). `settings.startLevel` lets you skip.
  function currentLevel(cat, progress) {
    let lvl = 1;
    for (let n = 1; n < cat.maxLevel; n++) {
      const ks = cat.level(n).kanji;
      const passed = ks.filter((k) => stageOf(progress, k.id) >= GURU).length;
      if (ks.length && passed / ks.length >= 0.9) lvl = n + 1;
      else break;
    }
    return Math.max(lvl, (progress.settings && progress.settings.startLevel) || 1);
  }

  function isUnlocked(cat, progress, it, level) {
    if (it.level > level) return false;
    return cat.prereqs(it).every((id) => stageOf(progress, id) >= GURU);
  }

  // Items ready for a lesson, in teaching order.
  function lessonQueue(cat, progress, now) {
    const level = currentLevel(cat, progress);
    const typeRank = { radical: 0, kanji: 1, vocab: 2 };
    const out = [];
    for (const it of cat.items) {
      if (it.level > level) continue;
      if (stageOf(progress, it.id) > 0) continue;
      if (isUnlocked(cat, progress, it, level)) out.push(it);
    }
    out.sort((a, b) => a.level - b.level || typeRank[a.type] - typeRank[b.type] || a.order - b.order);
    return out;
  }

  function reviewQueue(cat, progress, now) {
    const out = [];
    for (const id in progress.items) {
      const p = progress.items[id];
      if (p.stage >= 1 && p.stage < BURNED && p.at <= now && cat.byId.has(id)) out.push(cat.get(id));
    }
    return out;
  }

  // Reviews coming up, bucketed by hour, for the next `hours` hours.
  function forecast(progress, now, hours) {
    const start = floorHour(now);
    const buckets = new Array(hours).fill(0);
    let overdue = 0;
    for (const id in progress.items) {
      const p = progress.items[id];
      if (!(p.stage >= 1 && p.stage < BURNED)) continue;
      if (p.at <= now) { overdue++; continue; }
      const h = Math.floor((p.at - start) / HOUR);
      if (h >= 0 && h < hours) buckets[h]++;
    }
    return { overdue, buckets, start };
  }

  function entry(progress, id) {
    if (!progress.items[id]) progress.items[id] = { stage: 0, mc: 0, mi: 0, rc: 0, ri: 0 };
    return progress.items[id];
  }

  // A lesson finished: the item enters Apprentice 1.
  function learn(progress, id, now) {
    const e = entry(progress, id);
    e.stage = 1;
    e.learned = now;
    e.at = nextReviewAt(1, now);
    return e;
  }

  // A review finished. `wrongM` / `wrongR` = how many times each part was missed.
  function answer(progress, id, wrongM, wrongR, now) {
    const e = entry(progress, id);
    const before = e.stage || 1;
    const incorrect = wrongM + wrongR;
    e.stage = nextStage(before, incorrect);
    e.at = nextReviewAt(e.stage, now);
    e.mc += 1;
    e.mi += wrongM;
    e.rc += 1;
    e.ri += wrongR;
    e.last = now;
    if (e.stage === BURNED) e.burned = now;
    return { before, after: e.stage };
  }

  // ------------------------------------------------------------ checking
  function normMeaning(s) {
    return s
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9' -]/g, " ")
      .replace(/\b(to|the|a|an)\b/g, " ")
      .replace(/[-']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function tolerance(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 7) return 2;
    return 2 + Math.floor(len / 7);
  }

  function meaningAnswers(it, synonyms) {
    const base = it.type === "radical" ? [it.name].concat(it.alt || []) : it.m;
    return base.concat(synonyms || []);
  }

  // Returns { result: "correct" | "close" | "wrong" | "retry", message }
  function checkMeaning(it, input, synonyms) {
    const raw = input.trim();
    if (!raw) return { result: "retry", message: "Type an answer first." };
    if (/[぀-ヿ一-鿿]/.test(raw)) {
      return { result: "retry", message: "That's Japanese. This one wants the English meaning." };
    }
    const guess = normMeaning(raw);
    if (!guess) return { result: "retry", message: "Type an answer first." };
    const answers = meaningAnswers(it, synonyms).map(normMeaning).filter(Boolean);
    if (answers.includes(guess)) return { result: "correct" };
    let best = Infinity;
    for (const a of answers) {
      const d = levenshtein(guess, a);
      if (d <= tolerance(a.length)) best = Math.min(best, d);
    }
    if (best < Infinity) return { result: "close", message: "Close enough. Check the spelling." };
    return { result: "wrong" };
  }

  function kataToHira(s) {
    return s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function kanjiReadings(k) {
    const kun = k.kun.map((r) => r.replace(/-/g, "")).flatMap((r) => {
      const [stem, oku] = r.split(".");
      return oku ? [stem, stem + oku] : [stem];
    });
    return { on: k.on, kun };
  }

  function checkReading(it, input, toHira) {
    const guess = toHira(input.trim()).replace(/\s+/g, "");
    if (!guess) return { result: "retry", message: "Type an answer first." };
    if (/[a-z]/i.test(guess)) return { result: "retry", message: "Readings are answered in kana." };
    if (/[一-鿿]/.test(guess)) return { result: "retry", message: "Type the reading, not the kanji." };
    if (it.type === "vocab") {
      return it.r.map(kataToHira).includes(kataToHira(guess)) ? { result: "correct" } : { result: "wrong" };
    }
    const { on, kun } = kanjiReadings(it);
    const primary = it.pr === "kun" ? kun : on;
    if (primary.includes(guess)) return { result: "correct" };
    if (on.includes(guess) || kun.includes(guess)) {
      const want = it.pr === "kun" ? "kun'yomi" : "on'yomi";
      return { result: "correct", message: "Right, and worth knowing: the reading used most is the " + want + "." };
    }
    return { result: "wrong" };
  }

  const api = {
    HOUR, INTERVAL_H, BURNED, GURU, STAGES,
    floorHour, nextReviewAt, nextStage,
    Catalogue, stageOf, currentLevel, isUnlocked, lessonQueue, reviewQueue, forecast,
    learn, answer, entry,
    normMeaning, levenshtein, checkMeaning, checkReading, kanjiReadings, meaningAnswers,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.SRS = api;
})(this);
