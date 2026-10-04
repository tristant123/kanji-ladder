const test = require("node:test");
const assert = require("node:assert");
const { Store } = require("../js/store.js");

const DAY = 864e5;
const progress = (n) => ({ items: Object.fromEntries(Array.from({ length: n }, (_, i) => ["k:" + i, { stage: 1 }])) });

test("snapshots are newest first and record the item count", () => {
  let list = [];
  list = Store.withSnapshot(list, progress(2), "daily", 1000);
  list = Store.withSnapshot(list, progress(5), "reset", 2000);
  assert.deepStrictEqual(list.map((s) => [s.reason, s.count]), [["reset", 5], ["daily", 2]]);
  assert.strictEqual(list[1].day, Store.today(1000));
});

test("snapshots keep two weeks of dailies and the last five others", () => {
  let list = [];
  const t0 = Date.UTC(2026, 0, 1, 12);
  for (let d = 0; d < 20; d++) list = Store.withSnapshot(list, progress(d + 1), "daily", t0 + d * DAY);
  for (let i = 0; i < 8; i++) list = Store.withSnapshot(list, progress(1), i % 2 ? "import" : "burn", t0 + i * 1000);
  const daily = list.filter((s) => s.reason === "daily");
  assert.strictEqual(daily.length, 14);
  assert.strictEqual(daily[0].count, 20);
  assert.strictEqual(daily[13].count, 7);
  assert.strictEqual(list.length - daily.length, 5);
  assert.ok(list.every((s, i) => i === 0 || list[i - 1].at >= s.at));
});
