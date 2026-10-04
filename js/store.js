// Persistence: your progress in localStorage, and (optionally) the WaniKani
// mnemonics you import with your own API token in IndexedDB. Nothing leaves
// the browser except the WaniKani API request you trigger yourself.
(function (root) {
  "use strict";

  const KEY = "kanji-ladder.v1";

  const DEFAULT_SETTINGS = {
    batch: 5,          // lessons per batch
    order: "random",   // review order: random | level | stage
    autoplay: true,    // speak vocab readings after a correct answer
    startLevel: 1,     // skip ahead: treat levels below this as open
    showWK: true,      // show imported WaniKani mnemonics on item pages
    furigana: false,   // always show furigana on anime lines
    lineQuiz: "some",  // ask vocab inside its anime line: off | some | always
  };

  function blank() {
    return { items: {}, notes: {}, syn: {}, days: {}, settings: Object.assign({}, DEFAULT_SETTINGS) };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const p = JSON.parse(raw);
      const b = blank();
      return {
        items: p.items || {},
        notes: p.notes || {},
        syn: p.syn || {},
        days: p.days || {},
        settings: Object.assign(b.settings, p.settings || {}),
      };
    } catch (e) {
      console.warn("could not read saved progress", e);
      return blank();
    }
  }

  function save(progress) {
    try {
      localStorage.setItem(KEY, JSON.stringify(progress));
      return true;
    } catch (e) {
      console.warn("could not save progress", e);
      return false;
    }
  }

  function today(now) {
    const d = new Date(now || Date.now());
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function bumpDay(progress, field, n) {
    const k = today();
    const d = progress.days[k] || (progress.days[k] = { lessons: 0, reviews: 0, correct: 0 });
    d[field] = (d[field] || 0) + (n === undefined ? 1 : n);
  }

  function exportJSON(progress) {
    return JSON.stringify({ app: "kanji-ladder", version: 1, exported: new Date().toISOString(), progress }, null, 1);
  }

  function importJSON(text) {
    const obj = JSON.parse(text);
    const p = obj.progress || obj;
    if (!p.items) throw new Error("That file doesn't look like a Kanji Ladder backup.");
    return p;
  }

  // ------------------------------------------------------------ IndexedDB
  // One key-value store: the WaniKani cache, the automatic snapshots and the
  // backup file handle.
  const DB = "kanji-ladder-wk";
  function idb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error("IndexedDB not available"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function kvGet(key) {
    try {
      const db = await idb();
      return await new Promise((resolve, reject) => {
        const r = db.transaction("kv").objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      return null;
    }
  }
  async function kvPut(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      if (value === null) tx.objectStore("kv").delete(key);
      else tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  const wkGet = () => kvGet("subjects");
  const wkPut = (value) => kvPut("subjects", value);

  // Pull every radical/kanji/vocabulary subject with your personal token and
  // keep just the mnemonic fields, keyed by the characters.
  async function wkImport(token, onProgress) {
    const out = { fetched: new Date().toISOString(), r: {}, k: {}, v: {} };
    let url = "https://api.wanikani.com/v2/subjects?types=radical,kanji,vocabulary";
    let n = 0;
    while (url) {
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token.trim(), "Wanikani-Revision": "20170710" } });
      if (res.status === 401) throw new Error("WaniKani rejected that token.");
      if (!res.ok) throw new Error("WaniKani answered " + res.status + ".");
      const page = await res.json();
      for (const s of page.data) {
        const d = s.data;
        if (!d.characters) continue;
        const rec = {
          level: d.level,
          name: (d.meanings.find((m) => m.primary) || d.meanings[0] || {}).meaning,
          mm: d.meaning_mnemonic || "",
          mh: d.meaning_hint || "",
          rm: d.reading_mnemonic || "",
          rh: d.reading_hint || "",
          url: d.document_url,
        };
        const bucket = s.object === "radical" ? out.r : s.object === "kanji" ? out.k : out.v;
        bucket[d.characters] = rec;
        n++;
      }
      if (onProgress) onProgress(n, page.total_count);
      url = page.pages && page.pages.next_url;
    }
    await wkPut(out);
    return out;
  }

  // ------------------------------------------------------------ automatic backups
  // Snapshots of your progress, kept in IndexedDB apart from the localStorage
  // copy: one a day, plus one before anything that replaces or rewrites a lot
  // of progress (import, restore, reset, bulk Guru/Burn).
  const KEEP_DAILY = 14;
  const KEEP_OTHER = 5;
  const itemCount = (progress) => Object.keys(progress.items || {}).length;

  // The snapshot list with one more added: newest first, oldest pruned.
  function withSnapshot(list, progress, reason, now) {
    const at = now || Date.now();
    const snap = { at, day: today(at), reason, count: itemCount(progress), progress };
    let daily = 0;
    let other = 0;
    return [snap]
      .concat(list || [])
      .sort((a, b) => b.at - a.at)
      .filter((s) => (s.reason === "daily" ? ++daily <= KEEP_DAILY : ++other <= KEEP_OTHER));
  }

  async function snapshots() {
    return (await kvGet("snapshots")) || [];
  }

  // Copies the progress straight away, so callers can change it afterwards.
  // Empty progress isn't worth a slot; "daily" is taken once a day.
  async function snapshot(progress, reason, now) {
    if (!itemCount(progress)) return false;
    const copy = JSON.parse(JSON.stringify(progress));
    const list = await snapshots();
    if (reason === "daily" && list.some((s) => s.reason === "daily" && s.day === today(now))) return false;
    await kvPut("snapshots", withSnapshot(list, copy, reason, now));
    return true;
  }

  // A backup file on disk, rewritten after changes. Needs the File System
  // Access API (Chrome and Edge on a computer).
  const canBackupFile = () => typeof root.showSaveFilePicker === "function";
  async function chooseBackupFile() {
    const handle = await root.showSaveFilePicker({
      suggestedName: "kanji-ladder-backup.json",
      types: [{ description: "Kanji Ladder backup", accept: { "application/json": [".json"] } }],
    });
    await kvPut("backupFile", handle);
    return handle;
  }
  const backupFile = () => kvGet("backupFile");
  const forgetBackupFile = () => kvPut("backupFile", null);
  async function writeBackupFile(handle, progress) {
    const w = await handle.createWritable();
    await w.write(exportJSON(progress));
    await w.close();
  }

  root.Store = {
    load, save, blank, today, bumpDay, exportJSON, importJSON, wkGet, wkPut, wkImport, DEFAULT_SETTINGS,
    withSnapshot, snapshots, snapshot, canBackupFile, chooseBackupFile, backupFile, forgetBackupFile, writeBackupFile,
  };
})(this);
