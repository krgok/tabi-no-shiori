/**
 * 2026-10 監査（docs/audit-2026-10.md）のうち、セキュリティ・堅牢性の修正の回帰テスト。
 * 1. 壊れた共有リンク（#p= / #e=）で起動が止まらない
 * 2. 外から来たデータ（days/items に null 等）で normalizeTrip が例外にならない
 * 3. CSV: 数式として実行されうる先頭文字の無害化と、書き出し→読み込みの往復
 * 4. sw.js が事前キャッシュでHTTPキャッシュを経由しない
 * 座標・日付・時差・CSVの空行・モーダルは test-audit-2026-10b.js
 */
const fs = require("fs");
const path = require("path");
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function item(over) {
  return Object.assign(
    {
      id: "i" + Math.random().toString(36).slice(2, 7),
      cat: "sight",
      name: "スポット",
      loc: "",
      dur: 60,
      note: "",
      lat: null,
      lon: null,
      coordSrc: null,
      priv: false,
      notePriv: false,
      fixedStart: null,
      actualStart: null,
      actualLat: null,
      actualLon: null,
      gmap: "",
      gmapAuto: false,
      names: {}
    },
    over || {}
  );
}

function store(trip) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: trip, archived: false, cloudId: null, updatedAt: 1000, publicId: null }]
    })
  };
}

function baseTrip(days) {
  return { v: 1, title: "テスト旅行", titles: { ja: "テスト旅行" }, lang: "ja", days: days, packing: [], todos: [] };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  /* ================================================================ */
  section("1. 壊れた #p= / #e= で起動が止まらない（通常モードで開く）");
  for (const hash of ["#p=%E0%A4%A", "#e=%", "#p=a%2Fb", "#e=..%2F..%2Fx", "#p="]) {
    const env = boot({ hash });
    await tick();
    ok(env.errors.length === 0, hash + ": 例外が出ない", env.errors);
    ok(env.doc.querySelectorAll("#dayTabs > *").length > 0, hash + ": 画面が描画される");
    ok(env.win.eval("viewOnly") === false && env.win.eval("collabMode") === false, hash + ": 閲覧/共同編集モードに入らない");
    ok(env.win.location.hash === "", hash + ": 壊れたハッシュは消える", env.win.location.hash);
    ok(!env.fb.calls.some((c) => c.op === "get"), hash + ": Firestoreへ問い合わせない");
  }
  {
    const doc = { data: JSON.stringify({ v: 1, title: "他人の旅", titles: { ja: "他人の旅" }, lang: "ja", days: [{ date: "", startTime: "09:00", items: [] }], packing: [], todos: [] }) };
    const env = boot({ hash: "#p=PUB123", docs: { PUB123: doc } });
    await tick();
    ok(env.win.eval("viewOnly") === true, "正しい形式の #p= は従来どおり閲覧モードに入る");
    const env2 = boot({ hash: "#e=EDIT-1_x", docs: { "EDIT-1_x": Object.assign({ ownerUid: "u" }, doc) } });
    await tick();
    ok(env2.win.eval("collabMode") === true, "正しい形式の #e= は従来どおり共同編集モードに入る");
  }

  /* ================================================================ */
  section("2. 外から来たデータの正規化で例外にならない");
  {
    const env = boot({});
    let t;
    let threw = null;
    try {
      t = env.win.normalizeTrip({ days: [null, "x", 5, { items: [null, 7, "s", { name: "ok" }] }] });
    } catch (e) {
      threw = e.message;
    }
    ok(threw === null, "days/items に null・文字列・数値が混じっても例外にならない", threw);
    ok(t && t.days.length === 1 && t.days[0].items.length === 1 && t.days[0].items[0].name === "ok", "オブジェクトだけが残る", t);
    t = env.win.normalizeTrip({ days: [null] });
    ok(t.days.length === 1 && t.days[0].items.length === 0, "days が全て不正なら空の1日にフォールバックする");
  }
  {
    // 保存データの1要素が壊れていても、ほかのしおりごと消えない（起動時に新規サンプルで上書きされない）
    const bad = baseTrip([null, { date: "2026-07-24", startTime: "09:00", items: [null, item({ id: "k1", name: "残る" })] }]);
    const env = boot({ localStorage: store(bad) });
    await tick();
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    ok(saved.trips.length === 1 && saved.trips[0].id === "loc1", "壊れた要素を含むしおりがサンプルで上書きされない", saved.trips.map((x) => x.id));
    ok(JSON.stringify(saved).indexOf("残る") !== -1, "有効な項目は残る");
  }

  /* ================================================================ */
  section("3. CSV: 数式の無害化と往復");
  {
    const env = boot({});
    const g = env.win.csvGuardFormula;
    const u = env.win.csvUnguardFormula;
    const nasty = ["=1+1", "+81 3", "-5度", "@SUM(A1)", "\tx", "\rx", "'=x", "''+x", "'abc", "abc=1", "", "普通", "=HYPERLINK(\"http://example.invalid\",\"x\")"];
    nasty.forEach((s) => ok(u(g(s)) === s, "ガードの往復が元に戻る: " + JSON.stringify(s)));
    ok(g("=1+1") === "'=1+1" && g("普通") === "普通" && g("'abc") === "'abc", "危険な先頭だけに ' が付く");

    const trip = baseTrip([
      {
        id: "d1",
        date: "2026-07-24",
        startTime: "07:30",
        tz: "Asia/Tokyo",
        priv: false,
        dateManual: true,
        items: [
          item({ id: "x1", name: "=cmd|' /C calc'!A0", note: "-5度に注意\n2行目, \"引用\"", gmap: "https://www.google.com/maps?q=35.68,139.76", lat: 35.68, lon: 139.76, coordSrc: "gmap", fixedStart: "08:00" }),
          item({ id: "x2", cat: "move", name: "電車", mode: "train", dur: 30, arriveTz: "Asia/Bangkok", priv: true, notePriv: true, note: "+1", actualStart: "09:10", actualLat: 13.7, actualLon: 100.5 }),
          item({ id: "x3", cat: "meal", name: "@昼食", dur: 45 })
        ]
      },
      { id: "d2", date: "2026-07-25", startTime: "09:00", tz: "", priv: true, dateManual: true, items: [item({ id: "y1", name: "二日目" })] }
    ]);
    trip.packing = [{ id: "p1", text: "=充電器", done: true, priv: false }];
    trip.todos = [{ id: "t1", text: "-予約", done: false, priv: true }];
    trip.todosPriv = true;

    const env2 = boot({ localStorage: store(trip) });
    await tick();
    const csv = env2.win.exportTripCsv();
    const lines = csv.split("\r\n");
    ok(lines.some((l) => l.indexOf("'=cmd") !== -1), "書き出しで名前の先頭の = が ' で無害化される");
    ok(!lines.some((l) => /,=cmd/.test(l)), "数式として解釈される先頭の = が残らない");

    const back = env2.win.parseTripCsv(csv);
    ok(back.warnings.length === 0, "往復で警告が出ない", back.warnings);
    const strip = (t) => ({
      title: t.titles.ja,
      days: t.days.map((d) => ({
        date: d.date, startTime: d.startTime, tz: d.tz, priv: d.priv,
        items: d.items.map((i) => ({
          cat: i.cat, name: i.name, dur: i.dur, note: i.note, gmap: i.gmap || "", priv: i.priv, notePriv: i.notePriv,
          fixedStart: i.fixedStart, actualStart: i.actualStart, actualLat: i.actualLat, actualLon: i.actualLon,
          mode: i.mode || null, arriveTz: i.arriveTz || ""
        }))
      })),
      packing: t.packing.map((i) => [i.text, i.done, i.priv]),
      todos: t.todos.map((i) => [i.text, i.done, i.priv]),
      packingPriv: t.packingPriv, todosPriv: t.todosPriv
    });
    const orig = strip(env2.win.eval("trip"));
    const got = strip(back.trip);
    ok(same(orig, got), "書き出し→読み込みで、しおりの内容（名前・メモ・時刻・実績・非公開・リスト）が同じになる", { orig, got });
    ok(back.trip.days[0].items[0].lat === 35.68 && back.trip.days[0].items[0].coordSrc === "gmap", "場所リンクから座標が復元される");

  }

  /* ================================================================ */
  section("4. sw.js: 事前キャッシュはHTTPキャッシュを経由しない");
  {
    const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
    ok(/new Request\(url,\s*\{\s*cache:\s*"reload"\s*\}\)/.test(sw), 'cache.add に { cache: "reload" } のリクエストを渡している');
    ok(!/cache\.add\(url\)/.test(sw), "素の cache.add(url) が残っていない");
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
