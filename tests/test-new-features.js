/**
 * 新機能検証ハーネス
 * 1) 日付の自動連番（day.dateManual / recalcAutoDates）
 * 2) 持ち物・やることリストの並べ替え（Pointer Events ドラッグ）
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する。
 * harness.js（boot/tick/ok/section）を再利用する。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function blankDay(date, dateManual) {
  return {
    date: date || "",
    startTime: "09:00",
    tz: "",
    priv: false,
    dateManual: !!dateManual,
    items: []
  };
}

function fixtureTripDays(days) {
  return {
    v: 1,
    title: "日付テスト",
    titles: { ja: "日付テスト" },
    lang: "ja",
    days: days,
    packing: [],
    todos: []
  };
}

function fixtureChecklistTrip(packing, todos) {
  return {
    v: 1,
    title: "並べ替えテスト",
    titles: { ja: "並べ替えテスト" },
    lang: "ja",
    days: [{ date: "2026-08-01", startTime: "09:00", tz: "", priv: false, dateManual: false, items: [] }],
    packing: packing || [],
    todos: todos || []
  };
}

function fixtureStore(trip) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: trip, archived: false, cloudId: null, updatedAt: 1000, publicId: null }]
    })
  };
}

function setDayDate(env, value) {
  const input = env.doc.getElementById("dayDateInput");
  input.value = value;
  input.dispatchEvent(new env.win.Event("change", { bubbles: true }));
}

function clickTab(env, idx) {
  const tab = env.doc.querySelector('.day-tab[data-index="' + idx + '"]');
  tab.dispatchEvent(new env.win.MouseEvent("click", { bubbles: true }));
}

function currentTripDays(env) {
  const raw = JSON.parse(env.store[STORAGE_KEY]);
  return raw.trips[0].data.days;
}

// 持ち物・やることリストのドラッグ並べ替え用ヘルパー: getBoundingClientRect を
// DOM順に応じた等間隔の矩形にモックする（jsdomはレイアウトエンジンを持たないため）
function mockRowRects(container, rowHeight) {
  const rows = Array.prototype.slice.call(container.querySelectorAll(".checklist-item"));
  rows.forEach((row, idx) => {
    row.getBoundingClientRect = () => ({
      top: idx * rowHeight,
      bottom: idx * rowHeight + rowHeight,
      height: rowHeight,
      left: 0,
      right: 200,
      width: 200
    });
  });
  return rows;
}

function dragRow(env, container, fromId, clientYAtDrop, rowHeight) {
  rowHeight = rowHeight || 40;
  const rows = mockRowRects(container, rowHeight);
  const row = rows.find((r) => r.dataset.id === fromId);
  const handle = row.querySelector(".checklist-drag-handle");
  const rect = row.getBoundingClientRect();
  const startY = rect.top + rect.height / 2;

  const down = new env.win.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 10, clientY: startY, pointerId: 7 });
  handle.dispatchEvent(down);

  const move = new env.win.PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: 10, clientY: clientYAtDrop, pointerId: 7 });
  handle.dispatchEvent(move);

  const up = new env.win.PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 10, clientY: clientYAtDrop, pointerId: 7 });
  handle.dispatchEvent(up);
}

function checklistTexts(container) {
  return Array.prototype.map.call(container.querySelectorAll(".checklist-item .checklist-text-input"), (i) => i.value);
}

(async () => {
  /* ================================================================ */
  section("1. 日付の自動連番: Day1入力でDay2/3が連番になる");
  {
    const trip = fixtureTripDays([blankDay("", false), blankDay("", false), blankDay("", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);

    setDayDate(env, "2026-07-20");
    await tick();
    let days = currentTripDays(env);
    ok(days[0].date === "2026-07-20", "Day1の日付が保存される", days[0].date);
    ok(days[1].date === "2026-07-21", "Day2が翌日になる", days[1].date);
    ok(days[2].date === "2026-07-22", "Day3が翌々日になる", days[2].date);
    ok(days[1].dateManual === false, "Day2はdateManual=false", days[1].dateManual);
    ok(days[2].dateManual === false, "Day3はdateManual=false", days[2].dateManual);

    // 自動バッジがDay2に表示される
    clickTab(env, 1);
    await tick();
    const badge = env.doc.getElementById("dayDateAutoBadge");
    ok(!badge.classList.contains("hidden"), "Day2の自動バッジが表示される");
  }

  /* ================================================================ */
  section("2. Day3を手動変更 → Day4がDay3の翌日になる。Day3を空に→自動へ戻る");
  {
    const trip = fixtureTripDays([blankDay("2026-07-20", false), blankDay("2026-07-21", false), blankDay("2026-07-22", false), blankDay("2026-07-23", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    clickTab(env, 2); // Day3 (index2)
    await tick();
    setDayDate(env, "2026-08-15");
    await tick();
    let days = currentTripDays(env);
    ok(days[2].date === "2026-08-15", "Day3が手動値になる", days[2].date);
    ok(days[2].dateManual === true, "Day3はdateManual=true", days[2].dateManual);
    ok(days[3].date === "2026-08-16", "Day4はDay3の翌日になる", days[3].date);
    ok(days[3].dateManual === false, "Day4はdateManual=falseのまま", days[3].dateManual);

    // 自動バッジがDay3では出ない（手動固定のため）
    const badge = env.doc.getElementById("dayDateAutoBadge");
    ok(badge.classList.contains("hidden"), "Day3(手動)では自動バッジが出ない");

    // Day3を空にする -> 自動へ戻る
    setDayDate(env, "");
    await tick();
    days = currentTripDays(env);
    ok(days[2].dateManual === false, "Day3を空にするとdateManual=falseに戻る", days[2].dateManual);
    ok(days[2].date === "2026-07-22", "Day3の日付がDay2(2026-07-21)基準の自動値に戻る", days[2].date);
    ok(days[3].date === "2026-07-23", "Day4も連動して再計算される", days[3].date);
  }

  /* ================================================================ */
  section("3. Day1を変更 → 手動の日は維持され自動の日だけ再計算");
  {
    const trip = fixtureTripDays([blankDay("2026-01-01", false), blankDay("2026-01-02", false), blankDay("2099-12-31", true), blankDay("2026-01-04", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    setDayDate(env, "2026-03-10");
    await tick();
    const days = currentTripDays(env);
    ok(days[0].date === "2026-03-10", "Day1が更新される", days[0].date);
    ok(days[1].date === "2026-03-11", "Day2(自動)は再計算される", days[1].date);
    ok(days[2].date === "2099-12-31", "Day3(手動)は維持される", days[2].date);
    ok(days[3].date === "2100-01-01", "Day4(自動)はDay3(手動)基準で再計算される", days[3].date);
  }

  /* ================================================================ */
  section("4. Day1が空なら以降も空のまま");
  {
    const trip = fixtureTripDays([blankDay("", false), blankDay("", false), blankDay("", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    // 何も入力せず日を追加してみる
    env.doc.getElementById("addDayBtn").click();
    await tick();
    const days = currentTripDays(env);
    ok(days.every((d) => d.date === ""), "Day1が空なら全日が空のまま", days.map((d) => d.date));
  }

  /* ================================================================ */
  section("5. 月跨ぎ・年跨ぎ・うるう年");
  {
    const trip = fixtureTripDays([blankDay("2026-01-31", false), blankDay("", false), blankDay("2026-12-31", true), blankDay("", false), blankDay("2028-02-28", true), blankDay("", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    // dateManual=trueの日は日付が既に確定しているのでrecalcは走らないが、直後の自動日を検証するため
    // Day1(index0)を再セットしてrecalcAutoDatesを起動する
    setDayDate(env, "2026-01-31");
    await tick();
    const days = currentTripDays(env);
    ok(days[1].date === "2026-02-01", "月跨ぎ: 1/31 + 1日 = 2/1", days[1].date);
    ok(days[3].date === "2027-01-01", "年跨ぎ: 12/31 + 1日 = 翌年1/1", days[3].date);
    ok(days[5].date === "2028-02-29", "うるう年: 2028-02-28 + 1日 = 2028-02-29", days[5].date);
  }

  /* ================================================================ */
  section("6. 日の追加・削除で正しく再計算される");
  {
    const trip = fixtureTripDays([blankDay("2026-05-01", false), blankDay("2026-05-02", false), blankDay("2026-05-03", false)]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    // Day2を削除 -> 旧Day3が新index1になり、Day1の翌日に再計算される
    clickTab(env, 1);
    await tick();
    const closeBtn = env.doc.querySelector('.day-tab-close[data-index="1"]');
    closeBtn.dispatchEvent(new env.win.MouseEvent("click", { bubbles: true }));
    await tick();
    env.doc.getElementById("confirmOkBtn").click();
    await tick();
    let days = currentTripDays(env);
    ok(days.length === 2, "1日削除されて2日になる", days.length);
    ok(days[1].date === "2026-05-02", "削除後、新しいDay2はDay1の翌日に再計算される", days[1].date);

    // 日を追加 -> 新しい最終日はその前日の翌日になる
    env.doc.getElementById("addDayBtn").click();
    await tick();
    days = currentTripDays(env);
    ok(days.length === 3, "追加されて3日になる", days.length);
    ok(days[2].date === "2026-05-03", "追加された日は直前日の翌日で自動的に埋まる", days[2].date);
  }

  /* ================================================================ */
  section("7. 4言語: day.dateAutoBadge が定義されている");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTripDays([blankDay("2026-01-01", false)])) });
    await tick();
    ["ja", "en", "zh", "th"].forEach((L) => {
      const s = env.win.I18N.t(L, "day.dateAutoBadge");
      ok(typeof s === "string" && s.length > 0 && s !== "day.dateAutoBadge", L + ": day.dateAutoBadge が翻訳済み", s);
    });
  }

  /* ================================================================ */
  section("8. CSV往復で日付が保たれる（再計算で上書きされない）");
  {
    const trip = fixtureTripDays([blankDay("2026-09-01", false), blankDay("2026-09-05", true), blankDay("2026-09-06", false)]);
    trip.days.forEach((d, i) => {
      d.items.push({ id: "x" + i, cat: "sight", name: "テスト地点" + i, loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} });
    });
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    env.doc.getElementById("textioBtn").click();
    await tick();
    const csv = env.doc.getElementById("textioArea").value;
    ok(csv.includes("2026-09-01") && csv.includes("2026-09-05") && csv.includes("2026-09-06"), "CSV出力に3日分の日付が含まれる");

    // そのまま読み込み直す（往復）
    env.doc.getElementById("textioLoadBtn").click();
    env.doc.getElementById("confirmOkBtn").click();
    await tick();
    const days = currentTripDays(env);
    ok(days[0].date === "2026-09-01", "CSV往復後もDay1日付が保たれる", days[0].date);
    ok(days[1].date === "2026-09-05", "CSV往復後もDay2日付が保たれる（recalcで上書きされない）", days[1].date);
    ok(days[2].date === "2026-09-06", "CSV往復後もDay3日付が保たれる", days[2].date);
  }

  /* ================================================================ */
  section("9. 持ち物リストの並べ替え: main で動作し、trip.packingの順序が変わる");
  {
    const trip = fixtureChecklistTrip(
      [
        { id: "p1", text: "パスポート", done: false, priv: false },
        { id: "p2", text: "充電器", done: false, priv: false },
        { id: "p3", text: "着替え", done: false, priv: false }
      ],
      []
    );
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    const container = env.doc.getElementById("packingItems");
    ok(checklistTexts(container).join(",") === "パスポート,充電器,着替え", "初期順序");

    // p1(先頭)をp3(末尾)の後ろへドラッグ
    dragRow(env, container, "p1", 999 /* コンテナ末尾より下 */);
    await tick();

    const days = JSON.parse(env.store[STORAGE_KEY]).trips[0].data.packing;
    ok(days.map((it) => it.id).join(",") === "p2,p3,p1", "trip.packingの順序がp2,p3,p1になる", days.map((it) => it.id));

    const containerAfter = env.doc.getElementById("packingItems");
    ok(checklistTexts(containerAfter).join(",") === "充電器,着替え,パスポート", "main再描画後の表示順序も一致");
  }

  /* ================================================================ */
  section("10. 並べ替え後、main と prepModal が同期する");
  {
    const trip = fixtureChecklistTrip(
      [],
      [
        { id: "t1", text: "Wi-Fi予約", done: false, priv: false },
        { id: "t2", text: "両替", done: false, priv: false },
        { id: "t3", text: "保険加入", done: false, priv: false }
      ]
    );
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    // 準備モーダルを開いておく
    env.doc.getElementById("prepBtn").click();
    await tick();

    const mainContainer = env.doc.getElementById("todosItems");
    dragRow(env, mainContainer, "t3", -50 /* 先頭より上へ */);
    await tick();

    const prepContainer = env.doc.getElementById("prepTodosItems");
    ok(checklistTexts(mainContainer).join(",") === "保険加入,Wi-Fi予約,両替", "mainの表示順序が更新される");
    ok(checklistTexts(prepContainer).join(",") === "保険加入,Wi-Fi予約,両替", "prepModalの表示順序も同期する");
  }

  /* ================================================================ */
  section("11. 並べ替え後、保存・リロードでも順序が維持される");
  {
    const trip = fixtureChecklistTrip(
      [
        { id: "p1", text: "A", done: false, priv: false },
        { id: "p2", text: "B", done: false, priv: false },
        { id: "p3", text: "C", done: false, priv: false }
      ],
      []
    );
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    const container = env.doc.getElementById("packingItems");
    dragRow(env, container, "p2", -50);
    await tick();

    // 保存されたlocalStorageから「リロード」相当で再bootする
    const env2 = boot({ localStorage: { [STORAGE_KEY]: env.store[STORAGE_KEY] } });
    await tick();
    ok(checklistTexts(env2.doc.getElementById("packingItems")).join(",") === "B,A,C", "リロード後も並べ替え後の順序が維持される");
  }

  /* ================================================================ */
  section("12. viewOnlyモードではドラッグハンドルが機能しない");
  {
    // 通常のtrip（非公開データ無し）を持ち物リスト付きで用意し、公開URL(#p=)経由のviewOnlyを模倣する
    const trip = fixtureChecklistTrip(
      [
        { id: "p1", text: "A", done: false, priv: false },
        { id: "p2", text: "B", done: false, priv: false }
      ],
      []
    );
    const docs = { PUBv1: { ownerUid: "u1", data: JSON.stringify(trip), title: "並べ替えテスト", updatedAt: 1, schema: 2 } };
    const env = boot({ hash: "#p=PUBv1", docs });
    await tick();
    await tick();

    const container = env.doc.getElementById("packingItems");
    ok(container, "viewOnlyでも持ち物リストのコンテナは存在する");
    ok(env.doc.body.classList.contains("view-only-mode"), "view-only-modeで起動している");
    const handle = container.querySelector(".checklist-drag-handle");
    // CSSでは非表示になるが、jsdomはレイアウト適用しないのでDOM自体はある。JS側ガード(viewOnly)が効くか検証する
    if (handle) {
      dragRow(env, container, "p1", 999);
      await tick();
      ok(env.store[STORAGE_KEY] === undefined, "viewOnly中はsaveStateされずlocalStorageに書き込まれない", env.store[STORAGE_KEY]);
    } else {
      ok(true, "ハンドルが描画されない（それ自体もOK）");
    }
  }

  /* ================================================================ */
  section("13. やることリストの並べ替えでもCSV順序が保たれる");
  {
    const trip = fixtureChecklistTrip([], [
      { id: "t1", text: "1番目", done: false, priv: false },
      { id: "t2", text: "2番目", done: false, priv: false },
      { id: "t3", text: "3番目", done: false, priv: false }
    ]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    const container = env.doc.getElementById("todosItems");
    dragRow(env, container, "t1", 999);
    await tick();

    env.doc.getElementById("textioBtn").click();
    await tick();
    const csv = env.doc.getElementById("textioArea").value;
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const listLines = lines.filter((l) => l.includes("2番目") || l.includes("3番目") || l.includes("1番目"));
    ok(listLines.length === 3, "CSVに3行出力される", listLines);
    ok(listLines[0].includes("2番目") && listLines[1].includes("3番目") && listLines[2].includes("1番目"), "CSV出力順が並べ替え後の順序と一致する", listLines);
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exitCode = r.fail > 0 ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
