/**
 * 新機能・修正検証:
 * 1. 行程カードの別日コピー機能 (copyItemToDay, duplicateItem, copyModal)
 * 2. ルート検討 (runRouteCalculation) 実行時の fixedStart 保護
 */
const { boot, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function sightItem(id, name, extra) {
  return Object.assign({
    id: id, cat: "sight", name: name, loc: "", dur: 30, note: "", lat: 35.68, lon: 139.76,
    coordSrc: "geo", priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false,
    names: {}, noteNames: {}
  }, extra || {});
}

function moveItem(id, name, extra) {
  return Object.assign({
    id: id, cat: "move", name: name, loc: "", dur: 20, note: "", mode: "train",
    distKm: 5, auto: true, arriveTz: "", priv: false, notePriv: false, fixedStart: null,
    names: {}, noteNames: {}
  }, extra || {});
}

function dayWith(date, items) {
  return { date: date, startTime: "09:00", tz: "", priv: false, dateManual: true, items: items };
}

function tripData(days) {
  return {
    v: 1, title: "テスト旅行", titles: { ja: "テスト旅行" }, lang: "ja",
    packing: [], todos: [], packingPriv: false, todosPriv: false, days: days
  };
}

function storeWith(entries) {
  return { [STORAGE_KEY]: JSON.stringify({ currentId: entries[0].id, trips: entries }) };
}

function entry(id, data) {
  return { id: id, data: data, archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null };
}

(async () => {
  /* ================================================================ */
  section("1. 行程の別日コピー機能 (copyItemToDay)");
  {
    const trip = tripData([
      dayWith("2026-07-20", [sightItem("item-1", "東京タワー"), sightItem("item-2", "浅草寺")]),
      dayWith("2026-07-21", [sightItem("item-3", "金閣寺")])
    ]);
    const { win } = await boot({ localStorage: storeWith([entry("t1", trip)]) });

    ok(win.trip.days[0].items.length === 2, "Day 1 は初期状態 2 件");
    ok(win.trip.days[1].items.length === 1, "Day 2 は初期状態 1 件");

    // item-1 を Day 2 (インデックス 1) へコピー
    win.copyItemToDay("item-1", 1);

    ok(win.trip.days[1].items.length === 2, "Day 2 にアイテムがコピーされて 2 件になる");
    const copiedItem = win.trip.days[1].items[1];
    ok(copiedItem.name === "東京タワー", "コピーされたアイテムの名前が一致");
    ok(copiedItem.id !== "item-1", "コピーされたアイテムに新規IDが割り当てられている");
    ok(win.trip.days[0].items.length === 2, "元の Day 1 のアイテムは影響を受けない");
  }

  /* ================================================================ */
  section("2. 複数日構成での duplicateItem によるモーダル表示とコピー");
  {
    const trip = tripData([
      dayWith("2026-07-20", [sightItem("item-1", "スカイツリー")]),
      dayWith("2026-07-21", [sightItem("item-2", "清水寺")])
    ]);
    const { win, doc } = await boot({ localStorage: storeWith([entry("t2", trip)]) });

    const copyModal = doc.getElementById("copyModal");
    ok(copyModal && copyModal.classList.contains("hidden"), "初期状態では copyModal は非表示");

    // duplicateItem 実行で copyModal が開く
    win.duplicateItem("item-1");
    ok(!copyModal.classList.contains("hidden"), "複数日ある場合 duplicateItem で copyModal が開く");

    const copyBody = doc.getElementById("copyModalBody");
    const buttons = copyBody.querySelectorAll("button");
    ok(buttons.length === 2, "コピー先選択ボタンが Day 1, Day 2 の2つ表示される");

    // Day 2 ボタンをクリック
    buttons[1].click();
    ok(copyModal.classList.contains("hidden"), "選択後にモーダルが閉じる");
    ok(win.trip.days[1].items.length === 2, "Day 2 にスカイツリーがコピーされる");
    ok(win.trip.days[1].items[1].name === "スカイツリー", "コピーされたアイテム名が正しい");
  }

  /* ================================================================ */
  section("3. ルート検討 (runRouteCalculation) 実行時の fixedStart 保護");
  {
    // Day 1 に Spot 1, fixedStart 付き Move, fixedStart 付き Spot 2 を用意
    const trip = tripData([
      dayWith("2026-07-20", [
        sightItem("item-a", "上野公園"),
        moveItem("move-fixed", "上野公園 → 秋葉原", { auto: true, fixedStart: "11:30" }),
        sightItem("item-b", "秋葉原", { fixedStart: "12:00" })
      ])
    ]);
    const { win } = await boot({ localStorage: storeWith([entry("t3", trip)]) });

    // ルート検討を実行
    win.runRouteCalculation(0);

    const dayItems = win.trip.days[0].items;
    const fixedMove = dayItems.find(it => it.id === "move-fixed");
    ok(!!fixedMove, "fixedStart を持つ auto move アイテムは削除されずに保護される");

    const fixedSpot = dayItems.find(it => it.id === "item-b");
    ok(fixedSpot && fixedSpot.fixedStart === "12:00", "Spot B の fixedStart (12:00) が維持される");
  }

  results("test-copy-fixedstart.js");
})();
