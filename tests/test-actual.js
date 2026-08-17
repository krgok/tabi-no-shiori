/**
 * 実績記録（フェーズ1、SPEC 23）検証ハーネス
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する。
 * harness.js（boot/tick/ok/section）を再利用する（開始時刻の手動固定 17 のテストと同じ方式）。
 */
const { boot, tick, ok, section, read, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

// 差分計算が読み取りやすい単純なフィクスチャ（tz無し・auto move無し）。startTime=09:00、
// items[0]の予定開始は09:00（dur=60）。実績記録の差分表示テストはこのitems[0]を使う
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
          { id: "a1", cat: "sight", name: "スポットA", loc: "", dur: 60, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, actualStart: null, actualLat: null, actualLon: null, gmap: "", gmapAuto: false, names: {} },
          { id: "a2", cat: "sight", name: "スポットB", loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, actualStart: null, actualLat: null, actualLon: null, gmap: "", gmapAuto: false, names: {} },
          { id: "a3", cat: "meal", name: "ランチ", loc: "", dur: 45, note: "", lat: null, lon: null, coordSrc: null, priv: false, notePriv: false, fixedStart: null, actualStart: null, actualLat: null, actualLon: null, gmap: "", gmapAuto: false, names: {} }
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

// CSV読み込みボタンは showConfirm() で確認ダイアログを挟む実装のため、OKボタンまでクリックする
function clickLoadCsvAndConfirm(env) {
  env.doc.getElementById("textioLoadBtn").click();
  env.doc.getElementById("confirmOkBtn").click();
}

(async () => {
  /* ================================================================ */
  section("1. normalizeTrip: actualStart/actualLat/actualLonの防御的正規化");
  {
    const internalsEnv = boot({});
    await tick();
    const normalize = internalsEnv.win.__tabiShioriCollabInternals.normalizeTrip;
    const raw = {
      v: 1,
      title: "t",
      lang: "ja",
      days: [
        {
          date: "",
          startTime: "09:00",
          items: [
            { id: "i1", cat: "sight", name: "A", actualStart: "9:05", actualLat: 35.1, actualLon: 139.2 },
            { id: "i2", cat: "sight", name: "B", actualStart: "25:99", actualLat: 1, actualLon: 2 },
            { id: "i3", cat: "sight", name: "C", actualStart: 12345, actualLat: "abc", actualLon: NaN },
            { id: "i4", cat: "sight", name: "D", actualLat: 35.1 }
          ]
        }
      ]
    };
    const t = normalize(raw);
    const items = t.days[0].items;
    ok(items[0].actualStart === "09:05", "1桁の時(H:MM)表記はゼロ埋め正規化される", items[0].actualStart);
    ok(items[0].actualLat === 35.1 && items[0].actualLon === 139.2, "有効な座標はそのまま保持される", [items[0].actualLat, items[0].actualLon]);
    ok(items[1].actualStart === null, "時=25/分=99など範囲外の時刻はnullになる", items[1].actualStart);
    ok(items[2].actualStart === null && items[2].actualLat === null && items[2].actualLon === null, "型が違う値(number/文字列/NaN)は防御的にnullになる", items[2]);
    ok(items[3].actualLat === null && items[3].actualLon === null, "片方だけしか無い座標は両方nullに落ちる", items[3]);
  }

  /* ================================================================ */
  section("2. sanitizeTripForPublic: actualLat/actualLonを削除し、actualStartは残す");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const trip = T.normalizeTrip({
      v: 1,
      title: "t",
      lang: "ja",
      days: [
        {
          date: "",
          startTime: "09:00",
          items: [{ id: "i1", cat: "sight", name: "A", actualStart: "10:00", actualLat: 35.1, actualLon: 139.2 }]
        }
      ]
    });
    const sanitized = T.sanitizeTripForPublic(trip);
    const it = sanitized.days[0].items[0];
    ok(it.actualLat === null, "actualLatは公開コピーから削除される(null化)", it.actualLat);
    ok(it.actualLon === null, "actualLonは公開コピーから削除される(null化)", it.actualLon);
    ok(it.actualStart === "10:00", "actualStart(時刻のみ)は公開コピーにも残る", it.actualStart);
  }

  /* ================================================================ */
  section("3. ✓ボタン: 押すとactualStartが記録されsaveStateされる（geolocation無しでも動く）");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    ok(!env.win.navigator.geolocation, "テスト環境(jsdom)にはnavigator.geolocationが無い");

    const card0 = env.doc.querySelectorAll("#timeline .item-card")[0];
    const recordBtn = card0.querySelector(".item-actual-record-btn");
    ok(!!recordBtn, "✓ボタンが存在する");
    recordBtn.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const a1 = saved.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(typeof a1.actualStart === "string" && /^\d{2}:\d{2}$/.test(a1.actualStart), "actualStartに現在時刻(HH:MM)が記録される", a1.actualStart);
    ok(a1.actualLat === null && a1.actualLon === null, "geolocationが無い環境ではactualLat/actualLonはnullのまま", [a1.actualLat, a1.actualLon]);

    const card0b = env.doc.querySelectorAll("#timeline .item-card")[0];
    const disp = card0b.querySelector(".item-actual-display");
    ok(!!disp, "記録直後に実績表示が現れる（GPSを待たずに即描画）");
    ok(disp.textContent.indexOf(a1.actualStart) !== -1, "実績表示に記録した時刻が含まれる", disp.textContent);

    // 既に記録済みの項目にもう一度✓を押すと現在時刻で上書きされる
    recordBtn.click();
    await tick();
    const saved2 = JSON.parse(env.store[STORAGE_KEY]);
    const a1b = saved2.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(typeof a1b.actualStart === "string" && /^\d{2}:\d{2}$/.test(a1b.actualStart), "再度押すと現在時刻で上書きされる", a1b.actualStart);
  }

  /* ================================================================ */
  section("4. 予定との差分表示（+N分/-N分/色クラス/ちょうどのときは非表示）");
  {
    const tripLate = fixtureTrip();
    tripLate.days[0].items[0].actualStart = "09:25"; // 予定09:00に対して+25分
    const envLate = boot({ localStorage: fixtureStore(tripLate) });
    await tick();
    let disp = envLate.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-display");
    ok(disp.textContent === "実績 09:25 (+25分)", "遅れは「実績 HH:MM (+N分)」で表示される", disp.textContent);
    ok(disp.classList.contains("is-late"), "遅れには is-late クラスが付く");

    const tripEarly = fixtureTrip();
    tripEarly.days[0].items[0].actualStart = "08:50"; // 予定09:00に対して-10分
    const envEarly = boot({ localStorage: fixtureStore(tripEarly) });
    await tick();
    disp = envEarly.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-display");
    ok(disp.textContent === "実績 08:50 (-10分)", "早着は「実績 HH:MM (-N分)」で表示される", disp.textContent);
    ok(disp.classList.contains("is-early"), "早着には is-early クラスが付く");

    const tripExact = fixtureTrip();
    tripExact.days[0].items[0].actualStart = "09:00"; // 予定どおり
    const envExact = boot({ localStorage: fixtureStore(tripExact) });
    await tick();
    disp = envExact.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-display");
    ok(disp.textContent === "実績 09:00", "ちょうど予定どおりのときは差分を表示しない", disp.textContent);
    ok(!disp.classList.contains("is-late") && !disp.classList.contains("is-early"), "ちょうどのときは色クラスも付かない");
  }

  /* ================================================================ */
  section("5. 実績表示クリックで手動修正、×でクリア（後追い入力・誤タップの取り消し）");
  {
    const trip = fixtureTrip();
    trip.days[0].items[0].actualStart = "09:25";
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();

    let card = env.doc.querySelector("#timeline .item-card[data-id='a1']");
    const disp = card.querySelector(".item-actual-display");
    ok(disp.tagName === "BUTTON", "通常モードでは実績表示はbutton（クリック可能）");
    disp.click();
    await tick();

    const input = env.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-input");
    ok(!!input, "クリックで <input type=\"time\"> が現れる");
    ok(input.type === "time", "inputはtype=timeである", input.type);
    ok(input.value === "09:25", "現在の実績値がプリセットされる", input.value);

    // Escapeでキャンセル: 値を変えても保存されず、実績表示に戻る（fixedStartと同じ挙動）
    input.value = "23:59";
    input.dispatchEvent(new env.win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    await tick();
    let cardAfterEsc = env.doc.querySelector("#timeline .item-card[data-id='a1']");
    ok(!cardAfterEsc.querySelector(".item-actual-input"), "Escapeで編集モードが閉じる");
    ok(cardAfterEsc.querySelector(".item-actual-display").textContent === "実績 09:25 (+25分)", "Escapeでは値が保存されず元の実績表示に戻る", cardAfterEsc.querySelector(".item-actual-display").textContent);

    // 改めてクリックして開き直し、今度は change確定で 09:40 に修正する
    cardAfterEsc.querySelector(".item-actual-display").click();
    await tick();
    const liveInput = env.doc.querySelector("#timeline .item-card[data-id='a1'] .item-actual-input");
    liveInput.value = "09:40";
    liveInput.dispatchEvent(new env.win.Event("change"));
    await tick();

    card = env.doc.querySelector("#timeline .item-card[data-id='a1']");
    const disp2 = card.querySelector(".item-actual-display");
    ok(disp2.textContent === "実績 09:40 (+40分)", "修正後の値で再表示される", disp2.textContent);

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const a1 = saved.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1.actualStart === "09:40", "手動修正がsaveStateされる", a1.actualStart);

    // ×でクリア
    const clearBtn = card.querySelector(".item-actual-clear-btn");
    ok(!!clearBtn, "×（クリア）ボタンが存在する");
    clearBtn.click();
    await tick();
    const cardAfter = env.doc.querySelector("#timeline .item-card[data-id='a1']");
    ok(!cardAfter.querySelector(".item-actual-display"), "クリア後は実績表示自体が消える");
    ok(!!cardAfter.querySelector(".item-actual-record-btn"), "✓ボタンは引き続き表示され、再記録できる");

    const saved2 = JSON.parse(env.store[STORAGE_KEY]);
    const a1b = saved2.trips[0].data.days[0].items.find((i) => i.id === "a1");
    ok(a1b.actualStart === null && a1b.actualLat === null && a1b.actualLon === null, "クリアでactualStart/actualLat/actualLonが全てnullに戻る", a1b);
  }

  /* ================================================================ */
  section("6. viewOnly（公開URL閲覧）では✓ボタンを表示しない（既存の編集系ボタンと同じCSS方針）");
  {
    // actionCol内の他ボタン(🔒複製削除)と同じパターンで、JS側は常に生成しCSS(body.view-only-mode)側で
    // 非表示にする。ここではそのCSSルールの存在と、viewOnlyでクリックしても何も起きないことを確認する
    const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    ok(css.includes("body.view-only-mode .item-actual-record-btn"), "styles.cssのview-only-mode非表示リストに.item-actual-record-btnが含まれる");

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
            items: [{ id: "x1", cat: "sight", name: "京都駅", dur: 30, note: "", actualStart: "10:15" }]
          }
        ],
        packing: [],
        todos: []
      })
    };
    const env = boot({ hash: "#p=PUB1", docs: { PUB1: publicDoc } });
    await tick();
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    ok(env.doc.body.classList.contains("view-only-mode"), "view-only-modeが付く");

    const card = env.doc.querySelector("#timeline .item-card[data-id='x1']");
    ok(!!card, "公開データのカードが描画される");
    ok(!!card.querySelector(".item-actual-record-btn"), "✓ボタン自体はDOMに存在する(他のactionColボタンと同じCSS非表示パターンのため)");
    // 実績表示はviewOnlyでも見える(actualStartは非公開情報ではないため)が、spanでクリック不可
    const disp = card.querySelector(".item-actual-display");
    ok(!!disp && disp.tagName === "SPAN", "実績表示はviewOnlyではspan(クリック不可)になる", disp && disp.tagName);
    ok(!card.querySelector(".item-actual-clear-btn"), "×（クリア）ボタンはviewOnlyでは描画されない");

    // 万一クリックされても、多層防御のJSガードによりlocalStorageへの書き込みは一切発生しない
    const writesBefore = env.writeLog.length;
    card.querySelector(".item-actual-record-btn").click();
    await tick();
    ok(env.writeLog.length === writesBefore, "✓ボタンをクリックしてもviewOnly中はlocalStorageへ書き込まれない");
  }

  /* ================================================================ */
  section("7. CSV往復: actualStart/actualLat/actualLonが保持される");
  {
    const trip = fixtureTrip();
    trip.days[0].items[1].actualStart = "10:15";
    trip.days[0].items[1].actualLat = 35.7148;
    trip.days[0].items[1].actualLon = 139.7967;
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    env.doc.getElementById("textioBtn").click();
    const csv = env.doc.getElementById("textioArea").value;
    ok(csv.includes("actualStart") && csv.includes("actualLat") && csv.includes("actualLon"), "CSVヘッダーに実績記録の3列が末尾に追加されている");
    const headerRow = csv.split("\r\n")[1] || csv.split("\n")[1] || "";
    ok(headerRow.trim().endsWith("actualStart,actualLat,actualLon"), "実績記録の3列はヘッダー末尾にある(既存列の並びは変えない)", headerRow);
    ok(csv.includes("10:15"), "CSV本文に実績時刻が出力されている");
    ok(csv.includes("35.7148") && csv.includes("139.7967"), "CSV本文に実績座標が出力されている");

    clickLoadCsvAndConfirm(env);
    await tick();
    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const items = saved.trips[0].data.days[0].items;
    const b = items.find((i) => i.name === "スポットB");
    ok(b && b.actualStart === "10:15", "CSV再取込でactualStartが復元される", b && b.actualStart);
    ok(b && b.actualLat === 35.7148, "CSV再取込でactualLatが復元される", b && b.actualLat);
    ok(b && b.actualLon === 139.7967, "CSV再取込でactualLonが復元される", b && b.actualLon);
  }

  /* ================================================================ */
  section("8. 旧CSV（実績3列なし）・列数が短いCSVも今まで通り読める");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    // 8a: fixedStartまでしか無い旧CSV（実績記録より前のバージョンが出力した形式）
    const oldCsv =
      "day,date,start,category,mode,name,minutes,note,gmap,tz,arriveTz,private,notePrivate,dayPrivate,fixedStart\r\n" +
      "1,2026-08-01,09:00,観光,,旧スポット,30,,,,,0,0,0,\r\n";
    env.doc.getElementById("textioBtn").click();
    env.doc.getElementById("textioArea").value = oldCsv;
    clickLoadCsvAndConfirm(env);
    await tick();
    ok(env.errors.length === 0, "実績3列が無い旧CSV読込でコンソールエラーが出ない", env.errors);
    let saved = JSON.parse(env.store[STORAGE_KEY]);
    let items = saved.trips[0].data.days[0].items;
    ok(items.length === 1 && items[0].name === "旧スポット", "旧CSVが読み込める", items);
    ok(items[0].actualStart === null && items[0].actualLat === null && items[0].actualLon === null, "実績列が無い旧CSVはnull扱い", items[0]);

    // 8b: ヘッダーには実績3列があるが、データ行はExcel編集等で必須列までしか無い（後方互換方針:
    // 「ちょうどN列」判定は禁止。必須列さえ揃っていれば任意列の欠落はnull扱いで読み込める）
    const shortRowCsv =
      "day,date,start,category,mode,name,minutes,note,gmap,tz,arriveTz,private,notePrivate,dayPrivate,fixedStart,actualStart,actualLat,actualLon\r\n" +
      "1,2026-08-01,09:00,観光,,短い行,20,,\r\n";
    env.doc.getElementById("textioBtn").click();
    env.doc.getElementById("textioArea").value = shortRowCsv;
    clickLoadCsvAndConfirm(env);
    await tick();
    ok(env.errors.length === 0, "列数が短い行でもコンソールエラーが出ない", env.errors);
    saved = JSON.parse(env.store[STORAGE_KEY]);
    items = saved.trips[0].data.days[0].items;
    ok(items.length === 1 && items[0].name === "短い行", "必須列だけの短い行でも読み込める", items);
    ok(items[0].actualStart === null && items[0].actualLat === null && items[0].actualLon === null, "実績列の値が無い行はnull扱い", items[0]);
  }

  /* ================================================================ */
  section("9. 共同編集マージ: actualStartは伝わり、actualLat/actualLonはオーナー側が保持される");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const merge = T.mergeRemoteEditIntoOwnerTrip;
    const sanitize = T.sanitizeTripForPublic;
    const normalize = T.normalizeTrip;

    function sightItem(id, name, extra) {
      return Object.assign(
        {
          id,
          cat: "sight",
          name,
          loc: "",
          dur: 30,
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
        extra || {}
      );
    }
    function day(id, items) {
      return { id, date: "2026-08-01", startTime: "09:00", tz: "", priv: false, dateManual: false, items };
    }
    function baseTrip(days) {
      return { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days, packing: [], todos: [], packingPriv: false, todosPriv: false };
    }

    // オーナーは既に実績（到着時刻+GPS）を記録済み
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("a", "浅草寺", { actualStart: "10:05", actualLat: 35.71, actualLon: 139.79 })])])
    );

    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items[0].actualLat === null && publicView.days[0].items[0].actualLon === null, "前提: 公開ビュー(共同編集者に配信されるコピー)にはGPS座標が含まれない");
    ok(publicView.days[0].items[0].actualStart === "10:05", "前提: 公開ビューには実績時刻は含まれる");

    // 共同編集者は自分のGPSを持たない(null)まま、実績時刻だけ書き換えた
    const received = normalize(publicView);
    received.days[0].items[0].actualStart = "10:20";
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].actualStart === "10:20", "共同編集者が書き換えたactualStartが伝わる");
    ok(
      merged.days[0].items[0].actualLat === 35.71 && merged.days[0].items[0].actualLon === 139.79,
      "オーナーが記録済みのGPS座標は共同編集マージ後も消えずに保持される(受信データのnullで上書きされない)"
    );
  }

  /* ================================================================ */
  section("10. 4言語の新規文字列");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    const keys = ["timeline.actualLabel", "timeline.actualRecordBtnTitle", "timeline.actualEditHint", "timeline.actualClearAria", "timeline.actualInputAria"];
    ["ja", "en", "zh", "th"].forEach((L) => {
      keys.forEach((k) => {
        const v = env.win.I18N.t(L, k);
        ok(typeof v === "string" && v.length > 0 && v !== k, `${L}: ${k} が定義されている`, v);
      });
    });
  }

  /* ================================================================ */
  section("11. 既存機能の回帰（🔒トグル・複製・削除は引き続き動く）");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
    const card1 = env.doc.querySelectorAll("#timeline .item-card")[0];
    const privBtn = card1.querySelector(".item-priv-toggle");
    privBtn.click();
    await tick();
    const card1After = env.doc.querySelectorAll("#timeline .item-card")[0];
    ok(card1After.classList.contains("item-card-private"), "🔒項目トグルは引き続き動作する");
    const beforeCount = env.doc.querySelectorAll("#timeline .item-card").length;
    card1After.querySelector(".item-duplicate").click();
    await tick();
    ok(env.doc.querySelectorAll("#timeline .item-card").length === beforeCount + 1, "複製ボタンも引き続き動作する");
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
