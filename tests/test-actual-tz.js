/**
 * 実績時刻のタイムゾーン対応（23d、SPEC 23参照）検証ハーネス
 * 端末の時計ではなく項目の現地時間（startTz）で actualStart を記録する仕組みを検証する。
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する（test-actual.jsと同じ方式）。
 *
 * 端末のタイムゾーンをテスト全体で Asia/Bangkok に固定する。国をまたぐ便の直後に端末が
 * まだ出発地時刻のままというシナリオを再現するため（harness.js の require より前に設定する必要がある。
 * jsdom の Window の Date も同じプロセスのICUを使うため、この設定が反映される）。
 */
process.env.TZ = "Asia/Bangkok";

const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function baseItem(id, name, extra) {
  return Object.assign(
    {
      id,
      cat: "sight",
      name,
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
      actualAt: null,
      gmap: "",
      gmapAuto: false,
      names: {},
      noteNames: {}
    },
    extra || {}
  );
}

function moveItem(id, name, extra) {
  return baseItem(
    id,
    name,
    Object.assign({ cat: "move", dur: 30, mode: "train", auto: false, arriveTz: "" }, extra || {})
  );
}

function tripWithDay(date, tz, items, startTime) {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [{ date, startTime: startTime || "09:00", tz: tz, priv: false, dateManual: false, items }],
    packing: [],
    todos: [],
    packingPriv: false,
    todosPriv: false
  };
}

function storeOf(trip) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: trip, archived: false, cloudId: null, updatedAt: 1000, publicId: null, editId: null }]
    })
  };
}

// 端末のDateをテスト内の任意の瞬間へ固定するためのヘルパー。✓ボタンの「今日か」判定のような
// 深夜前後の境界ケースは実際の壁時計に依存させると再現できないため、win.Date自体を差し替える。
// 引数無しの new Date() だけを固定し、new Date(y,m,d,...) 等の明示的な呼び出しは元のDateへ委譲する
// （日付計算のヘルパー内部での通常のDate利用を壊さないため）
function installFixedNow(win, fixedMs) {
  const RealDate = win.Date;
  function FakeDate(...args) {
    if (args.length === 0) return new RealDate(fixedMs);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => fixedMs;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  win.Date = FakeDate;
  return () => {
    win.Date = RealDate;
  };
}

(async () => {
  /* ================================================================ */
  section("1. formatHHMMInTz: 有効なtz/空文字/無効なtz/24時正規化");
  {
    const env = boot({});
    await tick();
    const formatHHMMInTz = env.win.formatHHMMInTz;

    const d = new Date(Date.UTC(2026, 7, 17, 2, 24)); // UTC 2026-08-17 02:24
    ok(formatHHMMInTz(d, "Asia/Bangkok") === "09:24", "UTC+7(Bangkok)で09:24になる", formatHHMMInTz(d, "Asia/Bangkok"));
    ok(formatHHMMInTz(d, "Asia/Tokyo") === "11:24", "UTC+9(Tokyo)で11:24になる", formatHHMMInTz(d, "Asia/Tokyo"));

    const localExpected = env.win.pad2(d.getHours()) + ":" + env.win.pad2(d.getMinutes());
    ok(formatHHMMInTz(d, "") === localExpected, "tzが空文字なら端末ローカル時刻になる", formatHHMMInTz(d, ""));
    ok(formatHHMMInTz(d, "Nowhere/Nope") === localExpected, "無効なtz文字列は例外を投げず端末ローカル時刻にフォールバックする", formatHHMMInTz(d, "Nowhere/Nope"));

    const midnight = new Date(Date.UTC(2026, 7, 17, 15, 0)); // UTC 15:00 -> Asia/Tokyo(+9)で翌日00:00
    ok(formatHHMMInTz(midnight, "Asia/Tokyo") === "00:00", "深夜0時は24:00表記ではなく00:00に正規化される", formatHHMMInTz(midnight, "Asia/Tokyo"));
  }

  /* ================================================================ */
  section("2. dateStrInTz: 日付が変わる境界での現地日付");
  {
    const env = boot({});
    await tick();
    const dateStrInTz = env.win.dateStrInTz;

    const d = new Date(Date.UTC(2026, 7, 17, 16, 30)); // UTC 2026-08-17 16:30
    ok(dateStrInTz(d, "Asia/Tokyo") === "2026-08-18", "Tokyo(+9)では日付が進んで08-18になる", dateStrInTz(d, "Asia/Tokyo"));
    ok(dateStrInTz(d, "America/Los_Angeles") === "2026-08-17", "Los Angeles(-7)ではまだ08-17のまま", dateStrInTz(d, "America/Los_Angeles"));

    const localExpected = d.getFullYear() + "-" + env.win.pad2(d.getMonth() + 1) + "-" + env.win.pad2(d.getDate());
    ok(dateStrInTz(d, "") === localExpected, "tzが空文字なら端末ローカル日付になる", dateStrInTz(d, ""));
    ok(dateStrInTz(d, "Nowhere/Nope") === localExpected, "無効なtz文字列は端末ローカル日付にフォールバックする", dateStrInTz(d, "Nowhere/Nope"));
  }

  /* ================================================================ */
  section("3. getDayTimedItems: 項目ごとのstartTz(国をまたぐ移動の前後で切り替わる)");
  {
    const env = boot({});
    await tick();
    const getDayTimedItems = env.win.getDayTimedItems;

    // day.tz=Asia/Bangkok、move(arriveTz=Asia/Tokyo)を境にstartTzが切り替わる。
    // move自身のstartTzは出発側(Bangkok)であること(実績=出発時刻を記録する項目のため)
    const day1 = {
      date: "2026-08-17",
      startTime: "09:00",
      tz: "Asia/Bangkok",
      items: [baseItem("s1", "スポットA"), moveItem("m1", "空港へ移動 → 到着", { arriveTz: "Asia/Tokyo" }), baseItem("s2", "スポットB")]
    };
    const timed1 = getDayTimedItems(day1);
    ok(timed1.map((t) => t.startTz).join(",") === "Asia/Bangkok,Asia/Bangkok,Asia/Tokyo", "startTzが[Bangkok,Bangkok,Tokyo]になる(moveは出発側)", timed1.map((t) => t.startTz));

    // day.tz未設定なら""が続く(端末時間扱い)
    const day2 = {
      date: "2026-08-17",
      startTime: "09:00",
      tz: "",
      items: [baseItem("s3", "スポットC"), baseItem("s4", "スポットD")]
    };
    const timed2 = getDayTimedItems(day2);
    ok(timed2.every((t) => t.startTz === ""), "day.tz未設定なら全項目のstartTzが空文字のまま", timed2.map((t) => t.startTz));

    // arriveTzが無効な文字列なら切り替わらない
    const day3 = {
      date: "2026-08-17",
      startTime: "09:00",
      tz: "Asia/Bangkok",
      items: [baseItem("s5", "スポットE"), moveItem("m2", "移動", { arriveTz: "Nowhere/Nope" }), baseItem("s6", "スポットF")]
    };
    const timed3 = getDayTimedItems(day3);
    ok(timed3.every((t) => t.startTz === "Asia/Bangkok"), "arriveTzが無効なtz文字列なら切り替わらずBangkokのまま", timed3.map((t) => t.startTz));
  }

  /* ================================================================ */
  section("4. isDayToday: 端末の今日 または day.tzでの今日のどちらかに一致すれば今日扱い");
  {
    const env = boot({});
    await tick();
    const isDayToday = env.win.isDayToday;

    // UTC 2026-08-16 16:00 => Bangkok(端末想定tz) 08-16 23:00、Tokyo 08-17 01:00
    // isDayToday内の `now instanceof Date` 判定はjsdomのWindowが持つDateを見るため、
    // env.win.Date でインスタンス化する(Node側の素のDateだと別レルムでinstanceofが false になる)
    const now = new env.win.Date(Date.UTC(2026, 7, 16, 16, 0));

    ok(isDayToday({ date: "2026-08-16", tz: "" }, now) === true, "端末ローカル(tz無し想定)の今日と一致すればtrue");
    ok(isDayToday({ date: "2026-08-17", tz: "Asia/Tokyo" }, now) === true, "day.tzでの今日と一致すればtrue(端末の今日とは不一致でもよい)", true);
    ok(isDayToday({ date: "2026-08-15", tz: "Asia/Tokyo" }, now) === false, "端末の今日ともday.tzでの今日とも一致しなければfalse");
    ok(isDayToday({ date: "", tz: "" }, now) === false, "date未設定はfalse");
    ok(isDayToday(null, now) === false, "dayがnullでも例外にならずfalse");
  }

  /* ================================================================ */
  section("5. 統合: recordActualStartは項目のタイムゾーンで現地時刻を記録する(端末TZ=Asia/Bangkok)");
  {
    const trip = tripWithDay("2026-08-17", "Asia/Tokyo", [baseItem("t1", "成田到着後の予定")]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    // 分の境界で揺れるため、呼び出し前後でTokyo時刻を計算し、どちらかに一致すればOKとする
    const before = env.win.formatHHMMInTz(new env.win.Date(), "Asia/Tokyo");
    env.win.recordActualStart("t1");
    await tick();
    const after = env.win.formatHHMMInTz(new env.win.Date(), "Asia/Tokyo");

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const t1 = saved.trips[0].data.days[0].items.find((i) => i.id === "t1");
    ok(t1.actualStart === before || t1.actualStart === after, "actualStartがAsia/Tokyoの現地時刻(端末はBangkokのまま)で記録される", { actualStart: t1.actualStart, before, after });
  }

  /* ================================================================ */
  section("6. 統合: tz未設定の項目は従来通り端末時刻で記録される");
  {
    const trip = tripWithDay("2026-08-17", "", [baseItem("u1", "国内の予定")]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    const before = env.win.pad2(new env.win.Date().getHours()) + ":" + env.win.pad2(new env.win.Date().getMinutes());
    env.win.recordActualStart("u1");
    await tick();
    const after = env.win.pad2(new env.win.Date().getHours()) + ":" + env.win.pad2(new env.win.Date().getMinutes());

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const u1 = saved.trips[0].data.days[0].items.find((i) => i.id === "u1");
    ok(u1.actualStart === before || u1.actualStart === after, "tz未設定の項目は端末ローカル時刻のまま記録される", { actualStart: u1.actualStart, before, after });
  }

  /* ================================================================ */
  section("7. 統合: ✓ボタンの「今日か過去日か」判定が項目のタイムゾーンで行われる(深夜境界)");
  {
    // 固定する瞬間: UTC 2026-08-16 16:00 => 端末(Bangkok)は08-16 23:00、項目のtz(Tokyo)は08-17 01:00。
    // day.dateをTokyo側の「今日」(08-17)に合わせておくと、端末の日付だけで判定する旧実装では
    // 「今日ではない(過去日)」と誤判定され、予定開始時刻プリセットの編集モードが開いてしまう。
    // 項目のタイムゾーンで判定する新実装では「今日」と判定され、即座に記録される
    const fixedMs = Date.UTC(2026, 7, 16, 16, 0, 0);
    const trip = tripWithDay("2026-08-17", "Asia/Tokyo", [baseItem("v1", "成田到着後の予定", { dur: 60 })], "09:00");
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    const restore = installFixedNow(env.win, fixedMs);
    try {
      const recordBtn = env.doc.querySelector("#timeline .item-card[data-id='v1'] .item-actual-record-btn");
      ok(!!recordBtn, "✓ボタンが存在する");
      recordBtn.click();
      await tick();
    } finally {
      restore();
    }

    ok(!env.doc.querySelector("#timeline .item-card[data-id='v1'] .item-actual-input"), "項目のtz(Tokyo)では「今日」と判定され、過去日プリセットの編集モードは開かない");
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const v1 = saved.trips[0].data.days[0].items.find((i) => i.id === "v1");
    ok(v1.actualStart === "01:00", "Tokyo現地時刻(01:00)で即記録される(端末のBangkok時刻23:00ではない)", v1.actualStart);
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
