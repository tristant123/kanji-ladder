const test = require("node:test");
const assert = require("node:assert");
const Kana = require("../js/kana.js");

test("basic syllables", () => {
  assert.strictEqual(Kana.toKana("taberu"), "たべる");
  assert.strictEqual(Kana.toKana("shinbun"), "しんぶん");
  assert.strictEqual(Kana.toKana("kyou"), "きょう");
  assert.strictEqual(Kana.toKana("gakkou"), "がっこう");
  assert.strictEqual(Kana.toKana("chotto"), "ちょっと");
  assert.strictEqual(Kana.toKana("tsukue"), "つくえ");
  assert.strictEqual(Kana.toKana("fuji"), "ふじ");
});

test("n handling", () => {
  assert.strictEqual(Kana.toKana("konna"), "こんな");
  assert.strictEqual(Kana.toKana("onnna"), "おんな");
  assert.strictEqual(Kana.toKana("kan"), "かん");
  assert.strictEqual(Kana.toKana("kin'en"), "きんえん");
  assert.strictEqual(Kana.toKana("hon'ya"), "ほんや");
  assert.strictEqual(Kana.toKana("nyuu"), "にゅう");
  assert.strictEqual(Kana.toKana("sanpo"), "さんぽ");
});

test("live typing keeps unfinished input", () => {
  assert.strictEqual(Kana.toKanaLive("ka"), "か");
  assert.strictEqual(Kana.toKanaLive("kan"), "かn");
  assert.strictEqual(Kana.toKanaLive("ky"), "ky");
  assert.strictEqual(Kana.toKanaLive("sh"), "sh");
  assert.strictEqual(Kana.toKanaLive("gakk"), "がっk");
  assert.strictEqual(Kana.toKanaLive("かn"), "かn");
  assert.strictEqual(Kana.toKanaLive("かnj"), "かんj");
  // re-feeding already converted text is stable
  assert.strictEqual(Kana.toKanaLive(Kana.toKanaLive("kanj") + "i"), "かんじ");
});

test("katakana normalisation", () => {
  assert.strictEqual(Kana.kataToHira("カンジ"), "かんじ");
  assert.ok(Kana.isKana("かんじ"));
  assert.ok(!Kana.isKana("kanji"));
});
