// Screens and routing. Hash routes so the app works from file:// as well as
// from a web server:  #/  #/lessons  #/reviews  #/levels  #/level/3
// #/jlpt  #/item/k:語  #/search/…  #/practice  #/settings
(function () {
  "use strict";
  const { esc, chip } = Render;
  const DATA = window.KANJI_DATA;
  const cat = SRS.Catalogue(DATA);
  const app = document.getElementById("app");

  const ctx = {
    cat,
    progress: Store.load(),
    wk: null,
    save() {
      if (!Store.save(ctx.progress)) toast("Couldn't save. Is storage full or disabled?", "down");
    },
    toast,
  };

  let toastTimer = null;
  function toast(text, kind) {
    const t = document.getElementById("toast");
    t.textContent = text;
    t.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 1800);
  }

  Store.wkGet().then((wk) => {
    if (wk) {
      ctx.wk = wk;
      if (/^#\/item/.test(location.hash)) route();
    }
  });

  // ------------------------------------------------------------ dashboard
  function dashboard() {
    const now = Date.now();
    const p = ctx.progress;
    const level = SRS.currentLevel(cat, p);
    const lessons = SRS.lessonQueue(cat, p, now);
    const reviews = SRS.reviewQueue(cat, p, now);
    const fc = SRS.forecast(p, now, 24);
    const L = cat.level(Math.min(level, cat.maxLevel));
    const tier = cat.levels[Math.min(level, cat.maxLevel) - 1].jlpt;
    const guru = (list) => list.filter((it) => SRS.stageOf(p, it.id) >= SRS.GURU).length;

    // SRS distribution
    const groups = { apprentice: 0, guru: 0, master: 0, enlightened: 0, burned: 0 };
    for (const id in p.items) {
      const s = p.items[id].stage;
      if (s >= 1) groups[SRS.STAGES[s].group]++;
    }

    let next = null;
    for (const id in p.items) {
      const e = p.items[id];
      if (e.stage >= 1 && e.stage < SRS.BURNED && e.at > now && (!next || e.at < next)) next = e.at;
    }

    const day = p.days[Store.today()] || { lessons: 0, reviews: 0, correct: 0 };
    const maxB = Math.max(1, ...fc.buckets);
    let running = reviews.length;
    const bars = fc.buckets
      .map((n, h) => {
        running += n;
        const t = new Date(fc.start + h * SRS.HOUR);
        return n
          ? '<div class="fc-row"><span class="fc-t">' + t.toLocaleTimeString([], { hour: "numeric" }) + '</span><span class="fc-bar" style="width:' + Math.max(4, (100 * n) / maxB) + '%"></span><span class="fc-n">+' + n + '</span><span class="fc-total">' + running + "</span></div>"
          : "";
      })
      .join("");

    const tiers = [5, 4, 3, 2, 1].map((t) => {
      const ks = cat.items.filter((it) => it.type === "kanji" && it.jlpt === t);
      const g = guru(ks);
      return (
        '<a class="tier" href="#/jlpt/' + t + '"><span class="tier-name">N' + t + "</span>" +
        '<span class="meter"><span style="width:' + (100 * g) / ks.length + '%"></span></span>' +
        '<span class="tier-n">' + g + " / " + ks.length + "</span></a>"
      );
    });

    app.innerHTML =
      '<section class="hero">' +
      '<div class="level-card"><div class="lv-label">Level</div><div class="lv-n">' + level + '</div><div class="lv-tier">JLPT N' + tier + "</div></div>" +
      '<a class="big-btn lessons' + (lessons.length ? "" : " empty") + '" href="#/lessons"><span class="n">' + lessons.length + "</span><span>Lessons</span></a>" +
      '<a class="big-btn reviews' + (reviews.length ? "" : " empty") + '" href="#/reviews"><span class="n">' + reviews.length + "</span><span>Reviews</span>" +
      (!reviews.length && next ? '<small>next ' + esc(Render.when(next)) + "</small>" : "") + "</a>" +
      "</section>" +
      '<section class="panel"><h2>Level ' + level + " progress</h2>" +
      progressLine("Radicals", L.radical, guru(L.radical)) +
      progressLine("Kanji", L.kanji, guru(L.kanji), Math.ceil(L.kanji.length * 0.9)) +
      '<p class="muted small">Get 90% of this level\'s kanji to Guru to open level ' + (level + 1) + ". Kanji unlock once their radicals reach Guru; vocabulary once its kanji do.</p>" +
      '<div class="chips tight">' + L.kanji.map((k) => chip(k, p, { brief: true, locked: !SRS.isUnlocked(cat, p, k, level) })).join("") + "</div>" +
      "</section>" +
      '<div class="cols">' +
      '<section class="panel"><h2>SRS</h2><div class="srs-grid">' +
      Object.keys(groups).map((g) => '<div class="srs-cell st-' + g + '"><b>' + groups[g] + "</b><span>" + g[0].toUpperCase() + g.slice(1) + "</span></div>").join("") +
      "</div>" +
      '<p class="muted small">Today: ' + day.lessons + " lessons · " + day.reviews + " reviews" + (day.reviews ? " · " + Math.round((100 * day.correct) / day.reviews) + "% all right" : "") + "</p>" +
      "</section>" +
      '<section class="panel"><h2>Next 24 hours</h2>' + (bars || '<p class="muted">No reviews coming up in the next day.</p>') + "</section>" +
      "</div>" +
      '<section class="panel"><h2>JLPT progress <span class="muted small">(kanji at Guru or above)</span></h2><div class="tiers">' + tiers.join("") + "</div></section>" +
      lineOfTheDay() +
      (Object.keys(p.items).length ? "" : welcome());
    app.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => Render.speak(b.dataset.say)));
  }

  // A line from something you've learned (or the first levels, before that),
  // chosen by the date so it changes once a day.
  function lineOfTheDay() {
    const all = withLines();
    if (!all.length) return "";
    const learned = all.filter((v) => SRS.stageOf(ctx.progress, v.id) > 0);
    const pool = learned.length >= 5 ? learned : all.filter((v) => v.level <= 3);
    const day = Math.floor(Date.now() / (24 * SRS.HOUR));
    const v = pool[day % pool.length];
    return '<section class="panel"><h2>Anime line of the day</h2>' + Render.animeLine(v, true) + '<p class="small"><a href="#/anime">All anime lines →</a></p></section>';
  }

  function progressLine(label, list, done, goal) {
    const pct = list.length ? (100 * done) / list.length : 0;
    return (
      '<div class="pline"><span>' + label + '</span><span class="meter">' +
      '<span style="width:' + pct + '%"></span>' + (goal ? '<i style="left:' + (100 * goal) / list.length + '%"></i>' : "") +
      '</span><span class="pnum">' + done + " / " + list.length + "</span></div>"
    );
  }

  function welcome() {
    return (
      '<section class="panel welcome"><h2>How this works</h2>' +
      "<ol><li><b>Radicals first.</b> Each level starts with the building blocks. Learn their names; they're the words your mnemonics are made of.</li>" +
      "<li><b>Then kanji.</b> A kanji unlocks when all its radicals reach <i>Guru</i>. You'll learn its meaning and the reading to know first.</li>" +
      "<li><b>Then vocabulary.</b> Real words that use the kanji, which is where the other readings get learned.</li>" +
      "<li><b>Reviews</b> come back at 4h, 8h, 1d, 2d, 1w, 2w, 1mo and 4mo. Miss one and it drops back. Pass the last one and it's burned.</li></ol>" +
      "<p>Levels 1–3 are JLPT N5, 4–8 N4, then N3, N2 and N1, covering all 2,136 Jōyō kanji. Already know N5? Skip ahead in <a href=\"#/settings\">Settings</a>.</p>" +
      '<p><a class="btn primary" href="#/lessons">Start your first lessons</a></p></section>'
    );
  }

  // ------------------------------------------------------------ lessons
  function lessons() {
    const now = Date.now();
    const queue = SRS.lessonQueue(cat, ctx.progress, now);
    if (!queue.length) {
      app.innerHTML =
        '<div class="empty-state"><h1>No lessons right now</h1><p class="muted">New items unlock as the ones before them reach Guru. Keep doing your reviews.</p><a class="btn" href="#/">Home</a></div>';
      return;
    }
    const batch = queue.slice(0, ctx.progress.settings.batch);
    let i = 0;
    const show = () => {
      const it = batch[i];
      app.innerHTML =
        '<div class="lesson">' +
        '<nav class="lesson-nav">' +
        batch.map((b, j) => '<button class="lchip lchip-' + b.type + (j === i ? " on" : "") + '" data-j="' + j + '" lang="ja">' + Render.glyph(b) + "</button>").join("") +
        '<span class="muted small">' + queue.length + " in queue</span></nav>" +
        Render.itemView(ctx, it, { lesson: true, showWK: ctx.progress.settings.showWK }) +
        '<div class="lesson-foot"><button class="btn" data-prev ' + (i ? "" : "disabled") + ">← Back</button>" +
        '<button class="btn ghost-btn" data-skip title="Already know it: mark as Guru and leave it out of this lesson">Skip to Guru</button>' +
        (i < batch.length - 1 ? '<button class="btn primary" data-next>Next →</button>' : '<button class="btn primary" data-quiz>Start the quiz</button>') +
        "</div></div>";
      Render.bindItem(app, ctx, it, show);
      app.querySelectorAll("[data-j]").forEach((b) => (b.onclick = () => ((i = +b.dataset.j), show())));
      app.querySelector("[data-prev]").onclick = () => (i--, show());
      const n = app.querySelector("[data-next]");
      if (n) n.onclick = () => (i++, show());
      const q = app.querySelector("[data-quiz]");
      if (q) q.onclick = () => Quiz.start(ctx, app, batch, "lesson");
      app.querySelector("[data-skip]").onclick = () => {
        SRS.skipToGuru(ctx.progress, it.id, Date.now());
        ctx.save();
        toast(Render.primaryMeaning(it) + ": skipped to Guru");
        batch.splice(i, 1);
        if (!batch.length) return lessons();
        i = Math.min(i, batch.length - 1);
        show();
      };
      if (it.type === "vocab" && ctx.progress.settings.autoplay) Render.speak(it.r[0]);
      window.scrollTo(0, 0);
    };
    lessonKeys = (e) => {
      if (!app.querySelector(".lesson") || /TEXTAREA|INPUT/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "Enter") {
        const b = app.querySelector("[data-next]") || app.querySelector("[data-quiz]");
        b && b.click();
      } else if (e.key === "ArrowLeft" && i > 0) {
        i--;
        show();
      }
    };
    show();
  }
  let lessonKeys = null;
  document.addEventListener("keydown", (e) => lessonKeys && lessonKeys(e));

  // ------------------------------------------------------------ reviews
  function reviews() {
    const queue = SRS.reviewQueue(cat, ctx.progress, Date.now());
    if (!queue.length) {
      app.innerHTML = '<div class="empty-state"><h1>No reviews due</h1><p class="muted">Come back later, or do some lessons.</p><a class="btn" href="#/">Home</a></div>';
      return;
    }
    Quiz.start(ctx, app, queue, "review");
  }

  // ------------------------------------------------------------ browse
  function levelsView(tierFilter) {
    const p = ctx.progress;
    const cur = SRS.currentLevel(cat, p);
    const tiers = tierFilter ? [tierFilter] : [5, 4, 3, 2, 1];
    app.innerHTML =
      '<h1 class="page-title">' + (tierFilter ? "JLPT N" + tierFilter : "Levels") + "</h1>" +
      (tierFilter ? "" : '<p class="muted">Click a level to see everything in it. Colours show your SRS stage.</p>') +
      tiers
        .map((t) => {
          const lv = cat.levels.filter((l) => l.jlpt === t);
          return (
            '<section class="tier-block"><h2>N' + t + ' <span class="muted small">levels ' + lv[0].n + "–" + lv[lv.length - 1].n + "</span></h2>" +
            lv
              .map((l) => {
                const L = cat.level(l.n);
                return (
                  '<div class="level-row' + (l.n > cur ? " future" : "") + (l.n === cur ? " current" : "") + '"><a class="lv-link" href="#/level/' + l.n + '">' + l.n + "</a>" +
                  '<div class="chips tight">' + L.kanji.map((k) => chip(k, p, { brief: true })).join("") + "</div></div>"
                );
              })
              .join("") +
            "</section>"
          );
        })
        .join("");
  }

  function jlptIndex() {
    app.innerHTML =
      '<h1 class="page-title">JLPT</h1><p class="muted">The kanji are split by the JLPT level they are usually tested at, then into WaniKani-sized levels. Jōyō kanji outside the JLPT lists are grouped with N1.</p>' +
      '<div class="tiers big">' +
      [5, 4, 3, 2, 1]
        .map((t) => {
          const ks = cat.items.filter((it) => it.type === "kanji" && it.jlpt === t);
          const g = ks.filter((it) => SRS.stageOf(ctx.progress, it.id) >= SRS.GURU).length;
          const lv = cat.levels.filter((l) => l.jlpt === t);
          return (
            '<a class="tier" href="#/jlpt/' + t + '"><span class="tier-name">N' + t + "</span>" +
            '<span class="meter"><span style="width:' + (100 * g) / ks.length + '%"></span></span>' +
            '<span class="tier-n">' + g + " / " + ks.length + " kanji · levels " + lv[0].n + "–" + lv[lv.length - 1].n + "</span></a>"
          );
        })
        .join("") +
      "</div>";
  }

  function levelView(n) {
    const p = ctx.progress;
    const L = cat.level(n);
    if (!L) return notFound();
    const cur = SRS.currentLevel(cat, p);
    const block = (label, list) =>
      '<section class="panel"><h2>' + label + ' <span class="muted small">' + list.length + "</span></h2>" +
      '<div class="chips">' + list.map((it) => chip(it, p, { locked: !SRS.isUnlocked(cat, p, it, cur) && SRS.stageOf(p, it.id) === 0 })).join("") + "</div></section>";
    app.innerHTML =
      '<div class="level-head"><a class="btn small ghost-btn" href="#/level/' + (n - 1) + '"' + (n > 1 ? "" : " hidden") + ">←</a>" +
      '<h1 class="page-title">Level ' + n + ' <span class="muted">· JLPT N' + cat.levels[n - 1].jlpt + "</span></h1>" +
      '<a class="btn small ghost-btn" href="#/level/' + (n + 1) + '"' + (n < cat.maxLevel ? "" : " hidden") + ">→</a></div>" +
      block("Radicals", L.radical) + block("Kanji", L.kanji) + block("Vocabulary", L.vocab) +
      '<div class="row"><a class="btn" href="#/practice/level/' + n + '">Practice this level</a>' +
      '<button class="btn ghost-btn" id="skip-level">Skip this level to Guru</button></div>';
    document.getElementById("skip-level").onclick = () => {
      const items = L.radical.concat(L.kanji, L.vocab).filter((it) => SRS.stageOf(p, it.id) < SRS.GURU);
      if (!items.length) return toast("Everything here is already Guru or above");
      if (!confirm("Mark " + items.length + " items in level " + n + " as Guru? They skip their lessons and come back for review in a week.")) return;
      const now = Date.now();
      items.forEach((it) => SRS.skipToGuru(p, it.id, now));
      ctx.save();
      toast(items.length + " items skipped to Guru");
      levelView(n);
    };
  }

  function itemPage(id) {
    const it = cat.get(id);
    if (!it) return notFound();
    const draw = () => {
      app.innerHTML = Render.itemView(ctx, it, { showWK: ctx.progress.settings.showWK });
      Render.bindItem(app, ctx, it, draw);
      app.querySelectorAll("[data-act]").forEach(
        (b) =>
          (b.onclick = () => {
            if (b.dataset.act === "guru") {
              SRS.skipToGuru(ctx.progress, it.id, Date.now());
              toast("Skipped to Guru");
            } else if (b.dataset.act === "known") {
              SRS.burn(ctx.progress, it.id, Date.now());
              toast("Burned");
            } else if (confirm("Put this item back to the start? Its SRS progress is lost.")) {
              delete ctx.progress.items[it.id];
              toast("Reset");
            }
            ctx.save();
            draw();
          })
      );
    };
    draw();
  }

  // ------------------------------------------------------------ search
  function search(q) {
    q = q.trim();
    const p = ctx.progress;
    let hits = [];
    if (q) {
      const kana = Kana.kataToHira(Kana.toKana(q.toLowerCase()));
      const low = q.toLowerCase();
      const hasJa = Kana.hasJapanese(q);
      for (const it of cat.items) {
        let score = -1;
        if (hasJa && it.ch.includes(q)) score = it.ch === q ? 0 : 2;
        else if (it.type === "vocab" && it.r.some((r) => Kana.kataToHira(r) === kana)) score = 1;
        else if (it.type === "kanji" && it.on.concat(it.kun.map((r) => r.split(".")[0])).includes(kana) && !/[a-z]/.test(kana)) score = 1;
        else if (!hasJa && low.length > 1) {
          const ms = it.type === "radical" ? [it.name] : it.m;
          if (ms.some((m) => m.toLowerCase() === low)) score = 1;
          else if (ms.some((m) => m.toLowerCase().includes(low))) score = 3;
        }
        if (score >= 0) hits.push([score, it]);
      }
      hits.sort((a, b) => a[0] - b[0] || a[1].order - b[1].order);
      hits = hits.slice(0, 120).map((h) => h[1]);
    }
    // Single kanji typed in: offer its page directly
    app.innerHTML =
      '<h1 class="page-title">Search</h1>' +
      (q ? '<p class="muted">' + hits.length + (hits.length === 120 ? "+" : "") + " results for “" + esc(q) + "”</p>" : "") +
      '<div class="chips">' + hits.map((it) => chip(it, p)).join("") + "</div>";
  }

  // ------------------------------------------------------------ practice
  function practice(arg) {
    const p = ctx.progress;
    const learned = cat.items.filter((it) => SRS.stageOf(p, it.id) > 0);
    const now = Date.now();
    const sets = {
      recent: learned.filter((it) => p.items[it.id].learned && now - p.items[it.id].learned < 3 * 24 * SRS.HOUR),
      missed: learned.filter((it) => {
        const e = p.items[it.id];
        const tries = e.mc + e.rc;
        return tries && (e.mi + e.ri) / tries > 0.25;
      }),
      apprentice: learned.filter((it) => SRS.stageOf(p, it.id) < SRS.GURU),
      burned: learned.filter((it) => SRS.stageOf(p, it.id) === SRS.BURNED),
    };
    if (arg) {
      let items;
      const m = /^level\/(\d+)$/.exec(arg);
      if (m) {
        const L = cat.level(+m[1]);
        items = L ? L.radical.concat(L.kanji, L.vocab) : [];
      } else items = sets[arg] || [];
      if (!items.length) {
        toast("Nothing in that set yet.");
        location.hash = "#/practice";
        return;
      }
      Quiz.start(ctx, app, Quiz.shuffle(items.slice()).slice(0, 50), "practice");
      return;
    }
    const card = (key, title, desc) =>
      '<a class="practice-card' + (sets[key].length ? "" : " empty") + '" href="#/practice/' + key + '"><b>' + title + "</b><span>" + desc + '</span><span class="n">' + sets[key].length + "</span></a>";
    app.innerHTML =
      '<h1 class="page-title">Practice</h1><p class="muted">Extra rounds that don\'t touch your SRS schedule. Up to 50 random items per round.</p>' +
      '<div class="practice-grid">' +
      card("recent", "Recent lessons", "Learned in the last 3 days") +
      card("missed", "Leeches", "Items you miss more than a quarter of the time") +
      card("apprentice", "Apprentice", "Everything still in Apprentice") +
      card("burned", "Burned", "Check you really still know them") +
      "</div><p class=\"muted small\">You can also practise any single level from its level page.</p>";
  }

  // ------------------------------------------------------------ settings
  function settings() {
    const s = ctx.progress.settings;
    const wk = ctx.wk;
    const count = Object.keys(ctx.progress.items).length;
    app.innerHTML =
      '<h1 class="page-title">Settings</h1>' +
      '<section class="panel"><h2>Study</h2>' +
      '<label class="field"><span>Lessons per batch</span><input type="number" min="1" max="20" id="s-batch" value="' + s.batch + '"></label>' +
      '<label class="field"><span>Review order</span><select id="s-order">' +
      [["random", "Random"], ["level", "Lower levels first"], ["stage", "Lowest SRS stage first"]].map(([v, l]) => '<option value="' + v + '"' + (s.order === v ? " selected" : "") + ">" + l + "</option>").join("") +
      "</select></label>" +
      '<label class="field check"><input type="checkbox" id="s-autoplay"' + (s.autoplay ? " checked" : "") + "><span>Speak vocabulary readings (uses your device's Japanese voice" + (Render.canSpeak() ? "" : ": none found in this browser") + ")</span></label>" +
      '<label class="field check"><input type="checkbox" id="s-wk"' + (s.showWK ? " checked" : "") + "><span>Show imported WaniKani mnemonics</span></label>" +
      "</section>" +
      '<section class="panel"><h2>Skip ahead</h2>' +
      '<p class="muted">Already studied some kanji? Open levels early so their lessons are available now. Radicals still come before their kanji.</p>' +
      '<label class="field"><span>Open every level up to</span><select id="s-start">' +
      cat.levels.map((l) => '<option value="' + l.n + '"' + (s.startLevel === l.n ? " selected" : "") + ">Level " + l.n + " (N" + l.jlpt + ")</option>").join("") +
      "</select></label>" +
      '<p class="muted">Or skip whole levels. <b>Guru</b> skips the lessons but still reviews each item in a week, to check you really know it. <b>Burn</b> removes the items for good.</p>' +
      '<div class="row"><select id="s-burnto">' + cat.levels.map((l) => '<option value="' + l.n + '">Levels 1–' + l.n + " (N" + l.jlpt + ")</option>").join("") + "</select>" +
      '<button class="btn" id="s-guru">Mark as Guru</button><button class="btn" id="s-burn">Burn</button></div>' +
      "</section>" +
      '<section class="panel"><h2>WaniKani mnemonics (optional)</h2>' +
      "<p class=\"muted\">This app ships with its own mnemonics. If you have a WaniKani account, you can pull WaniKani's mnemonics into this browser with your personal API token. They are stored only here, shown next to the matching items, and never leave your device. Get a read-only token at wanikani.com → Settings → API Tokens.</p>" +
      (wk ? '<p>Imported ' + (Object.keys(wk.k).length + Object.keys(wk.r).length + Object.keys(wk.v).length) + " subjects on " + esc(new Date(wk.fetched).toLocaleDateString()) + '. <button class="btn small ghost-btn" id="wk-clear">Remove</button></p>' : "") +
      '<div class="row"><input id="wk-token" type="password" placeholder="WaniKani API token (v2)" autocomplete="off"><button class="btn" id="wk-go">Import</button></div>' +
      '<p class="muted small" id="wk-status"></p>' +
      "</section>" +
      '<section class="panel"><h2>Backup</h2>' +
      '<p class="muted">Progress lives in this browser (' + count + " items started). Export it now and then, and to move to another device.</p>" +
      '<div class="row"><button class="btn" id="b-export">Export progress</button>' +
      '<label class="btn">Import progress<input type="file" id="b-import" accept="application/json,.json" hidden></label>' +
      '<button class="btn danger" id="b-reset">Reset everything</button></div>' +
      "</section>" +
      '<section class="panel about"><h2>About the data</h2>' +
      "<p class=\"muted small\">Kanji readings and meanings: KANJIDIC2. Vocabulary: JMdict. Both © the Electronic Dictionary Research and Development Group, CC BY-SA 4.0. " +
      "Stroke order and components: KanjiVG © Ulrich Apel, CC BY-SA 3.0. JLPT levels: Jonathan Waller's lists via davidluzgouveia/kanji-data. " +
      "Radical names and mnemonics are this app's own, written in the spirit of WaniKani and Heisig's Remembering the Kanji.</p></section>";

    const $ = (id) => document.getElementById(id);
    const saveSet = () => {
      s.batch = Math.max(1, Math.min(20, +$("s-batch").value || 5));
      s.order = $("s-order").value;
      s.autoplay = $("s-autoplay").checked;
      s.showWK = $("s-wk").checked;
      s.startLevel = +$("s-start").value;
      ctx.save();
      toast("Saved");
    };
    ["s-batch", "s-order", "s-autoplay", "s-wk", "s-start"].forEach((id) => ($(id).onchange = saveSet));
    const bulk = (mode) => {
      const upto = +$("s-burnto").value;
      const msg = mode === "guru"
        ? "Mark every radical, kanji and word in levels 1–" + upto + " as Guru? They skip their lessons and come back for review in a week. Items already higher stay where they are."
        : "Burn every radical, kanji and word in levels 1–" + upto + "? They won't come up in lessons or reviews again.";
      if (!confirm(msg)) return;
      const now = Date.now();
      let n = 0;
      for (const it of cat.items) {
        if (it.level > upto) continue;
        if (mode === "guru" ? SRS.skipToGuru(ctx.progress, it.id, now) : SRS.burn(ctx.progress, it.id, now)) n++;
      }
      s.startLevel = Math.max(s.startLevel, Math.min(upto + 1, cat.maxLevel));
      ctx.save();
      toast(n + " items " + (mode === "guru" ? "skipped to Guru" : "burned"));
      settings();
    };
    $("s-guru").onclick = () => bulk("guru");
    $("s-burn").onclick = () => bulk("burn");
    $("wk-go").onclick = async () => {
      const token = $("wk-token").value;
      if (!token.trim()) return;
      const st = $("wk-status");
      st.textContent = "Contacting WaniKani…";
      try {
        ctx.wk = await Store.wkImport(token, (n, total) => (st.textContent = "Fetched " + n + " of " + total + " subjects…"));
        toast("WaniKani mnemonics imported");
        settings();
      } catch (e) {
        st.textContent = "Import failed: " + e.message + (e instanceof TypeError ? " (the browser blocked the request; try opening the app from a web server rather than as a file)" : "");
      }
    };
    const clr = $("wk-clear");
    if (clr) clr.onclick = async () => {
      await Store.wkPut(null);
      ctx.wk = null;
      settings();
    };
    $("b-export").onclick = () => {
      const blob = new Blob([Store.exportJSON(ctx.progress)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kanji-ladder-" + Store.today() + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("b-import").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((text) => {
        try {
          const p = Store.importJSON(text);
          if (!confirm("Replace your current progress with this backup?")) return;
          Store.save(p);
          ctx.progress = Store.load();
          toast("Progress restored");
          settings();
        } catch (err) {
          alert(err.message);
        }
      });
    };
    $("b-reset").onclick = () => {
      if (!confirm("Delete all progress, notes and synonyms? This can't be undone. (Export first if unsure.)")) return;
      ctx.progress = Store.blank();
      ctx.save();
      toast("Reset");
      settings();
    };
  }

  // ------------------------------------------------------------ anime
  const withLines = () => cat.items.filter((it) => it.type === "vocab" && it.ex);

  function animeIndex() {
    const p = ctx.progress;
    const counts = {};
    withLines().forEach((v) => (counts[v.ex[0]] = (counts[v.ex[0]] || 0) + 1));
    const series = DATA.series.slice().sort((a, b) => (counts[b.key] || 0) - (counts[a.key] || 0));
    const words = cat.items.filter((it) => it.anime).sort((a, b) => a.level - b.level || a.order - b.order);
    app.innerHTML =
      '<h1 class="page-title">Anime</h1>' +
      '<p class="muted">Example lines about real anime, and words you\'ll hear in them. Pick a series to see every line from it.</p>' +
      '<div class="series-grid">' +
      series
        .filter((sr) => counts[sr.key])
        .map((sr) => '<a class="series-card" href="#/anime/' + esc(sr.key) + '" style="--sc:' + esc(sr.color) + '"><span class="big-icon">' + esc(sr.icon) + '</span><span><b>' + esc(sr.jp) + "</b><span>" + esc(sr.en) + " · " + counts[sr.key] + " lines</span></span></a>")
        .join("") +
      "</div>" +
      '<section class="panel"><h2>Anime words <span class="muted small">' + words.length + "</span></h2>" +
      '<p class="muted small">Words like 魔法, 先輩 and 覚悟. They unlock with their kanji, like any other vocabulary.</p>' +
      '<div class="chips">' + words.map((v) => chip(v, p, { locked: !SRS.isUnlocked(cat, p, v, SRS.currentLevel(cat, p)) && SRS.stageOf(p, v.id) === 0 })).join("") + "</div></section>";
  }

  function animeSeries(key) {
    const sr = Render.SERIES[key];
    if (!sr) return notFound();
    const lines = withLines().filter((v) => v.ex[0] === key).sort((a, b) => a.level - b.level || a.order - b.order);
    app.innerHTML =
      '<div class="level-head"><a class="btn small ghost-btn" href="#/anime">←</a><h1 class="page-title">' + esc(sr.icon) + " " + '<span lang="ja">' + esc(sr.jp) + '</span> <span class="muted">' + esc(sr.en) + "</span></h1></div>" +
      '<p class="muted small">' + lines.length + " lines, easiest first. The level shows when you'll have learned each word.</p>" +
      lines.map((v) => '<div class="muted small">Level ' + v.level + "</div>" + Render.animeLine(v, true)).join("");
    app.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => Render.speak(b.dataset.say)));
  }

  function notFound() {
    app.innerHTML = '<div class="empty-state"><h1>Not found</h1><a class="btn" href="#/">Home</a></div>';
  }

  // ------------------------------------------------------------ router
  function route() {
    lessonKeys = null;
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [head, ...rest] = h.split("/");
    const arg = rest.join("/");
    document.querySelectorAll(".topbar nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#/" + head));
    if (!head) dashboard();
    else if (head === "lessons") lessons();
    else if (head === "reviews") reviews();
    else if (head === "levels") levelsView();
    else if (head === "level") levelView(+arg);
    else if (head === "jlpt") arg ? levelsView(+arg) : jlptIndex();
    else if (head === "item") itemPage(arg);
    else if (head === "search") search(arg);
    else if (head === "practice") practice(arg);
    else if (head === "settings") settings();
    else if (head === "anime") arg ? animeSeries(arg) : animeIndex();
    else notFound();
    if (!app.contains(document.activeElement)) app.focus({ preventScroll: true });
    if (!/^item/.test(head)) window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  document.getElementById("search-form").onsubmit = (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value;
    location.hash = "#/search/" + encodeURIComponent(q);
  };

  // Refresh the dashboard's counts when reviews come due.
  setInterval(() => {
    if (!location.hash || location.hash === "#/") dashboard();
  }, 60 * 1000);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  route();
})();
