// The question loop shared by reviews, lesson quizzes and practice.
// Each item needs a correct meaning (and reading, unless it's a radical);
// a miss sends that question back into the pile, and the misses decide
// how far the item drops on the SRS ladder.
(function (root) {
  "use strict";
  const { esc } = root.Render;

  const POOL = 10;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function orderItems(items, order, progress) {
    items = shuffle(items.slice());
    if (order === "level") items.sort((a, b) => a.level - b.level);
    if (order === "stage") items.sort((a, b) => SRS.stageOf(progress, a.id) - SRS.stageOf(progress, b.id));
    return items;
  }

  // mode: "review" | "lesson" | "practice"
  function start(ctx, el, items, mode, onExit) {
    const progress = ctx.progress;
    const title = { review: "Reviews", lesson: "Lesson quiz", practice: "Practice" }[mode];
    const queue = (mode === "lesson" ? shuffle(items.slice()) : orderItems(items, progress.settings.order, progress)).map((it) => ({
      it,
      needM: true,
      needR: it.type !== "radical",
      wrongM: 0,
      wrongR: 0,
    }));
    const total = queue.length;
    const pool = [];
    const results = [];
    let wrapping = false;
    let cur = null; // { s, kind }
    let state = "asking"; // asking | answered
    let lastResult = null;
    let answeredQ = 0, correctQ = 0;

    function fill() {
      while (!wrapping && pool.length < POOL && queue.length) pool.push(queue.shift());
    }

    function pick() {
      fill();
      if (!pool.length) return finish();
      const prev = cur && cur.s;
      // Avoid asking the same item twice in a row when there's a choice.
      const choices = pool.length > 1 ? pool.filter((s) => s !== prev) : pool;
      const s = choices[Math.floor(Math.random() * choices.length)];
      const kinds = [];
      if (s.needM) kinds.push("meaning");
      if (s.needR) kinds.push("reading");
      const kind = mode === "lesson" && s.needM ? "meaning" : kinds[Math.floor(Math.random() * kinds.length)];
      cur = { s, kind };
      state = "asking";
      lastResult = null;
      draw();
    }

    function draw() {
      const it = cur.s.it;
      const done = results.length;
      const pct = answeredQ ? Math.round((100 * correctQ) / answeredQ) + "%" : "–";
      el.innerHTML =
        '<div class="quiz quiz-' + it.type + '">' +
        '<div class="qbar"><span class="qtitle">' + title + "</span>" +
        '<span title="correct answers">✓ ' + pct + "</span>" +
        '<span title="items finished">' + done + " / " + total + "</span>" +
        (mode !== "practice" && SRS.stageOf(progress, it.id) < SRS.GURU ? '<button class="btn small ghost-btn" data-skip title="Already know it: mark as Guru">Skip to Guru</button>' : "") +
        (mode !== "lesson" ? '<button class="btn small ghost-btn" data-wrap ' + (wrapping ? "disabled" : "") + ">" + (wrapping ? "Wrapping up…" : "Wrap up") + "</button>" : "") +
        '<button class="btn small ghost-btn" data-exit>End</button></div>' +
        '<div class="qchar" lang="ja">' + Render.glyph(it) + "</div>" +
        '<div class="qprompt q-' + cur.kind + '">' + Render.TYPE_LABEL[it.type] + " <b>" + (cur.kind === "meaning" ? (it.type === "radical" ? "Name" : "Meaning") : "Reading") + "</b></div>" +
        '<form class="qform" autocomplete="off"><input id="answer" ' + (cur.kind === "reading" ? 'lang="ja" placeholder="答え (type romaji)"' : 'placeholder="Your answer"') +
        ' autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><button class="btn" aria-label="Submit">→</button></form>' +
        '<div class="qmsg" aria-live="polite"></div>' +
        '<div class="qactions" hidden><button class="btn small ghost-btn" type="button" data-info>Item info <kbd>F</kbd></button>' +
        '<button class="btn small ghost-btn" type="button" data-undo hidden>Typo? Try again <kbd>⌫</kbd></button></div>' +
        '<div class="qinfo" hidden></div>' +
        "</div>";
      const input = el.querySelector("#answer");
      const form = el.querySelector(".qform");
      if (cur.kind === "reading") {
        input.addEventListener("input", () => {
          const v = Kana.toKanaLive(input.value);
          if (v !== input.value) input.value = v;
        });
      }
      form.onsubmit = (e) => {
        e.preventDefault();
        if (state === "answered") return next();
        submit(input.value);
      };
      el.querySelector("[data-exit]").onclick = () => finish(true);
      const skip = el.querySelector("[data-skip]");
      if (skip) skip.onclick = skipCurrent;
      const wrap = el.querySelector("[data-wrap]");
      if (wrap) wrap.onclick = () => {
        wrapping = true;
        queue.length && ctx.toast("Finishing the " + pool.length + " items in progress.");
        wrap.disabled = true;
        wrap.textContent = "Wrapping up…";
        input.focus();
      };
      el.querySelector("[data-info]").onclick = toggleInfo;
      el.querySelector("[data-undo]").onclick = undo;
      input.focus();
    }

    function submit(value) {
      const it = cur.s.it;
      const input = el.querySelector("#answer");
      const msg = el.querySelector(".qmsg");
      let r;
      if (cur.kind === "meaning") r = SRS.checkMeaning(it, value, progress.syn[it.id]);
      else r = SRS.checkReading(it, Kana.toKana(value), (s) => Kana.kataToHira(s));
      if (cur.kind === "reading") input.value = Kana.toKana(input.value);
      if (r.result === "retry") {
        input.classList.remove("shake");
        void input.offsetWidth;
        input.classList.add("shake");
        msg.textContent = r.message;
        return;
      }
      state = "answered";
      lastResult = r.result;
      answeredQ++;
      input.readOnly = true;
      const ok = r.result !== "wrong";
      if (ok) {
        correctQ++;
        if (cur.kind === "meaning") cur.s.needM = false;
        else cur.s.needR = false;
        input.classList.add("right");
        msg.textContent = r.message || "";
        if (cur.kind === "reading" && it.type === "vocab" && progress.settings.autoplay) Render.speak(it.r[0]);
      } else {
        if (cur.kind === "meaning") cur.s.wrongM++;
        else cur.s.wrongR++;
        input.classList.add("wrong");
        msg.innerHTML = "The answer: <b>" + esc(expected(it, cur.kind)) + "</b>";
      }
      el.querySelector(".qactions").hidden = false;
      el.querySelector("[data-undo]").hidden = ok;
      if (!ok && mode !== "review") toggleInfo(true);
    }

    function expected(it, kind) {
      if (kind === "meaning") return it.type === "radical" ? it.name : it.m.slice(0, 3).join(", ");
      if (it.type === "vocab") return it.r.join("、");
      const list = it.pr === "kun" ? it.kun : it.on;
      return (list.length ? list : it.on.concat(it.kun)).slice(0, 3).map((r) => r.replace(".", "・")).join("、");
    }

    // Take the current item out of this session and put it straight at Guru.
    function skipCurrent() {
      const s = cur.s;
      // an answer already given for this item doesn't count towards the score
      if (state === "answered") {
        answeredQ--;
        if (lastResult !== "wrong") correctQ--;
      }
      pool.splice(pool.indexOf(s), 1);
      SRS.skipToGuru(progress, s.it.id, Date.now());
      ctx.save();
      results.push({ it: s.it, wrong: 0, skipped: true });
      ctx.toast(Render.primaryMeaning(s.it) + ": skipped to Guru", "up");
      cur = null;
      pick();
    }

    function undo() {
      if (state !== "answered" || lastResult !== "wrong") return;
      if (cur.kind === "meaning") cur.s.wrongM--;
      else cur.s.wrongR--;
      answeredQ--;
      state = "asking";
      const input = el.querySelector("#answer");
      input.readOnly = false;
      input.classList.remove("wrong");
      el.querySelector(".qmsg").textContent = "";
      el.querySelector(".qactions").hidden = true;
      el.querySelector(".qinfo").hidden = true;
      input.select();
      input.focus();
    }

    function toggleInfo(force) {
      const box = el.querySelector(".qinfo");
      const show = force === true ? true : box.hidden;
      box.hidden = !show;
      if (show && !box.innerHTML) {
        box.innerHTML = Render.itemView(ctx, cur.s.it, { quiz: true, showWK: progress.settings.showWK });
        Render.bindItem(box, ctx, cur.s.it);
      }
      if (!show) return;
      const input = el.querySelector("#answer");
      input && input.focus();
    }

    function next() {
      const s = cur.s;
      if (!s.needM && !s.needR) {
        pool.splice(pool.indexOf(s), 1);
        complete(s);
      }
      pick();
    }

    function complete(s) {
      const now = Date.now();
      const rec = { it: s.it, wrong: s.wrongM + s.wrongR };
      if (mode === "review") {
        const { before, after } = SRS.answer(progress, s.it.id, s.wrongM, s.wrongR, now);
        rec.before = before;
        rec.after = after;
        Store.bumpDay(progress, "reviews");
        if (!rec.wrong) Store.bumpDay(progress, "correct");
        ctx.save();
        const up = after > before;
        ctx.toast((up ? "↑ " : "↓ ") + SRS.STAGES[after].name, up ? "up" : "down");
      } else if (mode === "lesson") {
        SRS.learn(progress, s.it.id, now);
        Store.bumpDay(progress, "lessons");
        ctx.save();
      }
      results.push(rec);
    }

    function finish(early) {
      document.removeEventListener("keydown", keys);
      if (early && mode === "lesson" && results.length < total) {
        ctx.toast("Lessons not finished stay in your lesson queue.");
      }
      const skipped = results.filter((r) => r.skipped);
      const answered = results.filter((r) => !r.skipped);
      const right = answered.filter((r) => !r.wrong);
      const wrong = answered.filter((r) => r.wrong);
      const list = (rs) =>
        '<div class="chips">' +
        rs.map((r) => Render.chip(r.it, progress) + (r.after !== undefined ? '<span class="arrow ' + (r.after > r.before ? "up" : "down") + '">' + esc(SRS.STAGES[r.after].name) + "</span>" : "")).join("") +
        "</div>";
      el.innerHTML =
        '<div class="summary">' +
        "<h1>" + title + (results.length ? " done" : "") + "</h1>" +
        (results.length
          ? (answered.length ? '<p class="big-num">' + Math.round((100 * right.length) / answered.length) + '%<span> of ' + answered.length + " items all right first time</span></p>" : "") +
            (wrong.length ? "<h2>Missed (" + wrong.length + ")</h2>" + list(wrong) : "") +
            (right.length ? "<h2>Right (" + right.length + ")</h2>" + list(right) : "") +
            (skipped.length ? "<h2>Skipped to Guru (" + skipped.length + ")</h2>" + list(skipped) : "")
          : '<p class="muted">Nothing finished this time.</p>') +
        '<div class="row"><a class="btn" href="#/">Home</a>' +
        (mode === "lesson" ? '<a class="btn primary" href="#/lessons">Next lessons</a>' : "") +
        (mode === "review" ? '<a class="btn primary" href="#/reviews">More reviews</a>' : "") +
        "</div></div>";
      onExit && onExit(results);
    }

    function keys(e) {
      if (!el.querySelector(".quiz")) return document.removeEventListener("keydown", keys);
      if (state !== "answered") return;
      const t = e.target;
      if (t && t.tagName === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleInfo();
      } else if (e.key === "Backspace" && lastResult === "wrong") {
        e.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", keys);

    if (!total) return finish();
    pick();
  }

  root.Quiz = { start, shuffle };
})(this);
