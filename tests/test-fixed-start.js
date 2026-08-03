/**
 * 開始時刻の手動固定（17）検証ハーネス
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する。
 * 前回セッションで作った harness.js（boot/tick/ok/section）を再利用する。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

// 所要時間が読み取りやすい単純なフィクスチャ（tz無し・auto move無し）
function fixtureTrip() {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [
      {
        date: "2026-08-01",
        startTime: "09:00",
        tz: "",
        items: [
          { id: "a1", cat: "sight", name: "スポットA", loc: "", dur: 60, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} },
          { id: "a2", cat: "sight", name: "スポットB", loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} },
          { id: "a3", cat: "meal", name: "ランチ", loc: "", dur: 45, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} }
        ]
      }
    ],
    packing: [],
    todos: []
  };
}

// 時差あり（tz + arriveTzのmove）+ 長い滞在で日跨ぎするフィクスチャ
function fixtureTz() {
  return {
    v: 1,
    title: "時差テスト",
    titles: { ja: "時差テスト" },
    lang: "ja",
    days: [
      {
        date: "2026-08-01",
        startTime: "22:00",
        tz: "Asia/Tokyo",
        items: [
          // 22:00開始、90分滞在 -> 23:30終了（まだ日本時間、日またぎ前）
          { id: "s1", cat: "sight", name: "出発前", loc: "", dur: 90, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} },
          // フライト。arriveTzでハワイ (UTC-10, 日本比-19h) へ飛ぶ。23:30発、dur=480(8h)=翌07:30(日本時間基準)着だが
          // 到着地オフセット分ずれる
          { id: "m1", cat: "move", name: "移動", loc: "", dur: 480, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, mode: "plane", distKm: null, auto: false, arriveTz: "Pacific/Honolulu" },
          // 到着後の項目（現地時間表示）。ここに固定時刻を設定するテストで使う
          { id: "s2", cat: "sight", name: "到着後観光", loc: "", dur: 60, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} }
        ]
      }
    ],
    packing: [],
    todos: []
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

function timeTexts(env) {
  return Array.prototype.map.call(env.doc.querySelectorAll("#timeline .item-time-row"), (row) => row.textContent.trim());
}

// CSV読み込みボタンは showConfirm() で確認ダイアログを挟む実装のため、OKボタンまでクリックする
function clickLoadCsvAndConfirm(env) {
  env.doc.getElementById("textioLoadBtn").click();
  env.doc.getElementById("confirmOkBtn").click();
}

(async () => {
  /* ================================================================ */
  section("1. 回帰: 固定なしのときは従来通りの時刻計算");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    const cards = env.doc.querySelectorAll("#timeline .item-card");
    ok(cards.length === 3, "3件描画される", cards.length);
    const texts = timeTexts(env);
    ok(texts[0] === "09:00〜10:00", "1件目: 09:00〜10:00", texts[0]);
    ok(texts[1] === "10:00〜10:30", "2件目: 10:00〜10:30", texts[1]);
    ok(texts[2] === "10:30〜11:15", "3件目: 10:30〜11:15", texts[2]);
    ok(env.doc.querySelectorAll(".item-conflict-msg").length === 0, "conflict警告が無い");
    ok(env.doc.querySelectorAll(".item-start-time-btn.is-fixed").length === 0, "固定バッジが無い");
  }

  /* ================================================================ */
  section("2. 開始時刻をクリック→固定→以降が再計算される");
  let fixedEnv;
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    // 2件目（スポットB, id=a2）の開始時刻ボタンをクリックして編集モードに入る
    const cards = env.doc.querySelectorAll("#timeline .item-card");
    const card2 = cards[1];
    ok(card2.dataset.id === "a2", "2件目のカードがa2", card2.dataset.id);
    const startBtn = card2.querySelector(".item-start-time-btn");
    ok(!!startBtn, "開始時刻ボタンが存在する");
    ok(startBtn.textContent === "10:00", "クリック前は通常表示 10:00", startBtn.textContent);
    startBtn.click();
    await tick();

    const input = env.doc.querySelector("#timeline .item-card[data-id='a2'] .item-fixed-start-input");
    ok(!!input, "クリックでinput[type=time]が現れる");
    ok(input.value === "10:00", "現在の計算値がプリセットされる", input.value);

    // 13:00に固定する
    input.value = "13:00";
    input.dispatchEvent(new env.win.Event("change"));
    await tick();

    const card2b = env.doc.querySelector("#timeline .item-card[data-id='a2']");
    const startBtn2 = card2b.querySelector(".item-start-time-btn");
    ok(startBtn2.textContent === "📌 13:00", "固定後は📌付きで13:00表示", startBtn2.textContent);
    ok(startBtn2.classList.contains("is-fixed"), "is-fixedクラスが付く");

    const texts = timeTexts(env);
    ok(texts[0] === "09:00〜10:00", "1件目は変わらず 09:00〜10:00", texts[0]);
    ok(texts[1] === "📌 13:00✕〜13:30", "2件目は13:00起点で13:30終了", texts[1]);
    ok(texts[2] === "13:30〜14:15", "3件目は2件目の終了(13:30)から再計算される", texts[2]);
    ok(env.doc.querySelectorAll(".item-conflict-msg").length === 0, "13:00は10:00より後ろなのでconflictなし");

    // localStorageに保存されている
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const savedItem = saved.trips[0].data.days[0].items.find((i) => i.id === "a2");
    ok(savedItem.fixedStart === "13:00", "fixedStartが保存される", savedItem.fixedStart);

    fixedEnv = env;
  }

  /* ================================================================ */
  section("3. 固定時刻が前の項目より前 → conflict警告");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    const card2 = env.doc.querySelectorAll("#timeline .item-card")[1];
    card2.querySelector(".item-start-time-btn").click();
    await tick();
    const input = env.doc.querySelector("#timeline .item-card[data-id='a2'] .item-fixed-start-input");
    input.value = "08:00"; // 1件目の終了(10:00)より前
    input.dispatchEvent(new env.win.Event("change"));
    await tick();

    const texts = timeTexts(env);
    ok(texts[1] === "📌 08:00✕〜08:30", "固定時刻通りに08:00〜08:30になる（前めり込みでも時刻自体は尊重）", texts[1]);
    const card2b = env.doc.querySelector("#timeline .item-card[data-id='a2']");
    const conflictMsg = card2b.querySelector(".item-conflict-msg");
    ok(!!conflictMsg, "conflict警告が表示される");
    ok(conflictMsg.textContent === "⚠ 前の予定と重なっています", "警告文言が正しい", conflictMsg.textContent);
    // day.items との1:1対応が壊れていない
    ok(env.doc.querySelectorAll("#timeline .item-card").length === 3, "カード数は3のまま（1:1対応維持）");
  }

  /* ================================================================ */
  section("4. 固定解除で自動計算に戻る");
  {
    // fixedEnv はセクション2で a2 を13:00に固定済み
    const env = fixedEnv;
    const card2 = env.doc.querySelector("#timeline .item-card[data-id='a2']");
    const clearBtn = card2.querySelector(".item-fixed-clear-btn");
    ok(!!clearBtn, "✕（固定解除）ボタンが存在する");
    clearBtn.click();
    await tick();

    const texts = timeTexts(env);
    ok(texts[0] === "09:00〜10:00", "1件目 09:00〜10:00", texts[0]);
    ok(texts[1] === "10:00〜10:30", "2件目が自動計算(10:00〜10:30)に戻る", texts[1]);
    ok(texts[2] === "10:30〜11:15", "3件目も連鎖して戻る", texts[2]);
    ok(!env.doc.querySelector("#timeline .item-card[data-id='a2'] .item-start-time-btn").classList.contains("is-fixed"), "is-fixedが外れる");
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const savedItem = saved.trips[0].data.days[0].items.find((i) => i.id === "a2");
    ok(savedItem.fixedStart === null, "fixedStartがnullに戻って保存される", savedItem.fixedStart);
  }

  /* ================================================================ */
  section("5. 時差との組み合わせ: tz適用後の表示時刻として解釈される");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTz()) });
    await tick();
    // まずtz適用前の自動計算を確認する
    const texts0 = timeTexts(env);
    // s1: 22:00-23:30 (JST)
    ok(texts0[0] === "22:00〜23:30", "出発前 22:00〜23:30", texts0[0]);
    // m1: 23:30開始、dur480分=8h -> 素の終了は07:30(+1)。arriveTz Honolulu(UTC-10) - Tokyo(UTC+9) = -19h = -1140分
    // 07:30(+1) = 1890分 に -1140 => 750分 = 12:30（当日）
    const m1Row = env.doc.querySelector("#timeline .item-card[data-id='m1'] .item-time-row").textContent.trim();
    ok(m1Row === "23:30〜12:30", "移動: 23:30〜12:30(現地時間) に時差調整される", m1Row);
    const s2Row0 = env.doc.querySelector("#timeline .item-card[data-id='s2'] .item-time-row").textContent.trim();
    ok(s2Row0 === "12:30〜13:30", "到着後観光は12:30起点(現地時間)", s2Row0);

    // s2（到着後観光）に「14:00」を固定 → 現地表示時間としての14:00になるはず（cursor基準の同じ暦日に乗る）
    const s2Card = env.doc.querySelector("#timeline .item-card[data-id='s2']");
    s2Card.querySelector(".item-start-time-btn").click();
    await tick();
    const input = env.doc.querySelector("#timeline .item-card[data-id='s2'] .item-fixed-start-input");
    ok(input.value === "12:30", "編集時のプリセット値が現地時間ベースの12:30", input.value);
    input.value = "14:00";
    input.dispatchEvent(new env.win.Event("change"));
    await tick();
    const s2Row = env.doc.querySelector("#timeline .item-card[data-id='s2'] .item-time-row").textContent.trim();
    ok(s2Row === "📌 14:00✕〜15:00", "固定後は現地表示時間の14:00起点になる（tz二重適用なし）", s2Row);
    ok(env.doc.querySelectorAll(".item-conflict-msg").length === 0, "12:30より後ろの14:00なのでconflictなし");
  }

  /* ================================================================ */
  section("6. 日跨ぎ: cursorが1440超の位置での固定時刻");
  {
    // startTime 22:00、dur 90分で s1: 22:00-23:30。 s1のdurを1000分に伸ばすと日跨ぎする
    const trip = fixtureTrip();
    trip.days[0].startTime = "23:00";
    trip.days[0].items = [
      { id: "b1", cat: "sight", name: "夜のスポット", loc: "", dur: 180, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} },
      { id: "b2", cat: "sight", name: "翌日のスポット", loc: "", dur: 60, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {} }
    ];
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    // b1: 23:00-02:00(+1) => cursor after b1 = 1440+120=1560
    const b1Row = env.doc.querySelector("#timeline .item-card[data-id='b1'] .item-time-row").textContent.trim();
    ok(b1Row === "23:00〜02:00 (+1)", "夜のスポット 23:00〜02:00(+1)", b1Row);

    // b2に「09:00」を固定 → cursor(1560)は+1日目なので、固定09:00は floor(1560/1440)*1440+540 = 1440+540=1980 = 09:00(+1)
    const b2Card = env.doc.querySelector("#timeline .item-card[data-id='b2']");
    b2Card.querySelector(".item-start-time-btn").click();
    await tick();
    const input = env.doc.querySelector("#timeline .item-card[data-id='b2'] .item-fixed-start-input");
    ok(input.value === "02:00", "編集時プリセットは自動計算値の02:00", input.value);
    input.value = "09:00";
    input.dispatchEvent(new env.win.Event("change"));
    await tick();
    const b2Row = env.doc.querySelector("#timeline .item-card[data-id='b2'] .item-time-row").textContent.trim();
    ok(b2Row === "📌 09:00 (+1)✕〜10:00 (+1)", "固定時刻が正しい暦日(+1)に乗る", b2Row);
    ok(env.doc.querySelectorAll(".item-conflict-msg").length === 0, "02:00より後ろの09:00なのでconflictなし（同じ+1日内）");
  }

  /* ================================================================ */
  section("7. getDayTimedItems の day.items との1:1対応（行程番号・地図ピン）");
  {
    const trip = fixtureTz();
    // s2に固定時刻をつけたトリップで検証（move含む）
    trip.days[0].items[2].fixedStart = "14:00";
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    const cards = env.doc.querySelectorAll("#timeline .item-card");
    ok(cards.length === 3, "day.itemsと同数（moveも含め3件）のカードが描画される", cards.length);
    // 行程番号バッジ: s1=1, s2=2 (moveは番号なし)
    const numBadges = env.doc.querySelectorAll("#timeline .item-num-badge");
    ok(numBadges.length === 2, "move以外の2件に番号バッジ", numBadges.length);
    ok(numBadges[0].textContent === "1" && numBadges[1].textContent === "2", "番号が1,2と振られる（ズレなし）", [numBadges[0].textContent, numBadges[1].textContent]);
  }

  /* ================================================================ */
  section("8. CSV往復: fixedStartが復元される");
  {
    const trip = fixtureTrip();
    trip.days[0].items[1].fixedStart = "13:00";
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    env.doc.getElementById("textioBtn").click();
    const csv = env.doc.getElementById("textioArea").value;
    ok(csv.includes("fixedStart"), "CSVヘッダーにfixedStart列がある");
    ok(/,13:00,/.test(csv.split("\n")[2] || "") || csv.includes("13:00"), "CSV本文に13:00が出力されている", csv.split("\n").slice(0, 4));

    // 一旦別の値に書き換えて再インポートし、往復することを確認
    clickLoadCsvAndConfirm(env);
    await tick();
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const items = saved.trips[0].data.days[0].items;
    const a2 = items.find((i) => i.name === "スポットB");
    ok(a2 && a2.fixedStart === "13:00", "CSV再取込でfixedStartが復元される", a2 && a2.fixedStart);
  }

  /* ================================================================ */
  section("9. 旧CSV（fixedStart列なし）はエラーにならずnull扱い");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    const oldCsv =
      "day,date,start,category,mode,name,minutes,note,gmap\r\n" +
      '1,2026-08-01,09:00,観光,,旧スポット,30,,\r\n';
    env.doc.getElementById("textioBtn").click();
    env.doc.getElementById("textioArea").value = oldCsv;
    clickLoadCsvAndConfirm(env);
    await tick();
    ok(env.errors.length === 0, "旧CSV読込でコンソールエラーが出ない", env.errors);
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const items = saved.trips[0].data.days[0].items;
    ok(items.length === 1 && items[0].name === "旧スポット", "旧CSVが読み込める", items);
    ok(items[0].fixedStart === null, "fixedStart列が無い旧CSVはnull扱い", items[0].fixedStart);
  }

  /* ================================================================ */
  section("10. 共有リンク往復でfixedStartが保たれる");
  {
    const trip = fixtureTrip();
    trip.days[0].items[0].fixedStart = "08:30";
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    env.doc.getElementById("shareBtn").click();
    const url = env.doc.getElementById("shareUrl").value;
    ok(url.startsWith("https://example.org/tabi/#d="), "共有リンクが生成される", url);
    const b64 = decodeURIComponent(url.split("#d=")[1]).replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
    const d = JSON.parse(json);
    ok(d.days[0].items[0].fixedStart === "08:30", "共有リンクのデータにfixedStartが含まれる", d.days[0].items[0].fixedStart);
  }

  /* ================================================================ */
  section("11. viewOnly（公開URL閲覧）では編集不可");
  {
    const publicDoc = {
      ownerUid: "someone-else",
      title: "他人の旅",
      updatedAt: 5000,
      schema: 2,
      data: JSON.stringify({
        v: 1,
        title: "他人の旅",
        titles: { ja: "他人の旅" },
        lang: "ja",
        days: [
          {
            date: "2026-09-01",
            startTime: "10:00",
            tz: "",
            items: [
              { id: "x1", cat: "sight", name: "京都駅", dur: 30, note: "", fixedStart: "11:00" },
              { id: "x2", cat: "sight", name: "次のスポット", dur: 20, note: "", fixedStart: null }
            ]
          }
        ],
        packing: [],
        todos: []
      })
    };
    const before = fixtureStore(fixtureTrip());
    const env = boot({ hash: "#p=PUB123", localStorage: before, docs: { PUB123: publicDoc } });
    await tick();
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.body.classList.contains("view-only-mode"), "view-only-modeが付く");

    const x1Card = env.doc.querySelector("#timeline .item-card[data-id='x1']");
    ok(!!x1Card, "固定済み項目が描画される");
    const startEl = x1Card.querySelector(".item-start-time-btn");
    ok(startEl.tagName === "SPAN", "viewOnlyでは開始時刻はbuttonでなくspan（操作不能）", startEl.tagName);
    ok(startEl.textContent === "📌 11:00", "固定時刻自体は表示される", startEl.textContent);
    ok(!x1Card.querySelector(".item-fixed-clear-btn"), "✕（固定解除）ボタンは描画されない");
    // クリックしても何も起きない（編集モードに入らない）
    startEl.dispatchEvent(new env.win.Event("click", { bubbles: true }));
    await tick();
    ok(!env.doc.querySelector(".item-fixed-start-input"), "クリックしてもinputが現れない");

    const x2Card = env.doc.querySelector("#timeline .item-card[data-id='x2']");
    const startEl2 = x2Card.querySelector(".item-start-time-btn");
    ok(startEl2.tagName === "SPAN", "未固定項目もspanになる（編集不可）", startEl2.tagName);
  }

  /* ================================================================ */
  section("12. 4言語の新規文字列");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    const keys = [
      "timeline.fixedStartInputAria",
      "timeline.fixedStartBadgeTitle",
      "timeline.fixedStartEditHint",
      "timeline.fixedStartClearAria",
      "timeline.fixedStartConflict"
    ];
    ["ja", "en", "zh", "th"].forEach((L) => {
      keys.forEach((k) => {
        const v = env.win.I18N.t(L, k);
        ok(typeof v === "string" && v.length > 0 && v !== k, `${L}: ${k} が定義されている`, v);
      });
    });
  }

  /* ================================================================ */
  section("13. 既存機能の回帰（🔒各粒度・PDF出力・準備モーダル・ログイン導線）");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    // 項目priv toggle（render()で全カードが再構築されるため、クリック後は再取得する）
    const card1 = env.doc.querySelectorAll("#timeline .item-card")[0];
    const privBtn = card1.querySelector(".item-priv-toggle");
    privBtn.click();
    await tick();
    const card1After = env.doc.querySelectorAll("#timeline .item-card")[0];
    ok(card1After.classList.contains("item-card-private"), "🔒項目トグルは引き続き動作する");
    // 印刷ビュー
    env.doc.getElementById("printBtn").click();
    await tick();
    ok(env.doc.getElementById("printView") !== null, "印刷ビューが生成される");
    // 準備モーダル
    env.doc.getElementById("prepBtn").click();
    await tick();
    ok(!env.doc.getElementById("prepModal").classList.contains("hidden"), "準備モーダルが開く");
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
