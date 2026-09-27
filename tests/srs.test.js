const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const SRS = require("../js/srs.js");
const Kana = require("../js/kana.js");

function loadData() {
  const src = fs.readFileSync(path.join(__dirname, "../data/kanji-data.js"), "utf8");
  const win = {};
  new Function("window", src)(win);
  return win.KANJI_DATA;
}
const data = loadData();
const cat = SRS.Catalogue(data);
const H = SRS.HOUR;

test("stage penalties follow WaniKani", () => {
  assert.strictEqual(SRS.nextStage(1, 0), 2);
  assert.strictEqual(SRS.nextStage(8, 0), 9);
  assert.strictEqual(SRS.nextStage(4, 1), 3);
  assert.strictEqual(SRS.nextStage(4, 3), 2);
  assert.strictEqual(SRS.nextStage(6, 1), 4); // guru: doubled
  assert.strictEqual(SRS.nextStage(8, 2), 6);
  assert.strictEqual(SRS.nextStage(2, 5), 1); // floor at Apprentice 1
});

test("reviews land on the hour", () => {
  const now = Date.UTC(2026, 0, 1, 10, 37);
  assert.strictEqual(SRS.nextReviewAt(1, now), Date.UTC(2026, 0, 1, 14, 0));
  assert.strictEqual(SRS.nextReviewAt(9, now), null);
});

test("data is complete: 2136 kanji across N5-N1", () => {
  assert.strictEqual(data.kanji.length, 2136);
  const tiers = new Set(data.levels.map((l) => l.jlpt));
  assert.deepStrictEqual([...tiers], [5, 4, 3, 2, 1]);
  for (const k of data.kanji) {
    for (const p of k.parts) assert.ok(cat.get("r:" + p), "missing radical " + p + " for " + k.ch);
    // every radical is taught no later than the kanji that needs it
    for (const p of k.parts) assert.ok(cat.get("r:" + p).level <= k.level, k.ch + " before its radical " + p);
  }
  for (const v of data.vocab) {
    assert.strictEqual(v.level, Math.max(...v.k.map((c) => cat.get("k:" + c).level)), v.w);
  }
});

test("fresh start: only level-1 radicals are available", () => {
  const progress = { items: {}, settings: {} };
  const q = SRS.lessonQueue(cat, progress, 0);
  assert.ok(q.length > 0);
  assert.ok(q.every((it) => it.type === "radical" && it.level === 1));
});

test("guru-ing radicals unlocks kanji, guru-ing kanji unlocks vocab", () => {
  const progress = { items: {}, settings: {} };
  let now = 0;
  const radicals = SRS.lessonQueue(cat, progress, now);
  for (const r of radicals) SRS.learn(progress, r.id, now);
  for (let i = 0; i < 4; i++) for (const r of radicals) SRS.answer(progress, r.id, 0, 0, now);
  const kanji = SRS.lessonQueue(cat, progress, now);
  assert.ok(kanji.length > 0 && kanji.every((k) => k.type === "kanji"));
  for (const k of kanji) SRS.learn(progress, k.id, now);
  for (let i = 0; i < 4; i++) for (const k of kanji) SRS.answer(progress, k.id, 0, 0, now);
  const vocab = SRS.lessonQueue(cat, progress, now);
  assert.ok(vocab.some((v) => v.type === "vocab"));
  assert.strictEqual(SRS.currentLevel(cat, progress), 2);
});

test("review queue and forecast", () => {
  const progress = { items: {}, settings: {} };
  const now = Date.UTC(2026, 0, 1, 10, 0);
  SRS.learn(progress, "r:一", now);
  assert.strictEqual(SRS.reviewQueue(cat, progress, now).length, 0);
  assert.strictEqual(SRS.reviewQueue(cat, progress, now + 4 * H).length, 1);
  const f = SRS.forecast(progress, now, 24);
  assert.strictEqual(f.buckets[4], 1);
});

test("meaning answers: synonyms, typos, and Japanese input", () => {
  const k = cat.get("k:語");
  assert.strictEqual(SRS.checkMeaning(k, "Language").result, "correct");
  assert.strictEqual(SRS.checkMeaning(k, "languge").result, "close");
  assert.strictEqual(SRS.checkMeaning(k, "horse").result, "wrong");
  assert.strictEqual(SRS.checkMeaning(k, "ご").result, "retry");
  assert.strictEqual(SRS.checkMeaning(k, "chatter", ["chatter"]).result, "correct");
  const v = cat.get("v:食べる");
  assert.ok(v, "食べる is in the vocab");
  assert.strictEqual(SRS.checkMeaning(v, "eat").result, "correct");
  assert.strictEqual(SRS.checkMeaning(v, "to eat").result, "correct");
});

test("reading answers", () => {
  const k = cat.get("k:語");
  assert.strictEqual(SRS.checkReading(k, "go", Kana.toKana).result, "correct");
  assert.strictEqual(SRS.checkReading(k, "かたる", Kana.toKana).result, "correct");
  assert.strictEqual(SRS.checkReading(k, "ka", Kana.toKana).result, "wrong");
  assert.strictEqual(SRS.checkReading(k, "gx", Kana.toKana).result, "retry");
  const v = cat.get("v:食べる");
  assert.strictEqual(SRS.checkReading(v, "taberu", Kana.toKana).result, "correct");
  assert.strictEqual(SRS.checkReading(v, "タベル", (s) => Kana.kataToHira(Kana.toKana(s))).result, "correct");
});

test("skip to Guru unlocks dependents and never lowers an item", () => {
  const progress = { items: {}, settings: {} };
  const now = Date.UTC(2026, 0, 1, 10, 0);
  const k = cat.get("k:語");
  for (const id of cat.prereqs(k)) assert.ok(SRS.skipToGuru(progress, id, now));
  assert.ok(SRS.isUnlocked(cat, progress, k, 99));
  const e = progress.items["r:" + k.parts[0]];
  assert.strictEqual(e.stage, SRS.GURU);
  assert.strictEqual(e.at, now + 167 * H);
  // already Guru or higher: untouched
  SRS.burn(progress, "k:語", now);
  assert.strictEqual(SRS.skipToGuru(progress, "k:語", now), false);
  assert.strictEqual(progress.items["k:語"].stage, SRS.BURNED);
  // skipped items are reviewed like any other
  assert.strictEqual(SRS.reviewQueue(cat, progress, now + 167 * H).length, k.parts.length);
});
