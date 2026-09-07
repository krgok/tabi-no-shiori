/**
 * 実績記録UX改善（フェーズ2、SPEC 23）検証ハーネス
 * A: ✓ボタンの二度押し防止と過去日の振り返り入力
 * B: 到着の自動提案（findArrivalCandidate / maybePromptArrival）
 * C: 1日の振り返りサマリー（computeDayActualSummary）
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する（test-actual.jsと同じ方式）。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

// ✓ボタンは「その日が今日かどうか」で挙動を変えるため、フィクスチャの日付は
// 固定値ではなく実行時の「今日」に合わせる（test-actual.jsと同じ理由）
function todayStr() {
  var d = new Date();
  var pad = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function yesterdayStr() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  var pad = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

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

function tripWithDay(date, items, startTime) {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [{ date, startTime: startTime || "09:00", tz: "", priv: false, dateManual: false, items }],
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

(async () => {
  /* ================================================================ */
  section("A1. 記録済みの項目で✓を押しても上書きせず、編集モードが開く");
  {
    const trip = tripWithDay(todayStr(), [baseItem("a1", "スポットA", { actualStart: "09:10", actualAt: 500 })]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    const card = env.doc.querySelector("#timeline .item-card[data-id='a1']");
    const recordBtn = card.querySelector(".item-actual-record-btn");
    ok(recordBtn.classList.contains("is-recorded"), "記録済みの✓ボタンにis-recordedクラスが付く");
    ok(recordBtn.title === env.win.I18N.t("ja", "timeline.actualRecordedBtnTitle"), "記録済みのtitleが専用文言になる", recordBtn.title);

    recordBtn.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const a1 = saved.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1.actualStart === "09:10", "記録済みの実績は✓再クリックでは上書きされない", a1.actualStart);

    const input = env.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-input");
    ok(!!input, "上書きせず実績の編集用inputが開く");
    ok(input.value === "09:10", "編集用inputの初期値は既存の実績値のまま", input.value);
  }

  /* ================================================================ */
  section("A2. 未記録・今日の日付の項目に✓ → 現在時刻が記録される（回帰）");
  {
    const trip = tripWithDay(todayStr(), [baseItem("b1", "スポットB")]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    const recordBtn = env.doc.querySelector("#timeline .item-card[data-id='b1'] .item-actual-record-btn");
    ok(!recordBtn.classList.contains("is-recorded"), "未記録の✓ボタンにis-recordedは付かない");
    recordBtn.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const b1 = saved.trips[0].data.days[0].items.find((i) => i.id === "b1");
    ok(typeof b1.actualStart === "string" && /^\d{2}:\d{2}$/.test(b1.actualStart), "今日の日付なら現在時刻がそのまま記録される", b1.actualStart);
    ok(!env.doc.querySelector("#timeline .item-card[data-id='b1'] .item-actual-input"), "今日の日付では編集モードを経由せず即記録される");
  }

  /* ================================================================ */
  section("A3. 未記録・過去日の項目に✓ → 記録されず、予定開始時刻プリセットのinputが出る");
  {
    // startTime=10:00、dur=60のitemの予定開始は10:00
    const trip = tripWithDay(yesterdayStr(), [baseItem("c1", "スポットC", { dur: 60 })], "10:00");
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    const recordBtn = env.doc.querySelector("#timeline .item-card[data-id='c1'] .item-actual-record-btn");
    recordBtn.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const c1 = saved.trips[0].data.days[0].items.find((i) => i.id === "c1");
    ok(c1.actualStart === null, "過去日では「今」を記録しない", c1.actualStart);

    const input = env.doc.querySelector("#timeline .item-card[data-id='c1'] .item-actual-input");
    ok(!!input, "過去日では実績の編集用inputが開く");
    ok(input.value === "10:00", "inputの初期値に予定開始時刻がプリセットされる", input.value);

    // Escapeでキャンセルしてもプリセットは残らない（次に開いたときに前回のプリセットが漏れ出さない）
    input.dispatchEvent(new env.win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    await tick();
    ok(env.win.actualStartEditPreset === null, "編集モードを閉じるとactualStartEditPresetはnullに戻る");
  }

  /* ================================================================ */
  section("A4. 日付が空の日は「今日ではない」扱いにせず、今日と同じく即記録する");
  {
    const trip = tripWithDay("", [baseItem("d1", "スポットD")]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();
    env.doc.querySelector("#timeline .item-card[data-id='d1'] .item-actual-record-btn").click();
    await tick();
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const d1 = saved.trips[0].data.days[0].items.find((i) => i.id === "d1");
    ok(typeof d1.actualStart === "string" && /^\d{2}:\d{2}$/.test(d1.actualStart), "日付未設定の日では現在時刻がそのまま記録される", d1.actualStart);
  }

  /* ================================================================ */
  section("A5. 4言語の新規文字列");
  {
    const env = boot({ localStorage: storeOf(tripWithDay(todayStr(), [baseItem("x", "X")])) });
    await tick();
    const keys = [
      "timeline.actualRecordedBtnTitle",
      "timeline.arrivalPromptText",
      "timeline.arrivalPromptRecord",
      "timeline.arrivalPromptLater",
      "settings.arrivalPrompt",
      "timeline.daySummary",
      "timeline.daySummaryNoLate"
    ];
    ["ja", "en", "zh", "th"].forEach((L) => {
      keys.forEach((k) => {
        const v = env.win.I18N.t(L, k);
        ok(typeof v === "string" && v.length > 0 && v !== k, `${L}: ${k} が定義されている`, v);
      });
    });
  }

  /* ================================================================ */
  section("B1. findArrivalCandidate: 半径内で最も近い未記録項目を返す");
  {
    const env = boot({});
    await tick();
    const findArrivalCandidate = env.win.findArrivalCandidate;
    const trip = tripWithDay(todayStr(), [
      baseItem("near", "近い場所", { lat: 35.0, lon: 139.0 }),
      baseItem("far", "遠い場所", { lat: 36.0, lon: 140.0 }) // 300km超（緯度経度1度は100km以上）
    ]);
    const coords = { lat: 35.001, lon: 139.001 }; // nearから極めて近い
    const candidate = findArrivalCandidate(trip, coords, todayStr());
    ok(!!candidate, "候補が見つかる");
    ok(candidate.item.id === "near", "最も近い項目が返る", candidate.item.id);
    ok(typeof candidate.distanceM === "number" && candidate.distanceM < env.win.ARRIVAL_PROMPT_RADIUS_M, "距離は半径以内", candidate.distanceM);
  }

  /* ================================================================ */
  section("B2. findArrivalCandidate: 記録済み・dismissed・今日以外・該当なしは除外される");
  {
    const env = boot({});
    await tick();
    const findArrivalCandidate = env.win.findArrivalCandidate;
    const coords = { lat: 35.0, lon: 139.0 };

    // 記録済みは除外
    const tripRecorded = tripWithDay(todayStr(), [baseItem("r1", "記録済み", { lat: 35.0, lon: 139.0, actualStart: "09:00" })]);
    ok(findArrivalCandidate(tripRecorded, coords, todayStr()) === null, "actualStartがある項目は候補から除外される");

    // dismissedは除外
    const tripDismissed = tripWithDay(todayStr(), [baseItem("d1", "あとで押した", { lat: 35.0, lon: 139.0 })]);
    env.win.arrivalPromptDismissedIds["d1"] = true;
    ok(findArrivalCandidate(tripDismissed, coords, todayStr()) === null, "あとでを押した項目(dismissed)は候補から除外される");
    delete env.win.arrivalPromptDismissedIds["d1"];

    // 今日以外の日は除外
    const tripOtherDay = tripWithDay(yesterdayStr(), [baseItem("y1", "昨日の予定", { lat: 35.0, lon: 139.0 })]);
    ok(findArrivalCandidate(tripOtherDay, coords, todayStr()) === null, "todayStrと一致しない日の項目は候補から除外される");

    // 座標が無い項目・半径外は除外され、該当なしはnull
    const tripNoCoord = tripWithDay(todayStr(), [baseItem("n1", "座標なし")]);
    ok(findArrivalCandidate(tripNoCoord, coords, todayStr()) === null, "座標(lat/lon)が無い項目は候補にならない");

    const tripFar = tripWithDay(todayStr(), [baseItem("f1", "遠い", { lat: 10.0, lon: 100.0 })]);
    ok(findArrivalCandidate(tripFar, coords, todayStr()) === null, "半径を超える項目しか無ければnullを返す");
  }

  /* ================================================================ */
  section("B3. maybePromptArrival: permissions=granted でバナーが出て「記録する」で実績と座標が入る");
  {
    const trip = tripWithDay(todayStr(), [baseItem("g1", "到着候補", { lat: 35.5, lon: 139.5 })]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    let getCurrentPositionCalls = 0;
    env.win.navigator.geolocation = {
      getCurrentPosition: function (success) {
        getCurrentPositionCalls++;
        success({ coords: { latitude: 35.5001, longitude: 139.5001 } });
      }
    };
    env.win.navigator.permissions = {
      query: function () {
        return Promise.resolve({ state: "granted" });
      }
    };

    env.win.maybePromptArrival("test");
    await tick();
    await tick(); // permissions.query()のthenを挟むため2回待つ

    ok(getCurrentPositionCalls === 1, "permissions=grantedならgetCurrentPositionが呼ばれる", getCurrentPositionCalls);
    const banner = env.doc.getElementById("arrivalPrompt");
    ok(banner && !banner.classList.contains("hidden"), "候補が見つかるとバナーが表示される");
    ok(env.doc.getElementById("arrivalPromptText").textContent.indexOf("到着候補") !== -1, "バナーの文言に項目名が入る", env.doc.getElementById("arrivalPromptText").textContent);

    env.doc.getElementById("arrivalPromptRecordBtn").click();
    await tick();

    ok(banner.classList.contains("hidden"), "「記録する」を押すとバナーが閉じる");
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const g1 = saved.trips[0].data.days[0].items.find((i) => i.id === "g1");
    ok(typeof g1.actualStart === "string" && /^\d{2}:\d{2}$/.test(g1.actualStart), "「記録する」で実績時刻が記録される", g1.actualStart);
    ok(g1.actualLat === 35.5001 && g1.actualLon === 139.5001, "取得済みの座標がそのまま保存される(二重GPS取得なし)", [g1.actualLat, g1.actualLon]);
  }

  /* ================================================================ */
  section("B4. maybePromptArrival: 「あとで」を押すとdismissedに入りバナーが閉じる");
  {
    const trip = tripWithDay(todayStr(), [baseItem("l1", "あとで候補", { lat: 35.6, lon: 139.6 })]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    env.win.navigator.geolocation = {
      getCurrentPosition: function (success) {
        success({ coords: { latitude: 35.6, longitude: 139.6 } });
      }
    };
    env.win.navigator.permissions = {
      query: function () {
        return Promise.resolve({ state: "granted" });
      }
    };

    env.win.maybePromptArrival("test");
    await tick();
    await tick();

    const banner = env.doc.getElementById("arrivalPrompt");
    ok(!banner.classList.contains("hidden"), "前提: バナーが表示されている");

    env.doc.getElementById("arrivalPromptLaterBtn").click();
    await tick();

    ok(banner.classList.contains("hidden"), "「あとで」を押すとバナーが閉じる");
    ok(env.win.arrivalPromptDismissedIds["l1"] === true, "「あとで」を押した項目がdismissedIdsに入る");
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const l1 = saved.trips[0].data.days[0].items.find((i) => i.id === "l1");
    ok(l1.actualStart === null, "「あとで」では実績を記録しない");
  }

  /* ================================================================ */
  section("B5. maybePromptArrival: permissions状態がprompt(未許可)なら自動取得しない");
  {
    const trip = tripWithDay(todayStr(), [baseItem("p1", "候補", { lat: 35.7, lon: 139.7 })]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();

    let calls = 0;
    env.win.navigator.geolocation = {
      getCurrentPosition: function () {
        calls++;
      }
    };
    env.win.navigator.permissions = {
      query: function () {
        return Promise.resolve({ state: "prompt" });
      }
    };

    env.win.maybePromptArrival("test");
    await tick();
    await tick();

    ok(calls === 0, "permissions=promptでは勝手にgetCurrentPositionを呼ばない(許可ダイアログを出さない)", calls);
  }

  /* ================================================================ */
  section("B6. maybePromptArrival: 設定OFFなら permissions すら確認せず何もしない");
  {
    const trip = tripWithDay(todayStr(), [baseItem("o1", "候補", { lat: 35.8, lon: 139.8 })]);
    const env = boot({ localStorage: storeOf(trip) });
    await tick();
    env.win.setArrivalPromptEnabled(false);

    let permCalls = 0;
    let geoCalls = 0;
    env.win.navigator.geolocation = {
      getCurrentPosition: function () {
        geoCalls++;
      }
    };
    env.win.navigator.permissions = {
      query: function () {
        permCalls++;
        return Promise.resolve({ state: "granted" });
      }
    };

    env.win.maybePromptArrival("test");
    await tick();
    await tick();

    ok(permCalls === 0, "設定OFFではpermissions.queryすら呼ばない", permCalls);
    ok(geoCalls === 0, "設定OFFではgetCurrentPositionも呼ばない", geoCalls);
  }

  /* ================================================================ */
  section("B7. maybePromptArrival: permissions APIが無い環境ではGEO_GRANTED_KEYの有無で判定する");
  {
    const trip = tripWithDay(todayStr(), [baseItem("f1", "候補", { lat: 35.9, lon: 139.9 })]);

    // 7a: フラグが無ければ自動取得しない
    const envNoFlag = boot({ localStorage: storeOf(trip) });
    await tick();
    let callsNoFlag = 0;
    envNoFlag.win.navigator.geolocation = {
      getCurrentPosition: function () {
        callsNoFlag++;
      }
    };
    // permissions APIを未定義のままにする(navigator.permissionsが存在しない環境を再現)
    ok(!envNoFlag.win.navigator.permissions, "前提: このテスト環境にpermissions APIは無い");
    envNoFlag.win.maybePromptArrival("test");
    await tick();
    ok(callsNoFlag === 0, "GEO_GRANTED_KEYが無ければ自動取得しない", callsNoFlag);

    // 7b: フラグがあれば自動取得する
    const storeWithFlag = storeOf(trip);
    storeWithFlag["tabi-shiori-geo-granted"] = "1";
    const envFlag = boot({ localStorage: storeWithFlag });
    await tick();
    let callsFlag = 0;
    envFlag.win.navigator.geolocation = {
      getCurrentPosition: function (success) {
        callsFlag++;
        success({ coords: { latitude: 35.9, longitude: 139.9 } });
      }
    };
    ok(!envFlag.win.navigator.permissions, "前提: このテスト環境にpermissions APIは無い");
    envFlag.win.maybePromptArrival("test");
    await tick();
    ok(callsFlag === 1, "GEO_GRANTED_KEY=1があれば自動取得する", callsFlag);
  }

  /* ================================================================ */
  section("C1. computeDayActualSummary: 記録数・最新のずれ・最大の遅れ");
  {
    const env = boot({});
    await tick();
    const computeDayActualSummary = env.win.computeDayActualSummary;
    const getDayTimedItems = env.win.getDayTimedItems;

    // startTime=09:00。item1(dur60,予定09:00)実績09:10(+10) → item2(dur30,予定10:00)実績10:05(+5)
    // → item3(dur45,予定10:30)実績11:00(+30、最大の遅れ) が並び順で最後ではない点に注意し、
    // 「並び順で最後」がitem3であることも確認できる構成にする
    const day = {
      date: todayStr(),
      startTime: "09:00",
      tz: "",
      items: [
        baseItem("i1", "項目1", { dur: 60, actualStart: "09:10" }),
        baseItem("i2", "項目2", { dur: 30, actualStart: "10:05" }),
        baseItem("i3", "項目3", { dur: 45, actualStart: "11:00" })
      ]
    };
    const timed = getDayTimedItems(day);
    const summary = computeDayActualSummary(day, timed);
    ok(summary.recorded === 3 && summary.total === 3, "記録数/総数が正しい", summary);
    ok(summary.latestDiffMin === 30, "最新(並び順で最後)の項目はitem3で+30分", summary.latestDiffMin);
    ok(summary.worst && summary.worst.diffMin === 30 && summary.worst.name === "項目3", "最大の遅れはitem3(+30分)", summary.worst);
  }

  /* ================================================================ */
  section("C2. computeDayActualSummary: 遅れが1件も無ければworstはnull、実績0件ならnull");
  {
    const env = boot({});
    await tick();
    const computeDayActualSummary = env.win.computeDayActualSummary;
    const getDayTimedItems = env.win.getDayTimedItems;

    const dayAllEarly = {
      date: todayStr(),
      startTime: "09:00",
      tz: "",
      items: [baseItem("e1", "早着1", { dur: 60, actualStart: "08:50" }), baseItem("e2", "早着2", { dur: 30, actualStart: "09:55" })]
    };
    const summaryEarly = computeDayActualSummary(dayAllEarly, getDayTimedItems(dayAllEarly));
    ok(summaryEarly.worst === null, "遅れが1件も無ければworstはnull", summaryEarly.worst);
    ok(summaryEarly.latestDiffMin === -5, "最新(最後)の項目のずれは-5分", summaryEarly.latestDiffMin);

    const dayNone = { date: todayStr(), startTime: "09:00", tz: "", items: [baseItem("n1", "未記録", { dur: 60 })] };
    ok(computeDayActualSummary(dayNone, getDayTimedItems(dayNone)) === null, "実績が1件も無ければnullを返す");
  }

  /* ================================================================ */
  section("D1. 日サマリーのDOMは実績がある日にだけ出る");
  {
    const tripNone = tripWithDay(todayStr(), [baseItem("s1", "項目1", { dur: 60 })]);
    const envNone = boot({ localStorage: storeOf(tripNone) });
    await tick();
    ok(!envNone.doc.querySelector("#timeline .day-actual-summary"), "実績が1件も無い日にはサマリーが出ない");

    const tripSome = tripWithDay(todayStr(), [
      baseItem("s2", "項目1", { dur: 60, actualStart: "09:20" }),
      baseItem("s3", "項目2", { dur: 30 })
    ]);
    const envSome = boot({ localStorage: storeOf(tripSome) });
    await tick();
    const summaryEl = envSome.doc.querySelector("#timeline .day-actual-summary");
    ok(!!summaryEl, "実績が1件でもあればサマリーが出る");
    ok(summaryEl.textContent.indexOf("1/2") !== -1, "サマリーに記録数/総数(1/2)が含まれる", summaryEl.textContent);
    ok(summaryEl === envSome.doc.querySelector("#timeline").firstElementChild, "サマリーはタイムライン先頭に置かれる");
  }

  /* ================================================================ */
  section("D2. 日サマリーはviewOnly(公開URL閲覧)でも表示される");
  {
    const publicDoc = {
      ownerUid: "someone-else",
      title: "他人の旅",
      updatedAt: 5000,
      schema: 2,
      data: JSON.stringify(
        tripWithDay(todayStr(), [
          baseItem("v1", "項目1", { dur: 60, actualStart: "09:15" }),
          baseItem("v2", "項目2", { dur: 30 })
        ])
      )
    };
    const env = boot({ hash: "#p=PUB1", docs: { PUB1: publicDoc } });
    await tick();
    await tick();
    ok(env.doc.body.classList.contains("view-only-mode"), "view-only-modeが付く");
    ok(!!env.doc.querySelector("#timeline .day-actual-summary"), "viewOnlyでも日サマリーが表示される");
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
