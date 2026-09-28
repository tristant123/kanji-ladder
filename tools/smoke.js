// Drive the app in headless Chromium: lessons, a lesson quiz, reviews, item
// pages, search and settings. Fails on any page error. Screenshots go to
// the directory given as the first argument.
//
//   node tools/smoke.js /tmp/shots      (needs `npm i -g playwright` or NODE_PATH)
const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || path.join(ROOT, "smoke_output");
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on("requestfailed", (r) => !/fonts\.g/.test(r.url()) && errors.push("request failed: " + r.url()));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });

  await page.goto(base);
  await page.waitForSelector(".hero");
  await shot("01_dashboard");

  // --- a lesson batch
  await page.click(".big-btn.lessons");
  await page.waitForSelector(".lesson");
  await shot("02_lesson");
  // Skip the first item straight to Guru
  await page.click("[data-skip]");
  const skipped = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("kanji-ladder.v1")).items).filter((e) => e.stage === 5).length);
  if (skipped !== 1) throw new Error("lesson skip did not mark one item as Guru: " + skipped);
  for (let i = 0; i < 10 && !(await page.$("[data-quiz]")); i++) await page.click("[data-next]");
  await page.click("[data-quiz]");

  // Answer from the data the page itself has, so the test knows the answers.
  async function answerQuiz(makeMistake) {
    let mistakes = 0;
    for (let n = 0; n < 200; n++) {
      if (await page.$(".summary")) return;
      const q = await page.evaluate(() => {
        const quiz = document.querySelector(".quiz");
        const kind = document.querySelector(".qprompt").className.includes("q-reading") ? "reading" : "meaning";
        const type = quiz.className.match(/quiz-(\w+)/)[1];
        return { ch: quiz.dataset.id.slice(2), kind, type };
      });
      const ans = await page.evaluate(({ ch, kind, type }) => {
        const D = window.KANJI_DATA;
        if (type === "radical") return D.radicals.find((r) => r.ch === ch || r.svg && document.querySelector(".qchar svg")).name;
        if (type === "kanji") {
          const k = D.kanji.find((x) => x.ch === ch);
          return kind === "meaning" ? k.m[0] : (k.pr === "kun" ? k.kun[0] : k.on[0]).split(".")[0];
        }
        const v = D.vocab.find((x) => x.w === ch);
        return kind === "meaning" ? v.m[0] : v.r[0];
      }, q);
      const wrong = makeMistake && mistakes < 1;
      await page.fill("#answer", wrong ? "zzzz" : ans);
      await page.press("#answer", "Enter");
      await page.waitForSelector("#answer.right, #answer.wrong, .qmsg:not(:empty)");
      if (wrong) {
        mistakes++;
        await shot("04_wrong");
      }
      await page.press("#answer", "Enter");
    }
    throw new Error("quiz did not finish");
  }
  await page.waitForSelector(".quiz");
  await shot("03_quiz");
  await answerQuiz(false);
  await page.waitForSelector(".summary");
  const learned = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("kanji-ladder.v1")).items).length);
  if (learned < 1) throw new Error("lesson quiz did not record items");

  // --- time travel: make everything due, then review
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("kanji-ladder.v1"));
    for (const id in p.items) p.items[id].at = Date.now() - 1000;
    localStorage.setItem("kanji-ladder.v1", JSON.stringify(p));
  });
  await page.goto(base + "#/reviews");
  await page.reload();
  await page.waitForSelector(".quiz");
  await answerQuiz(true);
  await page.waitForSelector(".summary");
  await shot("05_summary");
  const stages = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("kanji-ladder.v1")).items).map((e) => e.stage));
  if (!stages.includes(2)) throw new Error("reviews did not advance any item: " + stages);

  // --- a word asked inside its anime line
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("kanji-ladder.v1"));
    for (const id in p.items) p.items[id].at = Date.now() + 1e9;
    p.items["v:一つ"] = Object.assign({}, p.items[Object.keys(p.items)[0]], { stage: 1, at: Date.now() - 1000, learned: Date.now() });
    p.settings.lineQuiz = "always";
    localStorage.setItem("kanji-ladder.v1", JSON.stringify(p));
  });
  await page.goto(base + "#/reviews");
  await page.reload();
  await page.waitForSelector(".qline mark");
  await page.waitForTimeout(400);
  await shot("22_line_question");
  if (await page.$eval(".qline-en", (e) => getComputedStyle(e).opacity !== "0")) errors.push("line translation shown before answering");
  await answerQuiz(false);
  await page.waitForSelector(".summary");

  // --- pages
  for (const [hash, sel, name] of [
    ["#/item/k:語", ".item-kanji", "06_kanji"],
    ["#/item/v:日本語", ".item-vocab", "07_vocab"],
    ["#/item/r:氵", ".item-radical", "08_radical"],
    ["#/level/1", ".chips", "09_level"],
    ["#/levels", ".level-row", "10_levels"],
    ["#/jlpt", ".tiers", "11_jlpt"],
    ["#/search/water", ".chips", "12_search"],
    ["#/practice", ".practice-grid", "13_practice"],
    ["#/settings", "#s-batch", "14_settings"],
    ["#/anime", ".series-grid", "18_anime"],
    ["#/anime/onepiece", ".anime-line", "19_anime_series"],
    ["#/item/v:魔法", ".anime-line", "20_anime_word"],
    ["#/item/k:海", ".item-kanji", "21_kanji_anime"],
    ["#/", ".hero", "15_dashboard_after"],
  ]) {
    await page.goto(base + hash);
    await page.waitForSelector(sel);
    await page.waitForTimeout(hash.startsWith("#/item") ? 1500 : 100);
    await shot(name);
  }
  if (!(await page.$("#app .chip"))) throw new Error("dashboard shows no kanji");

  // Skip from an item page, and a whole level
  page.on("dialog", (d) => d.accept());
  await page.goto(base + "#/item/k:語");
  await page.click('[data-act="guru"]');
  await page.waitForSelector(".item-head .stage.st-guru");
  await page.goto(base + "#/level/2");
  await page.click("#skip-level");
  await page.waitForTimeout(200);
  const lv2 = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("kanji-ladder.v1")).items;
    return window.KANJI_DATA.kanji.filter((k) => k.level === 2).every((k) => p["k:" + k.ch] && p["k:" + k.ch].stage >= 5);
  });
  if (!lv2) throw new Error("level skip did not put every level-2 kanji at Guru");
  await shot("17_level_skipped");

  // mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "#/item/k:語");
  await page.waitForSelector(".item-kanji");
  await shot("16_mobile_item");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push("horizontal overflow on mobile: " + overflow + "px");

  await browser.close();
  server.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("smoke test passed; screenshots in " + OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
