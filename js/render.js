// Shared rendering: item chips, the full item page (used by lessons, review
// "item info", and #/item), mnemonic markup, stroke-order diagrams, audio.
(function (root) {
  "use strict";

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Mnemonic markup: <radical>, <kanji>, <vocab>/<vocabulary>, <reading>,
  // <ja>, <b>, <i>. Everything else is shown as text.
  const TAGS = { radical: "mk-radical", kanji: "mk-kanji", vocab: "mk-vocab", vocabulary: "mk-vocab", reading: "mk-reading", ja: "mk-ja", b: "mk-b", i: "mk-i", meaning: "mk-b" };
  function markup(text) {
    let s = esc(text);
    s = s.replace(/&lt;(\/?)([a-z]+)&gt;/g, (m, close, tag) => {
      if (!TAGS[tag]) return m;
      return close ? "</span>" : '<span class="' + TAGS[tag] + '">';
    });
    return s.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>");
  }

  const TYPE_LABEL = { radical: "Radical", kanji: "Kanji", vocab: "Vocabulary" };

  function primaryMeaning(it) {
    if (it.type === "radical") return it.name;
    return it.m[0] || "";
  }

  function stageClass(progress, it) {
    const s = SRS.stageOf(progress, it.id);
    return "st-" + SRS.STAGES[s].group;
  }

  function glyph(it) {
    // Some radicals (e.g. 𠂉) have no font support; draw them from KanjiVG.
    if (it.type === "radical" && it.svg && needsDrawing(it.ch)) return radicalSVG(it, "glyph-svg");
    return esc(it.ch);
  }
  function needsDrawing(ch) {
    const cp = ch.codePointAt(0);
    return cp > 0xffff || (cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0x9fa6 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
  }

  function chip(it, progress, opts) {
    opts = opts || {};
    const locked = opts.locked ? " locked" : "";
    const sub = it.type === "vocab" ? esc(it.r[0]) : it.type === "kanji" ? esc((it.pr === "kun" ? it.kun : it.on)[0] || it.kun[0] || "") : "";
    return (
      '<a class="chip chip-' + it.type + " " + stageClass(progress, it) + locked + '" href="#/item/' + encodeURIComponent(it.id) + '" title="' + esc(SRS.STAGES[SRS.stageOf(progress, it.id)].name) + '">' +
      '<span class="chip-ch" lang="ja">' + glyph(it) + "</span>" +
      (it.anime ? '<span class="anime-dot" title="Anime word">アニメ</span>' : "") +
      (opts.brief ? "" : '<span class="chip-sub"><span lang="ja">' + sub + "</span><span>" + esc(primaryMeaning(it)) + "</span></span>") +
      "</a>"
    );
  }

  // ------------------------------------------------------------ audio
  let voice = null;
  function pickVoice() {
    if (!root.speechSynthesis) return null;
    const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    voice = vs.find((v) => /google|kyoko|otoya|haruka|nanami/i.test(v.name)) || vs[0] || null;
    return voice;
  }
  if (root.speechSynthesis) speechSynthesis.onvoiceschanged = pickVoice;
  function speak(text) {
    if (!root.speechSynthesis) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.85;
    if (voice || pickVoice()) u.voice = voice;
    speechSynthesis.speak(u);
    return true;
  }
  const canSpeak = () => !!root.speechSynthesis;

  // ------------------------------------------------------------ strokes
  let strokesLoading = null;
  function loadStrokes() {
    if (root.KANJI_STROKES) return Promise.resolve(root.KANJI_STROKES);
    if (!strokesLoading) {
      strokesLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "data/strokes.js";
        s.onload = () => resolve(root.KANJI_STROKES);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return strokesLoading;
  }

  function radicalSVG(r, cls) {
    const [sc, tx, ty] = r.svg.t;
    return (
      '<svg class="' + cls + '" viewBox="0 0 109 109" aria-label="' + esc(r.name) + '"><g transform="translate(' + tx + " " + ty + ") scale(" + sc + ')" style="stroke-width:' + (5 / sc).toFixed(2) + '">' +
      r.svg.d.map((d) => '<path d="' + d + '"/>').join("") +
      "</g></svg>"
    );
  }

  function strokeDiagram(paths) {
    return (
      '<svg class="strokes" viewBox="0 0 109 109" role="img" aria-label="stroke order">' +
      '<g class="grid"><line x1="54.5" y1="0" x2="54.5" y2="109"/><line x1="0" y1="54.5" x2="109" y2="54.5"/></g>' +
      '<g class="ghost">' + paths.map((d) => '<path d="' + d + '"/>').join("") + "</g>" +
      '<g class="ink">' + paths.map((d) => '<path d="' + d + '"/>').join("") + "</g>" +
      "</svg>"
    );
  }

  function animateStrokes(svg) {
    const ink = svg.querySelectorAll(".ink path");
    let t = 0;
    ink.forEach((p) => {
      const len = p.getTotalLength();
      const dur = Math.max(0.25, len / 120);
      p.style.transition = "none";
      p.style.strokeDasharray = len + " " + len;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset " + dur + "s linear " + t + "s";
      p.style.strokeDashoffset = 0;
      t += dur + 0.12;
    });
  }

  function mountStrokes(container, it) {
    const box = container.querySelector("[data-strokes]");
    if (!box) return;
    const draw = (paths, t) => {
      box.innerHTML = strokeDiagram(paths) + '<button class="btn small ghost-btn" type="button" data-replay>Replay</button>';
      const svg = box.querySelector("svg");
      if (t && t[0] !== 1) {
        // radicals cut out of a bigger kanji: reframe them to fill the box
        svg.querySelectorAll("g.ghost, g.ink").forEach((g) => {
          g.setAttribute("transform", "translate(" + t[1] + " " + t[2] + ") scale(" + t[0] + ")");
          g.style.strokeWidth = (4 / t[0]).toFixed(2);
        });
      }
      animateStrokes(svg);
      box.querySelector("[data-replay]").onclick = () => animateStrokes(svg);
    };
    if (it.type === "radical") {
      if (it.svg) draw(it.svg.d, it.svg.t);
      else box.textContent = "No stroke data for this one.";
      return;
    }
    loadStrokes()
      .then((all) => all && all[it.ch] && draw(all[it.ch]))
      .catch(() => (box.textContent = "Stroke data didn't load."));
  }

  // ------------------------------------------------------------ mnemonics
  function nameOf(cat, part) {
    const r = cat.get("r:" + part);
    return r ? r.name : part;
  }

  function meaningMnemonic(cat, k) {
    if (k.mm) return { html: markup(k.mm), own: true };
    const parts = k.parts.filter((p) => p !== k.ch);
    if (!parts.length) {
      const r = cat.get("r:" + k.ch);
      const same = r && r.name.toLowerCase() === (k.m[0] || "").toLowerCase();
      return {
        html: markup(
          "You already know this shape as the <radical>" + (r ? r.name : k.ch) + "</radical> radical" +
          (same ? ", and the kanji means the same thing: <kanji>" + k.m[0] + "</kanji>." : ". As a kanji it means <kanji>" + k.m[0] + "</kanji>. Picture the " + (r ? r.name.toLowerCase() : "shape") + " doing something that shows “" + k.m[0].toLowerCase() + "”.")
        ),
        own: false,
      };
    }
    const names = parts.map((p) => "<radical>" + nameOf(cat, p) + "</radical>");
    return {
      html: markup(
        names.join(" + ") + " = <kanji>" + k.m[0] + "</kanji>\n\n" +
        "No story is written for this one yet. Build one: put the " + parts.map((p) => nameOf(cat, p).toLowerCase()).join(" and the ") +
        " into a single scene that could only mean “" + k.m[0].toLowerCase() + "”. Make it strange or funny, then save it in your notes below. A story you make yourself sticks best."
      ),
      own: false,
    };
  }

  function readingMnemonic(cat, k, keys) {
    if (k.rm) return { html: markup(k.rm), own: true };
    const main = (k.pr === "kun" ? k.kun : k.on)[0];
    if (!main) return { html: "", own: false };
    const clean = main.split(".")[0].replace(/-/g, "");
    const kw = keys[clean];
    let s = "The reading to learn first is <reading>" + clean + "</reading> (" + (k.pr === "kun" ? "kun'yomi" : "on'yomi") + ").";
    if (kw) s += " Your sound anchor for " + clean + " is <b>" + kw + "</b>: drop " + kw + " into the scene with the " + (k.m[0] || "").toLowerCase() + ", doing something you won't forget.";
    return { html: markup(s), own: false };
  }

  function phoneticHint(cat, progress, k) {
    if (!k.phon) return "";
    const fam = cat.phonetic(k.phon).map((id) => cat.get(id)).filter((x) => x && x.ch !== k.ch);
    const shared = fam.filter((x) => x.on.some((o) => k.on.includes(o)));
    if (!shared.length) return "";
    const ro = shared[0].on.find((o) => k.on.includes(o));
    return (
      '<div class="hint"><b>Sound hint.</b> <span lang="ja">' + esc(k.phon) + "</span> is this kanji's phonetic part. " +
      "Other kanji built on it often read <span lang=\"ja\">" + esc(ro) + "</span> too:" +
      '<div class="chips small">' + shared.slice(0, 8).map((x) => chip(x, progress, { brief: true })).join("") + "</div></div>"
    );
  }

  function wkBlock(wk, rec, which) {
    if (!rec) return "";
    const m = which === "reading" ? rec.rm : rec.mm;
    const h = which === "reading" ? rec.rh : rec.mh;
    if (!m) return "";
    return (
      '<details class="wk"><summary>WaniKani ' + which + " mnemonic (from your account)</summary>" +
      "<p>" + markup(m) + "</p>" + (h ? '<p class="wk-hint"><b>Hint:</b> ' + markup(h) + "</p>" : "") +
      "</details>"
    );
  }

  function notesBlock(progress, it, field, label) {
    const v = (progress.notes[it.id] || {})[field] || "";
    return (
      '<label class="note"><span>' + esc(label) + "</span>" +
      '<textarea data-note="' + field + '" rows="2" placeholder="Your own ' + esc(label.toLowerCase()) + '. Saved automatically.">' + esc(v) + "</textarea></label>"
    );
  }

  // ------------------------------------------------------------ item page
  function itemView(ctx, it, opts) {
    opts = opts || {};
    const { cat, progress, wk } = ctx;
    const stage = SRS.stageOf(progress, it.id);
    const p = progress.items[it.id];
    const keys = (root.KANJI_DATA && root.KANJI_DATA.readingKeys) || {};
    const out = [];
    const jlpt = it.type === "radical" ? "" : it.type === "kanji" ? "N" + it.jlpt : "";
    out.push(
      '<section class="item-head item-' + it.type + '">' +
      '<div class="big" lang="ja">' + glyph(it) + "</div>" +
      '<div class="head-meta"><div class="type">' + TYPE_LABEL[it.type] + " · Level " + it.level + (jlpt ? " · " + jlpt : "") + "</div>" +
      '<h1>' + esc(primaryMeaning(it)) + (it.anime ? ' <span class="anime-badge">アニメ word</span>' : "") + "</h1>" +
      (it.type === "vocab" ? '<div class="reading-line" lang="ja">' + it.r.map(esc).join("、") + (canSpeak() ? ' <button class="btn icon" type="button" data-say="' + esc(it.r[0]) + '" aria-label="Play pronunciation">🔊</button>' : "") + "</div>" : "") +
      '<div class="stage ' + stageClass(progress, it) + '">' + esc(SRS.STAGES[stage].name) +
      (p && p.at && stage < SRS.BURNED ? " · next review " + esc(when(p.at)) : "") + "</div>" +
      "</div></section>"
    );

    if (it.type === "radical") {
      out.push(section("Name", "<p class=\"answers\"><b>" + esc(it.name) + "</b>" + (it.alt ? ", " + it.alt.map(esc).join(", ") : "") + "</p>" +
        (it.mn ? '<div class="mnemonic">' + markup(it.mn) + "</div>" : '<div class="mnemonic muted">' + markup(defaultRadicalStory(cat, it)) + "</div>") +
        wkBlock(wk && opts.showWK, wk && wk.r[it.ch], "meaning") + notesBlock(progress, it, "m", "Name note")));
      out.push(section("Stroke order", '<div class="strokes-box" data-strokes></div>'));
      const used = cat.usedIn(it.id).map((id) => cat.get(id));
      out.push(section("Found in kanji", '<div class="chips">' + used.map((k) => chip(k, progress)).join("") + "</div>"));
    }

    if (it.type === "kanji") {
      const parts = it.parts.map((p) => cat.get("r:" + p)).filter(Boolean);
      out.push(section("Radicals", '<div class="chips">' + parts.map((r) => chip(r, progress)).join('<span class="plus">+</span>') + "</div>"));
      const mm = meaningMnemonic(cat, it);
      out.push(section("Meaning",
        '<p class="answers"><b>' + esc(it.m[0]) + "</b>" + (it.m.length > 1 ? '<span class="alt">' + it.m.slice(1, 6).map(esc).join(", ") + "</span>" : "") + synonyms(progress, it) + "</p>" +
        '<div class="mnemonic' + (mm.own ? "" : " muted") + '">' + mm.html + "</div>" +
        wkBlock(wk && opts.showWK, wk && wk.k[it.ch], "meaning") + notesBlock(progress, it, "m", "Meaning note")));
      const rm = readingMnemonic(cat, it, keys);
      out.push(section("Readings",
        '<div class="readings">' +
        readingCol("On'yomi", it.on, it.pr === "on") + readingCol("Kun'yomi", it.kun, it.pr === "kun") +
        "</div>" +
        '<div class="mnemonic' + (rm.own ? "" : " muted") + '">' + rm.html + "</div>" + phoneticHint(cat, progress, it) +
        wkBlock(wk && opts.showWK, wk && wk.k[it.ch], "reading") + notesBlock(progress, it, "r", "Reading note")));
      out.push(section("Stroke order · " + it.strokes + " strokes", '<div class="strokes-box" data-strokes></div>'));
      const vocab = cat.usedIn(it.id).map((id) => cat.get(id));
      if (vocab.length) out.push(section("Vocabulary", '<div class="chips">' + vocab.map((v) => chip(v, progress)).join("") + "</div>"));
      const lines = vocab.filter((v) => v.ex).slice(0, 3);
      if (lines.length) out.push(section("In anime", lines.map((v) => animeLine(v, true)).join("")));
    }

    if (it.type === "vocab") {
      out.push(section("Meaning",
        '<p class="answers"><b>' + esc(it.m[0]) + "</b>" + (it.m.length > 1 ? '<span class="alt">' + it.m.slice(1).map(esc).join(", ") + "</span>" : "") + synonyms(progress, it) + "</p>" +
        (it.pos ? '<p class="pos">' + esc(it.pos) + "</p>" : "") +
        (it.mm ? '<div class="mnemonic">' + markup(it.mm) + "</div>" : '<div class="mnemonic muted">' + vocabStory(cat, it) + "</div>") +
        wkBlock(wk && opts.showWK, wk && wk.v[it.w], "meaning") + notesBlock(progress, it, "m", "Meaning note")));
      out.push(section("Reading",
        '<p class="answers" lang="ja"><b>' + it.r.map(esc).join("、") + "</b></p>" +
        '<div class="mnemonic muted">' + vocabReading(cat, it) + "</div>" +
        wkBlock(wk && opts.showWK, wk && wk.v[it.w], "reading") + notesBlock(progress, it, "r", "Reading note")));
      if (it.ex) out.push(section("In anime", animeLine(it)));
      const ks = it.k.map((c) => cat.get("k:" + c)).filter(Boolean);
      out.push(section("Kanji in this word", '<div class="chips">' + ks.map((k) => chip(k, progress)).join("") + "</div>"));
    }

    if (p && (p.mc || p.rc) && !opts.lesson) {
      const acc = (c, i) => (c + i ? Math.round((100 * c) / (c + i)) + "%" : "–");
      out.push(section("Your stats",
        '<p class="muted">Meaning ' + acc(p.mc, p.mi) + " · Reading " + (it.type === "radical" ? "n/a" : acc(p.rc, p.ri)) +
        (p.learned ? " · learned " + esc(new Date(p.learned).toLocaleDateString()) : "") + "</p>"));
    }
    if (!opts.lesson && !opts.quiz) {
      out.push(
        '<section class="item-actions">' +
        (stage < SRS.GURU ? '<button class="btn ghost-btn" data-act="guru">Skip to Guru</button>' : "") +
        (stage === 0 ? '<button class="btn ghost-btn" data-act="known">I know this well (burn)</button>' : '<button class="btn ghost-btn" data-act="reset">Reset this item</button>') +
        (stage > 0 && stage < SRS.BURNED ? '<button class="btn ghost-btn" data-act="known">Burn it</button>' : "") +
        "</section>"
      );
    }
    return '<article class="item" data-id="' + esc(it.id) + '">' + out.join("") + "</article>";
  }

  // ------------------------------------------------------------ anime lines
  const SERIES = {};
  ((root.KANJI_DATA && root.KANJI_DATA.series) || []).forEach((x) => (SERIES[x.key] = x));

  // Your own picture for a series, if you've put one in img/anime/<key>.jpg
  // (that folder is git-ignored: it's for screenshots you took yourself).
  function seriesArt(sr) {
    return '<img class="series-art" src="img/anime/' + esc(sr.key) + '.jpg" alt="" onerror="this.remove()">';
  }

  function seriesTag(sr) {
    return (
      '<a class="series-tag" href="#/anime/' + esc(sr.key) + '" style="--sc:' + esc(sr.color) + '">' +
      '<span class="series-icon" aria-hidden="true">' + esc(sr.icon) + "</span>" +
      '<span lang="ja">' + esc(sr.jp) + "</span><span class=\"series-en\">" + esc(sr.en) + "</span></a>"
    );
  }

  // "{漢字|かんじ}です" -> [{t:"漢字", r:"かんじ"}, {t:"です"}]
  function rubySegments(markup) {
    const out = [];
    const re = /\{([^|{}]+)\|([^{}]+)\}/g;
    let pos = 0, m;
    while ((m = re.exec(markup))) {
      if (m.index > pos) out.push({ t: markup.slice(pos, m.index) });
      out.push({ t: m[1], r: m[2] });
      pos = re.lastIndex;
    }
    if (pos < markup.length) out.push({ t: markup.slice(pos) });
    return out;
  }

  // Ruby HTML with the example's own word marked. Plain text is split where
  // the word starts and ends; a ruby group is marked whole if it overlaps.
  function rubyLine(markup, v) {
    const segs = rubySegments(markup);
    const plain = segs.map((x) => x.t).join("");
    let start = -1, len = 0;
    for (const cand of [v.w, v.w.replace(/[\u3040-\u309f]+$/, "")]) {
      if (cand && (start = plain.indexOf(cand)) >= 0) { len = cand.length; break; }
    }
    const end = start + len;
    let at = 0, html = "";
    for (const x of segs) {
      const a = at, b = at + x.t.length;
      at = b;
      if (x.r) {
        const inner = "<ruby>" + esc(x.t) + "<rt>" + esc(x.r) + "</rt></ruby>";
        html += start >= 0 && a < end && b > start ? "<mark>" + inner + "</mark>" : inner;
        continue;
      }
      if (start < 0 || b <= start || a >= end) { html += esc(x.t); continue; }
      const s1 = Math.max(start, a) - a, s2 = Math.min(end, b) - a;
      html += esc(x.t.slice(0, s1)) + "<mark>" + esc(x.t.slice(s1, s2)) + "</mark>" + esc(x.t.slice(s2));
    }
    return html.replace(/<\/mark><mark>/g, "");
  }

  function animeLine(v, withWord) {
    const [key, jp, en, ruby, kana] = v.ex;
    const sr = SERIES[key] || { key, jp: key, en: key, icon: "🎬", color: "#666" };
    return (
      '<figure class="anime-line" style="--sc:' + esc(sr.color) + '">' +
      seriesArt(sr) +
      '<div class="anime-body">' + seriesTag(sr) +
      (withWord ? ' <a class="anime-word" href="#/item/' + encodeURIComponent(v.id) + '" lang="ja">' + esc(v.w) + "</a>" : "") +
      '<blockquote lang="ja" title="Hover or tap a kanji for its reading">' + rubyLine(ruby || jp, v) +
      (canSpeak() ? ' <button class="btn icon" type="button" data-say="' + esc(kana || jp) + '" aria-label="Play the line">🔊</button>' : "") +
      "</blockquote>" +
      '<details class="anime-en"><summary>Translation</summary>' + esc(en) + "</details>" +
      "</div></figure>"
    );
  }

  function defaultRadicalStory(cat, r) {
    const k = cat.get("k:" + r.ch);
    if (k) return "This radical is the kanji <kanji>" + r.ch + "</kanji> used as a building block. Its radical name is <radical>" + r.name + "</radical>.";
    return "Its name is <radical>" + r.name + "</radical>. Look at the shape and find the " + r.name.toLowerCase() + " in it.";
  }

  function vocabStory(cat, v) {
    const ks = v.k.map((c) => cat.get("k:" + c)).filter(Boolean);
    if (ks.length === 1 && v.w.length === 1) {
      return markup("This word is the kanji <kanji>" + ks[0].m[0] + "</kanji> on its own, and it means the same thing.");
    }
    return markup(ks.map((k) => "<kanji>" + k.m[0] + "</kanji>").join(" + ") + " → <vocab>" + v.m[0] + "</vocab>. Say to yourself how the kanji meanings add up to the word.");
  }

  function vocabReading(cat, v) {
    const ks = v.k.map((c) => cat.get("k:" + c)).filter(Boolean);
    const okurigana = /[぀-ゟ]/.test(v.w);
    const parts = ks.map((k) => '<span lang="ja">' + esc(k.ch) + "</span>: " + esc(cleanReadings(k.on.concat(k.kun)).slice(0, 6).join("、")));
    let s = "";
    if (ks.length === 1 && okurigana) s = "A kanji followed by kana usually takes its <b>kun'yomi</b>. ";
    else if (ks.length > 1 && !okurigana) s = "Kanji compounds usually use each kanji's <b>on'yomi</b>. ";
    else if (ks.length === 1 && v.w.length === 1) s = "A kanji standing alone as a word usually takes its <b>kun'yomi</b>. ";
    return s + "Readings you know:<br>" + parts.join("<br>");
  }

  // KANJIDIC marks prefixes/suffixes with "-" (ひと-, -び); show each reading
  // once, with okurigana after a dot.
  function cleanReadings(list) {
    const out = [];
    for (const r of list) {
      const c = r.replace(/-/g, "").replace(".", "・");
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }

  function readingCol(label, list, primary) {
    const rs = cleanReadings(list);
    return (
      '<div class="rcol' + (primary ? " primary" : "") + '"><div class="rlabel">' + label + (primary ? " · learn this" : "") + "</div>" +
      '<div lang="ja">' + (rs.length ? rs.map(esc).join("、") : "—") + "</div></div>"
    );
  }

  function synonyms(progress, it) {
    const syn = progress.syn[it.id] || [];
    return (
      '<span class="syn">' + syn.map((s) => '<span class="syn-tag">' + esc(s) + ' <button type="button" data-unsyn="' + esc(s) + '" aria-label="remove">×</button></span>').join("") +
      '<button type="button" class="btn small ghost-btn" data-addsyn>+ synonym</button></span>'
    );
  }

  function section(title, body) {
    return '<section class="panel"><h2>' + esc(title) + "</h2>" + body + "</section>";
  }

  function when(t) {
    const d = t - Date.now();
    if (d <= 0) return "now";
    const h = d / SRS.HOUR;
    if (h < 1) return "within the hour";
    if (h < 24) return "in " + Math.round(h) + " h";
    const days = Math.round(h / 24);
    if (days < 60) return "in " + days + " day" + (days > 1 ? "s" : "");
    return "in " + Math.round(days / 30) + " months";
  }

  // Wire up the interactive bits of an item page (notes, audio, synonyms).
  function bindItem(container, ctx, it, onChange) {
    mountStrokes(container, it);
    container.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => speak(b.dataset.say)));
    container.querySelectorAll("textarea[data-note]").forEach((ta) => {
      ta.oninput = () => {
        const n = ctx.progress.notes[it.id] || (ctx.progress.notes[it.id] = {});
        n[ta.dataset.note] = ta.value;
        if (!n.m && !n.r) delete ctx.progress.notes[it.id];
        ctx.save();
      };
      ta.onkeydown = (e) => e.stopPropagation();
    });
    container.querySelectorAll("[data-addsyn]").forEach((b) => {
      b.onclick = () => {
        const s = prompt("Add a meaning you'll accept as correct:");
        if (!s || !s.trim()) return;
        const list = ctx.progress.syn[it.id] || (ctx.progress.syn[it.id] = []);
        if (!list.includes(s.trim())) list.push(s.trim());
        ctx.save();
        onChange && onChange();
      };
    });
    container.querySelectorAll("[data-unsyn]").forEach((b) => {
      b.onclick = () => {
        ctx.progress.syn[it.id] = (ctx.progress.syn[it.id] || []).filter((s) => s !== b.dataset.unsyn);
        if (!ctx.progress.syn[it.id].length) delete ctx.progress.syn[it.id];
        ctx.save();
        onChange && onChange();
      };
    });
  }

  root.Render = { rubyLine, animeLine, seriesTag, SERIES, esc, markup, chip, itemView, bindItem, speak, canSpeak, when, primaryMeaning, glyph, TYPE_LABEL, stageClass, loadStrokes };
})(this);
