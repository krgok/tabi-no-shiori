/**
 * 2026-10 監査（docs/audit-2026-10.md）のうち、正しさ・アクセシビリティの修正の回帰テスト。
 * 1. 座標の取り込み（geo:0,0?q=…・+符号・検索結果URLなど）
 * 2. 暦に無い日付の拒否と日付の連番
 * 3. 時差の基準日が端末のタイムゾーンに依存しない
 * 4. CSV: 日の区切りの空行で行程の後半を捨てない
 * 5. モーダルのアクセシビリティ（role/aria-modal・Esc・フォーカスの移動と復帰・Tab循環）
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
  section("1. 座標の取り込み");
  {
    const env = boot({});
    const pb = env.win.parseBareCoords;
    const ex = env.win.extractGmapCoords;
    const cases = [
      ["+35.68,+139.76", { lat: 35.68, lon: 139.76 }],
      ["geo:0,0?q=35.68,139.76(Tokyo)", { lat: 35.68, lon: 139.76 }],
      ["geo:0,0?q=35.68%2C139.76", { lat: 35.68, lon: 139.76 }],
      ["geo:0,0?q=Tokyo+Station", null],
      ["geo:0,0", { lat: 0, lon: 0 }],
      ["geo:35.68,139.76?z=15", { lat: 35.68, lon: 139.76 }],
      ["geo:35.68,139.76;u=35", { lat: 35.68, lon: 139.76 }],
      ["90,180", { lat: 90, lon: 180 }],
      ["-90,-180", { lat: -90, lon: -180 }],
      ["90.0001,0", null],
      ["0,180.5", null],
      ["139.76, 35.68", null],
      ["35.68", null],
      ["https://www.google.com/maps?q=35.68,139.76", null]
    ];
    cases.forEach(([input, want]) => ok(same(pb(input), want), "parseBareCoords(" + JSON.stringify(input) + ")", pb(input)));

    const urls = [
      ["https://www.google.com/maps/search/35.68,+139.76", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps/place/35.68,139.76", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps?ll=35.68,139.76&z=10", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps/@35.68,139.76,3a,75y,90t/data=!3m1!1e1", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps/@35.68,139.76,500m/data=!3m1!1e3", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps/@35.68,139.76,17z", { lat: 35.68, lon: 139.76 }],
      ["https://www.google.com/maps/place/x/@1,2,17z/data=!3d35.70!4d139.80", { lat: 35.7, lon: 139.8 }],
      ["https://www.google.com/maps/search/95,+200", null],
      ["https://maps.app.goo.gl/abc", null],
      ["https://www.google.com/maps?q=%E6%9D%B1%E4%BA%AC%E9%A7%85", null]
    ];
    urls.forEach(([input, want]) => ok(same(ex(input), want), "extractGmapCoords(" + input.slice(0, 60) + ")", ex(input)));
  }

  /* ================================================================ */
  section("2. 暦に無い日付の拒否と日付の連番");
  {
    const env = boot({});
    const nd = env.win.normalizeDateStr;
    const add = env.win.addOneDayToDateStr;
    ok(nd("2026/7/24") === "2026-07-24", "スラッシュ・1桁の月日は正規化される");
    ok(nd("2026-02-29") === "2026-02-29" && add("2026-02-29") === "", "2026年2月29日（平年）は暦に無いので連番の起点にならない");
    ok(add("2028-02-28") === "2028-02-29" && add("2028-02-29") === "2028-03-01", "うるう年2028年の2/29は有効");
    ok(add("2026-12-31") === "2027-01-01", "年またぎ");
    ok(add("2026-04-31") === "" && add("2026-13-01") === "" && add("2026-00-10") === "", "4/31・13月・0月は連番にしない");
    ok(nd("2026-04-31") === "2026-04-31", "不正な日付も黙って消さない（元の文字列のまま保つ）");
  }

  /* ================================================================ */
  section("3. 時差の基準日が端末のタイムゾーンに依存しない");
  {
    const day = (date, tz, arrive) => ({
      date: date,
      startTime: "10:00",
      tz: tz,
      items: [{ id: "a", cat: "move", dur: 600, arriveTz: arrive }, { id: "b", cat: "sight", dur: 60 }]
    });
    const results5 = {};
    const originalTz = process.env.TZ;
    for (const deviceTz of ["Asia/Tokyo", "Pacific/Honolulu", "UTC"]) {
      process.env.TZ = deviceTz;
      const env = boot({});
      const r = env.win.eval(
        "(" +
          function (d1, d2) {
            return [d1, d2].map(function (d) {
              return getDayTimedItems(d).map(function (x) {
                return [x.startMin, x.endMin, x.moveTzDiff];
              });
            });
          }.toString() +
          ")"
      )(day("2026-10-25", "Europe/London", "Asia/Tokyo"), day("2026-03-08", "America/New_York", "Asia/Tokyo"));
      results5[deviceTz] = JSON.stringify(r);
    }
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    ok(
      results5["Asia/Tokyo"] === results5["Pacific/Honolulu"] && results5["Asia/Tokyo"] === results5["UTC"],
      "DST切替日（ロンドン10/25・NY3/8）の時差が、端末が東京でもホノルルでもUTCでも同じ",
      results5
    );
    ok(JSON.parse(results5["UTC"])[0][0][2] === 540, "ロンドン(GMT)→東京の時差は+9時間（DST終了後のロンドン）", results5["UTC"]);
  }

  /* ================================================================ */
  section("4. CSV: 日の区切りの空行");
  {
    const env2 = boot({});
    await tick();
    // 日の区切りに空行を入れて編集された行程CSV（Excelで見やすくした場合）は、後半を捨てない
    const header = "day,date,start,category,mode,name,minutes,note,gmap\r\n";
    const text =
      header +
      "1,2026-07-24,09:00,観光,,A,60,,\r\n" +
      ",,,,,,,,\r\n" +
      "2,2026-07-25,09:00,観光,,B,60,,\r\n" +
      "\r\n" +
      "\r\n" +
      "3,2026-07-26,09:00,食事,,C,30,,\r\n" +
      "\r\n" +
      "list,text,done\r\n" +
      "持ち物,パスポート,0\r\n";
    const r = env2.win.parseTripCsv(text);
    ok(r.trip.days.length === 3 && r.trip.days.map((d) => d.items[0].name).join() === "A,B,C", "行程の途中の空行（連続も）で後半が消えない", r.trip.days.length);
    ok(r.warnings.length === 0, "空行は警告にならない", r.warnings);
    ok(r.trip.packing.length === 1 && r.trip.packing[0].text === "パスポート", "最後の空行＋list,text,done 以降は従来どおり持ち物リストになる");
    const old = env2.win.parseTripCsv(header + "1,2026-07-24,09:00,観光,,A,60,,\r\n\r\n2,2026-07-25,09:00,観光,,B,60,,\r\n");
    ok(old.trip.days.length === 2, "リストの無い旧CSVで空行の後も読み込まれる");
  }

  /* ================================================================ */
  section("5. モーダルのアクセシビリティ");
  {
    const env = boot({});
    await tick();
    const { doc, win } = env;
    const key = (k, extra) => doc.dispatchEvent(new win.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
    const btn = doc.getElementById("settingsBtn");
    btn.focus();
    win.openModal(doc.getElementById("settingsModal"));
    const box = doc.querySelector("#settingsModal .modal");
    ok(box.getAttribute("role") === "dialog" && box.getAttribute("aria-modal") === "true", "開くと role=dialog / aria-modal=true が付く");
    ok(doc.activeElement === box, "開くとダイアログ自体にフォーカスが移る");

    const items = Array.prototype.filter.call(box.querySelectorAll("button, input, select, textarea, a[href]"), (n) => !n.closest(".hidden"));
    items[items.length - 1].focus();
    key("Tab");
    ok(doc.activeElement === items[0], "最後の部品で Tab すると先頭へ循環する（背後の画面へ抜けない）");
    key("Tab", { shiftKey: true });
    ok(doc.activeElement === items[items.length - 1], "先頭で Shift+Tab すると最後へ循環する");

    key("Escape");
    ok(doc.getElementById("settingsModal").classList.contains("hidden"), "Esc でモーダルが閉じる");
    ok(doc.activeElement === btn, "閉じると開く前にフォーカスしていたボタンへ戻る");
    key("Escape");
    ok(true, "モーダルが無いときの Esc は何も起こさない（例外なし）");

    let called = false;
    win.showConfirm("確認", "本当に?", () => (called = true));
    ok(doc.activeElement === doc.querySelector("#confirmModal .modal"), "確認モーダルでもフォーカスが移る");
    key("Escape");
    ok(doc.getElementById("confirmModal").classList.contains("hidden"), "Esc で確認モーダルが閉じる");
    doc.getElementById("confirmOkBtn").click();
    ok(called === false, "Esc で閉じた確認のコールバックは実行されない（背景クリックと同じ）");

    // 入れ子: 設定モーダルの上に確認モーダル → Esc は最前面（確認）だけ閉じる
    win.openModal(doc.getElementById("settingsModal"));
    win.showConfirm("確認", "", () => {});
    key("Escape");
    ok(doc.getElementById("confirmModal").classList.contains("hidden") && !doc.getElementById("settingsModal").classList.contains("hidden"), "重なったモーダルは最前面だけ Esc で閉じる");
    key("Escape");
    ok(doc.getElementById("settingsModal").classList.contains("hidden"), "もう一度 Esc で下のモーダルも閉じる");
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
