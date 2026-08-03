// 検証ハーネス: 「非公開マークの粒度追加（日単位・リスト単位）」の自動検証
// jsdom 上で実際の index.html + i18n.js + app.js を動かし、
// 1) 純粋関数（sanitizeTripForPublic / normalizeTrip / countSanitizedExclusions / CSV）を
//    app.js 末尾に注入したテスト専用フックで直接呼び出して検証する
// 2) 実際のDOM（day tab, day-meta, checklist セクション, viewOnly）を操作して検証する
// 本番の app.js ファイル自体は一切変更しない（このスクリプトが読み込むのはメモリ上のコピーのみ）

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PROJECT_DIR = path.join(__dirname, "..");

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(msg);
    console.error("FAIL: " + msg);
  }
}
function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg + " (actual=" + JSON.stringify(actual) + ", expected=" + JSON.stringify(expected) + ")");
}

// ---- ファイル読み込み ----
let html = fs.readFileSync(path.join(PROJECT_DIR, "index.html"), "utf8");
const i18nSrc = fs.readFileSync(path.join(PROJECT_DIR, "i18n.js"), "utf8");
// app.js は js/ 配下に分割された。読み込み順どおりに結合して1つのソースとして扱う
const APP_FILES = fs
  .readdirSync(path.join(PROJECT_DIR, "js"))
  .filter((f) => f.endsWith(".js"))
  .sort();
const appSrc = APP_FILES.map((f) => fs.readFileSync(path.join(PROJECT_DIR, "js", f), "utf8")).join(String.fromCharCode(10));
const cssSrc = fs.readFileSync(path.join(PROJECT_DIR, "styles.css"), "utf8");

// <script> タグは全部取り除き、後で手動で評価する（Leaflet/Firebaseの実ファイル読み込みも避ける）
html = html.replace(/<script[\s\S]*?<\/script>/g, "");

// app.js 末尾の "})();" の直前にテスト専用フックを注入する（メモリ上のコピーのみ。実ファイルは無変更）
const hookInjection = `
  window.__TEST__ = {
    sanitizeTripForPublic: sanitizeTripForPublic,
    normalizeTrip: normalizeTrip,
    countSanitizedExclusions: countSanitizedExclusions,
    createSampleTrip: createSampleTrip,
    createBlankTripData: createBlankTripData,
    parseTripCsv: parseTripCsv,
    exportTripCsv: exportTripCsv,
    checklistArray: function (kind) { return checklistArray(kind); },
    getTrip: function () { return trip; },
    setTrip: function (t) { trip = t; },
    getEl: function () { return el; },
    setViewOnly: function (v) { viewOnly = v; },
    getViewOnly: function () { return viewOnly; },
    render: function () { render(); },
    init: function () { init(); },
    lang: function () { return lang(); },
    openPublicPreviewModal: function () { openPublicPreviewModal(); },
    openShareModal: function () { openShareModal(); }
  };
`;
// 分割後はIIFEが無くグローバルスコープなので、末尾にフックを足すだけでよい
const appSrcForTest = appSrc + hookInjection;

// ---- jsdom セットアップ ----
const dom = new JSDOM(html, {
  url: "https://example.org/",
  pretendToBeVisual: true,
  runScripts: "outside-only"
});
const { window } = dom;

// styles.css を <style> として head に追加する（view-only-mode の display:none 判定に使う）
const styleEl = window.document.createElement("style");
styleEl.textContent = cssSrc;
window.document.head.appendChild(styleEl);

// console をNode側に橋渡し（app.js内のconsole.warn等がエラーで落ちないように）
window.console = console;

// i18n.js → app.js(テストフック注入版) の順で、そのウィンドウのコンテキストで評価する
window.eval(i18nSrc);
window.eval(appSrcForTest);

const T = window.__TEST__;
if (!T) throw new Error("test hook not installed");

// jsdom は "outside-only" 実行のため document.readyState は "loading" のままで、
// app.js 末尾の DOMContentLoaded 待ちの分岐に入り自動初期化されない。
// 実際のブラウザ起動と同じ処理（cacheDom/bindEvents/render等）を明示的に1回だけ走らせる
T.init();

// =========================================================
// 1. データモデル・normalizeTrip の防御的正規化
// =========================================================
(function testNormalizeDefaults() {
  const t1 = T.normalizeTrip({ days: [{ items: [] }] });
  assertEqual(t1.days[0].priv, false, "normalizeTrip: day.priv defaults to false when missing");
  assertEqual(t1.packingPriv, false, "normalizeTrip: trip.packingPriv defaults to false when missing");
  assertEqual(t1.todosPriv, false, "normalizeTrip: trip.todosPriv defaults to false when missing");

  const t2 = T.normalizeTrip({ days: [{ items: [], priv: true }], packingPriv: true, todosPriv: true });
  assertEqual(t2.days[0].priv, true, "normalizeTrip: day.priv=true is preserved");
  assertEqual(t2.packingPriv, true, "normalizeTrip: trip.packingPriv=true is preserved");
  assertEqual(t2.todosPriv, true, "normalizeTrip: trip.todosPriv=true is preserved");

  // boolean以外の型は !! でフォールバックされる（0/nullは false、"文字列"/1 は true）
  const t3 = T.normalizeTrip({ days: [{ items: [], priv: "yes" }], packingPriv: 1, todosPriv: null });
  assertEqual(t3.days[0].priv, true, "normalizeTrip: day.priv non-boolean truthy coerces to true");
  assertEqual(t3.packingPriv, true, "normalizeTrip: trip.packingPriv non-boolean truthy(1) coerces to true");
  assertEqual(t3.todosPriv, false, "normalizeTrip: trip.todosPriv null coerces to false");

  // 空 days は既存どおり1つの空の日にフォールバックする（境界条件の前提）
  const t4 = T.normalizeTrip({ days: [] });
  assertEqual(t4.days.length, 1, "normalizeTrip: empty days array falls back to a single blank day");
  assertEqual(t4.days[0].priv, false, "normalizeTrip: fallback blank day has priv=false");
})();

// =========================================================
// 2. サンプル/空のしおり生成の既定値
// =========================================================
(function testFactories() {
  const sample = T.createSampleTrip();
  assertEqual(sample.days[0].priv, false, "createSampleTrip: day.priv is false");
  assertEqual(sample.packingPriv, false, "createSampleTrip: packingPriv is false");
  assertEqual(sample.todosPriv, false, "createSampleTrip: todosPriv is false");

  const blank = T.createBlankTripData();
  assertEqual(blank.days[0].priv, false, "createBlankTripData: day.priv is false");
  assertEqual(blank.packingPriv, false, "createBlankTripData: packingPriv is false");
  assertEqual(blank.todosPriv, false, "createBlankTripData: todosPriv is false");
})();

// =========================================================
// 3. sanitizeTripForPublic: 日単位・リスト単位の削除
// =========================================================
(function testSanitizeDayLevel() {
  const original = {
    v: 1,
    title: "test",
    lang: "ja",
    days: [
      { date: "2026-01-01", startTime: "09:00", tz: "", priv: true, items: [
        { id: "a1", cat: "sight", name: "Secret Spot", note: "n1", priv: false, notePriv: false },
        { id: "a2", cat: "meal", name: "Secret Meal", note: "n2", priv: false, notePriv: false }
      ] },
      { date: "2026-01-02", startTime: "09:00", tz: "", priv: false, items: [
        { id: "b1", cat: "sight", name: "Public Spot", note: "n3", priv: false, notePriv: false }
      ] }
    ],
    packing: [{ id: "p1", text: "passport", done: false, priv: false }],
    todos: [{ id: "t1", text: "book hotel", done: false, priv: false }],
    packingPriv: false,
    todosPriv: false
  };
  const originalSnapshot = JSON.stringify(original);

  const sanitized = T.sanitizeTripForPublic(original);

  assertEqual(sanitized.days.length, 1, "sanitize: private day is removed entirely, only 1 day remains");
  assertEqual(sanitized.days[0].date, "2026-01-02", "sanitize: the remaining day is the public one");
  assertEqual(sanitized.days[0].items.length, 1, "sanitize: public day's items are untouched");
  assertEqual(sanitized.days[0].items[0].id, "b1", "sanitize: public day's item id preserved");
  assert(!("priv" in sanitized.days[0]), "sanitize: day.priv flag itself removed from output");
  assert(!("priv" in sanitized.days[0].items[0]), "sanitize: item priv flag removed as before (regression)");

  // 純粋関数であること（元データ改変なし）
  assertEqual(JSON.stringify(original), originalSnapshot, "sanitize: original trip object is not mutated (pure function)");
})();

(function testSanitizeAllDaysPrivateBoundary() {
  const original = {
    v: 1,
    title: "test",
    lang: "ja",
    days: [
      { date: "2026-01-01", startTime: "09:00", tz: "", priv: true, items: [
        { id: "a1", cat: "sight", name: "S1", note: "", priv: false, notePriv: false },
        { id: "a2", cat: "meal", name: "S2", note: "", priv: false, notePriv: false }
      ] },
      { date: "2026-01-02", startTime: "09:00", tz: "", priv: true, items: [
        { id: "b1", cat: "sight", name: "S3", note: "", priv: false, notePriv: false }
      ] }
    ],
    packing: [],
    todos: [],
    packingPriv: false,
    todosPriv: false
  };

  let sanitized;
  assert(
    (function () {
      try {
        sanitized = T.sanitizeTripForPublic(original);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    })(),
    "sanitize: does not throw when ALL days are private"
  );
  assertEqual(sanitized.days.length, 0, "sanitize: days becomes an empty array when all days are private");

  // 閲覧側と同じ経路: JSON文字列化→JSON.parse→normalizeTrip を通す（共有リンク／公開URL閲覧の実際の経路）
  let normalized;
  assert(
    (function () {
      try {
        const json = JSON.stringify(sanitized);
        const parsed = JSON.parse(json);
        normalized = T.normalizeTrip(parsed);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    })(),
    "boundary: JSON roundtrip + normalizeTrip of an all-private sanitized trip does not throw"
  );
  assertEqual(normalized.days.length, 1, "boundary: normalizeTrip fills the empty days with exactly one blank day");
  assertEqual(normalized.days[0].items.length, 0, "boundary: the fallback blank day has no items");
  assertEqual(normalized.days[0].priv, false, "boundary: the fallback blank day defaults priv to false");

  // 除外件数: 全3項目が除外されているはず
  const excluded = T.countSanitizedExclusions(original, sanitized);
  assertEqual(excluded, 3, "countSanitizedExclusions: all 3 items in private days are counted as excluded");
})();

(function testSanitizeListLevel() {
  const original = {
    v: 1,
    title: "test",
    lang: "ja",
    days: [{ date: "", startTime: "09:00", tz: "", priv: false, items: [] }],
    packing: [
      { id: "p1", text: "passport", done: false, priv: false },
      { id: "p2", text: "wallet", done: false, priv: true }
    ],
    todos: [
      { id: "t1", text: "book hotel", done: false, priv: false }
    ],
    packingPriv: true,
    todosPriv: false
  };
  const originalSnapshot = JSON.stringify(original);
  const sanitized = T.sanitizeTripForPublic(original);

  assertEqual(sanitized.packing, [], "sanitize: packingPriv=true empties the whole packing list");
  assertEqual(sanitized.todos.length, 1, "sanitize: todosPriv=false leaves todos list processed per-item as before");
  assert(!("packingPriv" in sanitized), "sanitize: packingPriv flag itself removed from output");
  assert(!("todosPriv" in sanitized), "sanitize: todosPriv flag itself removed from output");
  assertEqual(JSON.stringify(original), originalSnapshot, "sanitize (list-level): original trip object is not mutated");

  const excluded = T.countSanitizedExclusions(original, sanitized);
  // packing 2件（リスト全体非公開のため両方消える）
  assertEqual(excluded, 2, "countSanitizedExclusions: whole-list-private packing items are counted as excluded");

  // 空の todosPriv=true のケース（既知の制限確認用: sanitize自体は正しく動く）
  const original2 = JSON.parse(JSON.stringify(original));
  original2.todos = [];
  original2.todosPriv = true;
  const sanitized2 = T.sanitizeTripForPublic(original2);
  assertEqual(sanitized2.todos, [], "sanitize: empty todosPriv=true list stays empty (no crash)");
})();

(function testSanitizeCombinedGranularity() {
  // 日単位・項目単位・リスト単位が同時に効くケース（相互作用の回帰確認）
  const original = {
    v: 1,
    title: "combo",
    lang: "ja",
    days: [
      { date: "d1", startTime: "09:00", tz: "", priv: true, items: [
        { id: "x1", cat: "sight", name: "X1", note: "", priv: false, notePriv: false }
      ] },
      { date: "d2", startTime: "09:00", tz: "", priv: false, items: [
        { id: "y1", cat: "sight", name: "Y1", note: "secret note", priv: false, notePriv: true },
        { id: "y2", cat: "sight", name: "Y2 hidden", note: "", priv: true, notePriv: false }
      ] }
    ],
    packing: [{ id: "p1", text: "p", done: false, priv: false }],
    todos: [{ id: "t1", text: "t", done: false, priv: false }],
    packingPriv: false,
    todosPriv: true
  };
  const sanitized = T.sanitizeTripForPublic(original);
  assertEqual(sanitized.days.length, 1, "combo: private day removed, 1 day remains");
  assertEqual(sanitized.days[0].items.length, 1, "combo: item-level priv:true item removed from remaining day");
  assertEqual(sanitized.days[0].items[0].id, "y1", "combo: remaining item is the non-private one");
  assertEqual(sanitized.days[0].items[0].note, "", "combo: notePriv:true still empties note (regression)");
  assertEqual(sanitized.packing.length, 1, "combo: packingPriv=false leaves packing item-level filtering as-is");
  assertEqual(sanitized.todos, [], "combo: todosPriv=true empties todos regardless of item priv");

  const excluded = T.countSanitizedExclusions(original, sanitized);
  // 除外: day1のx1(1) + y2(1) + todos 1件 = 3
  assertEqual(excluded, 3, "combo: countSanitizedExclusions sums day-level + item-level + list-level exclusions");
})();

// =========================================================
// 4. auto move 隣接削除ロジックの回帰確認（項目単位、日単位削除の影響を受けない）
// =========================================================
(function testAutoMoveRegression() {
  const original = {
    v: 1,
    title: "move-test",
    lang: "ja",
    days: [
      { date: "", startTime: "09:00", tz: "", priv: false, items: [
        { id: "s1", cat: "sight", name: "Spot1", note: "", priv: true, notePriv: false },
        { id: "m1", cat: "move", name: "m", note: "", priv: false, notePriv: false, mode: "train", auto: true, arriveTz: "" },
        { id: "s2", cat: "sight", name: "Spot2", note: "", priv: false, notePriv: false }
      ] }
    ],
    packing: [],
    todos: [],
    packingPriv: false,
    todosPriv: false
  };
  const sanitized = T.sanitizeTripForPublic(original);
  assertEqual(sanitized.days[0].items.length, 1, "auto move regression: auto move adjacent to a removed private spot is also removed");
  assertEqual(sanitized.days[0].items[0].id, "s2", "auto move regression: remaining item is the untouched spot");
})();

// =========================================================
// 5. CSVラウンドトリップ（dayPrivate / listPrivate）
// =========================================================
(function testCsvRoundtrip() {
  T.setTrip(
    T.normalizeTrip({
      v: 1,
      title: "csv-test",
      lang: "ja",
      days: [
        { date: "2026-02-01", startTime: "09:00", tz: "", priv: true, items: [
          { id: "i1", cat: "sight", name: "Spot", note: "", priv: false, notePriv: false }
        ] },
        { date: "2026-02-02", startTime: "10:00", tz: "", priv: false, items: [
          { id: "i2", cat: "meal", name: "Meal", note: "", priv: false, notePriv: false }
        ] }
      ],
      packing: [{ id: "p1", text: "passport", done: false, priv: false }],
      todos: [{ id: "t1", text: "hotel", done: false, priv: false }],
      packingPriv: true,
      todosPriv: false
    })
  );

  const csv = T.exportTripCsv();
  assert(csv.indexOf("dayPrivate") !== -1, "CSV export: header includes dayPrivate column");
  assert(csv.indexOf("listPrivate") !== -1, "CSV export: header includes listPrivate column");

  const result = T.parseTripCsv(csv);
  assertEqual(result.warnings.length, 0, "CSV roundtrip: no parse warnings for our own export");
  assertEqual(result.trip.days.length, 2, "CSV roundtrip: 2 days restored");
  assertEqual(result.trip.days[0].priv, true, "CSV roundtrip: day 1 priv=true restored");
  assertEqual(result.trip.days[1].priv, false, "CSV roundtrip: day 2 priv=false restored");
  assertEqual(result.trip.packingPriv, true, "CSV roundtrip: packingPriv=true restored");
  assertEqual(result.trip.todosPriv, false, "CSV roundtrip: todosPriv=false restored");
})();

(function testCsvBackwardCompat() {
  // 旧形式CSV: private/notePrivate/dayPrivate/listPrivate 列が一切無い
  const oldCsv =
    "day,date,start,category,mode,name,minutes,note,gmap\r\n" +
    '1,2026-03-01,09:00,観光,,Old Spot,60,,\r\n';
  T.setTrip(T.createBlankTripData());
  const result = T.parseTripCsv(oldCsv);
  assertEqual(result.warnings.length, 0, "old CSV: no warnings when required columns are all present");
  assertEqual(result.trip.days[0].priv, false, "old CSV (no dayPrivate column): day.priv defaults to false");
  assertEqual(result.trip.days[0].items[0].priv, false, "old CSV (no private column): item.priv defaults to false");
  assertEqual(result.trip.days[0].items[0].notePriv, false, "old CSV (no notePrivate column): item.notePriv defaults to false");
  // 第2テーブル(チェックリスト)が無い旧CSVでは既存の packingPriv/todosPriv を引き継ぐ
  assertEqual(result.trip.packingPriv, false, "old CSV without checklist table: packingPriv preserved from current trip (false)");

  // 旧CSV + 第2テーブルだけあるが listPrivate 列が無いケース
  const oldCsv2 =
    "day,date,start,category,mode,name,minutes,note,gmap\r\n" +
    "1,2026-03-01,09:00,観光,,Old Spot,60,,\r\n" +
    "\r\n" +
    "list,text,done\r\n" +
    "持ち物,Passport,0\r\n";
  const result2 = T.parseTripCsv(oldCsv2);
  assertEqual(result2.warnings.length, 0, "old CSV+list table (no listPrivate col): no warnings");
  assertEqual(result2.trip.packingPriv, false, "old CSV+list table without listPrivate column: defaults to false");
  assertEqual(result2.trip.packing.length, 1, "old CSV+list table: packing item still parsed correctly");
})();

(function testCsvEmptyPrivateListLimitation() {
  // 既知の制限: 空 かつ listPrivate=true のリストは、CSV往復でフラグが失われる
  T.setTrip(
    T.normalizeTrip({
      v: 1, title: "x", lang: "ja",
      days: [{ date: "", startTime: "09:00", tz: "", priv: false, items: [] }],
      packing: [],
      todos: [{ id: "t1", text: "y", done: false, priv: false }],
      packingPriv: true,
      todosPriv: false
    })
  );
  const csv = T.exportTripCsv();
  const result = T.parseTripCsv(csv);
  assertEqual(result.trip.packingPriv, false, "known limitation: empty packingPriv=true list loses the flag after CSV roundtrip (documented in SPEC)");
})();

(function testCsvMissingRequiredColumnsNoCrash() {
  const brokenCsv = "foo,bar\r\n1,2\r\n";
  let result;
  assert(
    (function () {
      try {
        result = T.parseTripCsv(brokenCsv);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    })(),
    "CSV: missing required columns does not throw"
  );
  assertEqual(result.warnings.length, 1, "CSV: missing required columns yields exactly 1 warning (fallback)");
  assertEqual(result.trip.days.length, 1, "CSV: fallback trip has a single blank day");
})();

console.log("\n---- pure-logic tests done: " + pass + " passed, " + fail + " failed so far ----\n");

// =========================================================
// 6. DOM/UI: 実際に init() が組み立てた本物のDOMを操作して検証する
// =========================================================
const document = window.document;

function click(elm) {
  elm.dispatchEvent(new window.Event("click", { bubbles: true }));
}

(function setupUiTrip() {
  const data = T.normalizeTrip({
    v: 1,
    title: "UI Test Trip",
    lang: "ja",
    days: [
      { date: "2026-04-01", startTime: "09:00", tz: "", priv: true, items: [
        { id: "u1", cat: "sight", name: "Hidden Day Spot", note: "", priv: false, notePriv: false }
      ] },
      { date: "2026-04-02", startTime: "09:00", tz: "", priv: false, items: [
        { id: "u2", cat: "sight", name: "Visible Spot", note: "", priv: false, notePriv: false }
      ] }
    ],
    packing: [{ id: "up1", text: "Passport", done: false, priv: false }],
    todos: [{ id: "ut1", text: "Book hotel", done: false, priv: false }],
    packingPriv: false,
    todosPriv: false
  });
  T.setTrip(data);
  T.render();
})();

(function testDayTabLockIcon() {
  const el = T.getEl();
  const tabs = el.dayTabs.querySelectorAll(".day-tab");
  assertEqual(tabs.length, 2, "UI: 2 day tabs rendered");
  assert(tabs[0].querySelector(".day-tab-lock") !== null, "UI: day tab 1 (private) shows the 🔒 lock icon");
  assert(tabs[1].querySelector(".day-tab-lock") === null, "UI: day tab 2 (public) has no lock icon");
})();

(function testDayMetaToggleReflectsState() {
  const el = T.getEl();
  // currentDayIndex は 0（private day）のはず
  assert(el.dayPrivToggle.classList.contains("active"), "UI: day-priv-toggle shows active state for private day 1");
  assert(!el.dayPrivBadge.classList.contains("hidden"), "UI: day-priv-badge is visible for private day 1");
  assertEqual(el.dayPrivToggle.getAttribute("aria-pressed"), "true", "UI: day-priv-toggle aria-pressed=true for private day");
})();

(function testDayMetaToggleClick() {
  const el = T.getEl();
  const trip = T.getTrip();
  assertEqual(trip.days[0].priv, true, "UI click precondition: day 1 currently private");
  click(el.dayPrivToggle);
  assertEqual(trip.days[0].priv, false, "UI click: clicking day-priv-toggle flips day.priv to false");
  assert(el.dayPrivBadge.classList.contains("hidden"), "UI click: day-priv-badge hides after toggling off");
  assert(el.dayTabs.querySelectorAll(".day-tab")[0].querySelector(".day-tab-lock") === null, "UI click: day tab lock icon disappears after toggling off");
  // 元に戻す
  click(el.dayPrivToggle);
  assertEqual(trip.days[0].priv, true, "UI click: clicking again restores day.priv to true");
})();

(function testChecklistListPrivToggleMainAndPrep() {
  const el = T.getEl();
  const trip = T.getTrip();
  assertEqual(trip.packingPriv, false, "UI precondition: packingPriv starts false");

  click(el.packingListPrivToggle);
  assertEqual(trip.packingPriv, true, "UI click: main packingListPrivToggle sets trip.packingPriv=true");
  assert(el.packingSection.classList.contains("checklist-section-private"), "UI: packingSection gets checklist-section-private class");
  assert(!el.packingListPrivBadge.classList.contains("hidden"), "UI: packingListPrivBadge becomes visible (main)");
  // 準備モーダル側も同じ状態を共有しているはず（同じ trip.packingPriv を参照する共通描画）
  assert(el.prepPackingSection.classList.contains("checklist-section-private"), "UI: prepPackingSection also reflects packingPriv (shared render)");
  assert(!el.prepPackingListPrivBadge.classList.contains("hidden"), "UI: prepPackingListPrivBadge becomes visible (prep)");
  assert(el.prepPackingListPrivToggle.classList.contains("active"), "UI: prepPackingListPrivToggle shows active too");

  // 個々の項目は消えていない（リスト全体トグルは表示上の切り替えのみで、削除はsanitize時のみ）
  assertEqual(el.packingItems.children.length, 1, "UI: toggling list-level priv does not remove individual packing items from the DOM");

  // 準備モーダル側のトグルをクリックしても同じ状態を切り替えられる（相互運用）
  click(el.prepPackingListPrivToggle);
  assertEqual(trip.packingPriv, false, "UI click: clicking the prep-modal toggle also flips trip.packingPriv back to false");
  assert(!el.packingSection.classList.contains("checklist-section-private"), "UI: main packingSection reflects the change back to false");
})();

(function testViewOnlyHidesNewToggles() {
  const el = T.getEl();
  T.setViewOnly(true);
  T.render();

  function isHidden(elm) {
    return window.getComputedStyle(elm).display === "none";
  }
  assert(isHidden(el.dayPrivToggle), "viewOnly: day-priv-toggle is hidden via CSS in view-only-mode");
  assert(isHidden(el.packingListPrivToggle), "viewOnly: packingListPrivToggle is hidden via CSS in view-only-mode");
  assert(isHidden(el.todosListPrivToggle), "viewOnly: todosListPrivToggle is hidden via CSS in view-only-mode");
  assert(isHidden(el.prepPackingListPrivToggle), "viewOnly: prepPackingListPrivToggle is hidden via CSS in view-only-mode");
  // 既存の🔒トグル（回帰確認）も引き続き隠れていること
  const anyItemPrivToggle = document.querySelector(".item-priv-toggle");
  if (anyItemPrivToggle) {
    assert(isHidden(anyItemPrivToggle), "viewOnly regression: existing .item-priv-toggle still hidden in view-only-mode");
  }
  assert(document.body.classList.contains("view-only-mode"), "viewOnly: body has view-only-mode class");

  T.setViewOnly(false);
  T.render();
  assert(!isHidden(el.dayPrivToggle), "viewOnly off: day-priv-toggle visible again after leaving view-only mode");
})();

(function testI18nSwitchUpdatesBadgeText() {
  const el = T.getEl();
  const trip = T.getTrip();
  // 非公開状態にしてバッジを表示させてから言語を切り替える
  trip.days[0].priv = true;
  trip.packingPriv = true;
  T.render();
  assertEqual(el.dayPrivBadge.textContent, "🔒 この日は非公開", "i18n: ja day badge text");
  assertEqual(el.packingListPrivBadge.textContent, "🔒 非公開", "i18n: ja checklist list badge text");

  trip.lang = "en";
  T.render();
  assertEqual(el.dayPrivBadge.textContent, "🔒 This day is private", "i18n: en day badge text");
  assertEqual(el.packingListPrivBadge.textContent, "🔒 Private", "i18n: en checklist list badge text");

  trip.lang = "zh";
  T.render();
  assertEqual(el.dayPrivBadge.textContent, "🔒 这一天为非公开", "i18n: zh day badge text");

  trip.lang = "th";
  T.render();
  assertEqual(el.dayPrivBadge.textContent, "🔒 วันนี้เป็นส่วนตัว", "i18n: th day badge text");

  // 元に戻す
  trip.lang = "ja";
  trip.days[0].priv = false;
  trip.packingPriv = false;
  T.render();
})();

(function testRegressionExistingPrivTogglesStillWork() {
  const el = T.getEl();
  const trip = T.getTrip();
  const day = trip.days[trip.days.length - 1];
  const itemCountBefore = day.items.length;
  assert(itemCountBefore > 0, "regression precondition: current day has at least one item");

  const itemPrivBtn = document.querySelector(".item-priv-toggle");
  assert(itemPrivBtn !== null, "regression: item-level priv toggle button exists in DOM");
  const wasActive = itemPrivBtn.classList.contains("active");
  click(itemPrivBtn);
  const nowActive = document.querySelector(".item-priv-toggle").classList.contains("active");
  assert(nowActive !== wasActive, "regression: clicking item-level priv toggle flips its active state");

  const checklistPrivBtn = document.querySelector(".checklist-priv-toggle");
  if (checklistPrivBtn) {
    const wasActive2 = checklistPrivBtn.classList.contains("active");
    click(checklistPrivBtn);
    const nowActive2 = document.querySelector(".checklist-priv-toggle").classList.contains("active");
    assert(nowActive2 !== wasActive2, "regression: clicking item-level checklist priv toggle flips its active state");
  }
})();

(function testShareHashRoundtripNoPrivateLeak() {
  // 共有リンク生成と同じ経路（sanitizeTripForPublic → JSON → base64url）を再現し、
  // デコードしても非公開の日・リストが含まれないことを確認する
  const trip = {
    v: 1,
    title: "share-test",
    lang: "ja",
    days: [
      { date: "d1", startTime: "09:00", tz: "", priv: true, items: [{ id: "z1", cat: "sight", name: "Secret", note: "", priv: false, notePriv: false }] },
      { date: "d2", startTime: "09:00", tz: "", priv: false, items: [{ id: "z2", cat: "sight", name: "Public", note: "", priv: false, notePriv: false }] }
    ],
    packing: [{ id: "zp1", text: "secret item", done: false, priv: false }],
    todos: [],
    packingPriv: true,
    todosPriv: false
  };
  const sanitized = T.sanitizeTripForPublic(trip);
  const json = JSON.stringify(sanitized);

  // toBase64Url/fromBase64Url と同じ変換をここで再現（内部関数は非公開だが、
  // btoa/atob は window に存在するので同じ経路を素通しで再現できる）
  function toBase64Url(str) {
    const bytes = new window.TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    const b64 = window.btoa(binary);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(b64url) {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = window.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new window.TextDecoder().decode(bytes);
  }

  const encoded = toBase64Url(json);
  const decodedJson = fromBase64Url(encoded);
  const decoded = JSON.parse(decodedJson);
  const normalized = T.normalizeTrip(decoded);

  assertEqual(normalized.days.length, 1, "share-link roundtrip: only the public day survives decode");
  assertEqual(normalized.days[0].date, "d2", "share-link roundtrip: surviving day is the public one");
  assertEqual(normalized.packing, [], "share-link roundtrip: packingPriv=true list is empty after decode");
  assert(!decodedJson.includes("Secret"), "share-link roundtrip: private day's content string is not present in the transmitted payload at all");
  assert(!decodedJson.includes("secret item"), "share-link roundtrip: private packing item's content string is not present in the transmitted payload at all");
})();

(function testPublicPreviewAndShareModalAllPrivateNoCrash() {
  const el = T.getEl();
  const data = T.normalizeTrip({
    v: 1,
    title: "all-private",
    lang: "ja",
    days: [
      { date: "d1", startTime: "09:00", tz: "", priv: true, items: [{ id: "ap1", cat: "sight", name: "S1", note: "", priv: false, notePriv: false }] },
      { date: "d2", startTime: "09:00", tz: "", priv: true, items: [{ id: "ap2", cat: "sight", name: "S2", note: "", priv: false, notePriv: false }] }
    ],
    packing: [{ id: "pp1", text: "x", done: false, priv: false }],
    todos: [{ id: "tt1", text: "y", done: false, priv: false }],
    packingPriv: true,
    todosPriv: true
  });
  T.setTrip(data);
  T.render();

  assert(
    (function () {
      try {
        T.openPublicPreviewModal();
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    })(),
    "openPublicPreviewModal: does not throw when ALL days + both lists are private"
  );
  assertEqual(el.publicPreviewContent.querySelectorAll(".print-day").length, 0, "openPublicPreviewModal: renders zero day sections when all days are private (no crash, just empty)");
  assert(el.publicPreviewExcluded.textContent.length > 0, "openPublicPreviewModal: excluded-count text is populated");

  assert(
    (function () {
      try {
        T.openShareModal();
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    })(),
    "openShareModal: does not throw when ALL days + both lists are private"
  );
  assert(el.shareUrl.value.indexOf("#d=") !== -1, "openShareModal: share URL still generated (with an empty-days payload) without crashing");

  // 復元してみて、実際に normalizeTrip を通しても壊れないことを再確認
  const hashPart = el.shareUrl.value.split("#d=")[1];
  function fromBase64Url(b64url) {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = window.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new window.TextDecoder().decode(bytes);
  }
  const restored = T.normalizeTrip(JSON.parse(fromBase64Url(hashPart)));
  assertEqual(restored.days.length, 1, "openShareModal payload: normalizeTrip fallback gives exactly one blank day when all days were private");
})();

console.log("\n==== TOTAL: " + pass + " passed, " + fail + " failed ====");
if (fail > 0) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exitCode = 1;
}
