// Romaji -> hiragana, for typing readings on a keyboard without a Japanese IME.
// Works as-you-type (toKanaLive keeps a trailing "n" or half-typed syllable
// as romaji until it's unambiguous) and in one shot (toKana).
(function (root) {
  "use strict";

  const TABLE = {
    a: "あ", i: "い", u: "う", e: "え", o: "お",
    ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
    ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
    sa: "さ", si: "し", shi: "し", su: "す", se: "せ", so: "そ",
    za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
    ta: "た", ti: "ち", chi: "ち", tu: "つ", tsu: "つ", te: "て", to: "と",
    da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
    na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
    ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
    ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
    pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
    ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
    ya: "や", yu: "ゆ", yo: "よ",
    ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
    la: "ら", li: "り", lu: "る", le: "れ", lo: "ろ",
    wa: "わ", wi: "うぃ", we: "うぇ", wo: "を",
    nn: "ん", "n'": "ん", xn: "ん",
    xa: "ぁ", xi: "ぃ", xu: "ぅ", xe: "ぇ", xo: "ぉ",
    xya: "ゃ", xyu: "ゅ", xyo: "ょ", xtu: "っ", xtsu: "っ", ltu: "っ",
    lya: "ゃ", lyu: "ゅ", lyo: "ょ",
    sha: "しゃ", shu: "しゅ", she: "しぇ", sho: "しょ",
    cha: "ちゃ", chu: "ちゅ", che: "ちぇ", cho: "ちょ",
    ja: "じゃ", ju: "じゅ", je: "じぇ", jo: "じょ",
    tsa: "つぁ", fa: "ふぁ", fi: "ふぃ", fe: "ふぇ", fo: "ふぉ",
    "-": "ー",
  };
  // CyV combos: kya, gyu, nyo, ...
  const Y = { ya: "ゃ", yu: "ゅ", yo: "ょ", ye: "ぇ" };
  const I_ROW = { k: "き", g: "ぎ", s: "し", z: "じ", t: "ち", d: "ぢ", n: "に", h: "ひ", b: "び", p: "ぴ", m: "み", r: "り", l: "り", c: "ち", j: "じ" };
  for (const c in I_ROW) for (const y in Y) TABLE[c + y] = I_ROW[c] + Y[y];
  TABLE.sya = "しゃ"; TABLE.syu = "しゅ"; TABLE.syo = "しょ";

  const MAXLEN = 4;
  const isConsonant = (c) => /[bcdfghjklmpqrstvwxyz]/.test(c);

  // Convert as much of `s` as can be converted. With live=true, a trailing
  // lone "n" (could become な/に/...) stays as romaji.
  function convert(s, live) {
    s = s.toLowerCase();
    let out = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      // small tsu: doubled consonant (not n)
      if (isConsonant(c) && c !== "n" && s[i + 1] === c) {
        out += "っ";
        i += 1;
        continue;
      }
      // "nn" before a vowel is ん + n-syllable (konna -> こんな)
      if (c === "n" && s[i + 1] === "n" && s[i + 2] && "aiueoy".includes(s[i + 2])) {
        out += "ん";
        i += 1;
        continue;
      }
      let matched = false;
      for (let len = MAXLEN; len >= 2; len--) {
        const chunk = s.substr(i, len);
        if (chunk.length < len) continue;
        if (TABLE[chunk]) {
          out += TABLE[chunk];
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      if (TABLE[c] && c !== "n") {
        out += TABLE[c];
        i += 1;
        continue;
      }
      if (c === "n") {
        const next = s[i + 1];
        if (next === undefined) {
          if (live) { out += "n"; i += 1; continue; }
          out += "ん"; i += 1; continue;
        }
        if (!"aiueoyn'".includes(next)) { out += "ん"; i += 1; continue; }
        // "ny" + not yet a vowel, or other half-typed combo
        out += s.slice(i);
        break;
      }
      if (/[a-z]/.test(c)) {
        // Half-typed syllable (e.g. "k", "sh", "ky"): keep while typing.
        if (live && i + 3 >= s.length) { out += s.slice(i); break; }
        out += c; i += 1;
        continue;
      }
      out += c;
      i += 1;
    }
    return out;
  }

  const toKana = (s) => convert(s, false);
  const toKanaLive = (s) => convert(s, true);

  function kataToHira(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  const isKana = (s) => /^[ぁ-ゟ゠-ヿー]+$/.test(s);
  const hasLatin = (s) => /[a-z]/i.test(s);
  const hasJapanese = (s) => /[぀-ヿ一-鿿]/.test(s);

  const api = { toKana, toKanaLive, kataToHira, isKana, hasLatin, hasJapanese };
  if (typeof module !== "undefined") module.exports = api;
  else root.Kana = api;
})(this);
