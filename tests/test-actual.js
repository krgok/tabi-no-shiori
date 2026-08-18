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

// 実績の端末間マージ（23追記）: mergeTripActuals / applyCloudMergePlan 検証用の軽量フィクスチャ生成
function actualsItem(id, name, extra) {
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
      actualAt: null,
      gmap: "",
      gmapAuto: false,
      names: {}
    },
    extra || {}
  );
}
function actualsDay(id, date, items) {
  return { id, date, startTime: "09:00", tz: "", priv: false, dateManual: false, items };
}
function actualsTrip(days) {
  return { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days, packing: [], todos: [], packingPriv: false, todosPriv: false };
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
            { id: "i1", cat: "sight", name: "A", actualStart: "9:05", actualLat: 35.1, actualLon: 139.2, actualAt: 12345 },
            { id: "i2", cat: "sight", name: "B", actualStart: "25:99", actualLat: 1, actualLon: 2, actualAt: "12345" },
            { id: "i3", cat: "sight", name: "C", actualStart: 12345, actualLat: "abc", actualLon: NaN, actualAt: NaN },
            { id: "i4", cat: "sight", name: "D", actualLat: 35.1 },
            { id: "i5", cat: "sight", name: "E", actualAt: Infinity }
          ]
        }
      ]
    };
    const t = normalize(raw);
    const items = t.days[0].items;
    ok(items[0].actualStart === "09:05", "1桁の時(H:MM)表記はゼロ埋め正規化される", items[0].actualStart);
    ok(items[0].actualLat === 35.1 && items[0].actualLon === 139.2, "有効な座標はそのまま保持される", [items[0].actualLat, items[0].actualLon]);
    ok(items[0].actualAt === 12345, "有効なactualAt(number)はそのまま保持される", items[0].actualAt);
    ok(items[1].actualStart === null, "時=25/分=99など範囲外の時刻はnullになる", items[1].actualStart);
    ok(items[1].actualAt === null, "actualAtが文字列型は防御的にnullになる", items[1].actualAt);
    ok(items[2].actualStart === null && items[2].actualLat === null && items[2].actualLon === null, "型が違う値(number/文字列/NaN)は防御的にnullになる", items[2]);
    ok(items[2].actualAt === null, "actualAtがNaNは防御的にnullになる", items[2].actualAt);
    ok(items[3].actualLat === null && items[3].actualLon === null, "片方だけしか無い座標は両方nullに落ちる", items[3]);
    ok(items[3].actualAt === null, "actualAt未指定は既定でnullになる", items[3].actualAt);
    ok(items[4].actualAt === null, "actualAtがInfinity(有限でない)は防御的にnullになる", items[4].actualAt);
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
          items: [{ id: "i1", cat: "sight", name: "A", actualStart: "10:00", actualLat: 35.1, actualLon: 139.2, actualAt: 77777 }]
        }
      ]
    });
    const sanitized = T.sanitizeTripForPublic(trip);
    const it = sanitized.days[0].items[0];
    ok(it.actualLat === null, "actualLatは公開コピーから削除される(null化)", it.actualLat);
    ok(it.actualLon === null, "actualLonは公開コピーから削除される(null化)", it.actualLon);
    ok(it.actualStart === "10:00", "actualStart(時刻のみ)は公開コピーにも残る", it.actualStart);
    ok(it.actualAt === 77777, "actualAt(実績の最終更新時刻)も公開コピーに残る(共同編集マージの判断材料のため)", it.actualAt);
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
  section("9. 共同編集マージ: actualAtの新しい方が勝ち、座標は共有リンクへ絶対に流れない");
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
          actualAt: null,
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

    // 9a: 共同編集者側のactualAtが新しい場合は伝わる（実際にUIで✓を押せばactualAtも更新される想定）
    // オーナーは既に実績（到着時刻+GPS）を記録済み(actualAt=1000)
    const ownerTrip = normalize(
      baseTrip([day("d1", [sightItem("a", "浅草寺", { actualStart: "10:05", actualLat: 35.71, actualLon: 139.79, actualAt: 1000 })])])
    );

    const publicView = sanitize(ownerTrip);
    ok(publicView.days[0].items[0].actualLat === null && publicView.days[0].items[0].actualLon === null, "前提: 公開ビュー(共同編集者に配信されるコピー)にはGPS座標が含まれない");
    ok(publicView.days[0].items[0].actualStart === "10:05", "前提: 公開ビューには実績時刻は含まれる");

    // 共同編集者は自分のGPSを持たない(null)まま、オーナーより後の時刻(actualAt=2000)で実績時刻を書き換えた
    const received = normalize(publicView);
    received.days[0].items[0].actualStart = "10:20";
    received.days[0].items[0].actualAt = 2000;
    const merged = merge(ownerTrip, received);
    ok(merged.days[0].items[0].actualStart === "10:20", "共同編集者側のactualAtが新しければ書き換えたactualStartが伝わる");
    ok(merged.days[0].items[0].actualLat === null && merged.days[0].items[0].actualLon === null, "共同編集者側が勝った場合、座標は(オーナー側の古い記録も含め)nullになる。座標が共有リンク経由で紛れ込む余地は無い");

    // 9b: 家族の古いコピー受信でオーナーの新しい実績時刻が巻き戻らない（本バグ修正の主眼）。
    // オーナーがさらに後で(actualAt=3000)実績を上書きした後、家族が9a時点の古いコピー(actualAt=2000)を
    // 別の編集(例: メモ変更)と一緒に送り返してきたケースを想定する
    const ownerTrip2 = normalize(
      baseTrip([day("d1", [sightItem("a", "浅草寺", { actualStart: "10:35", actualLat: 35.72, actualLon: 139.8, actualAt: 3000 })])])
    );
    const staleReceived = normalize(publicView); // publicView(actualAt=1000相当)よりは新しいが、ownerTrip2(3000)よりは古いデータ
    staleReceived.days[0].items[0].actualStart = "10:20";
    staleReceived.days[0].items[0].actualAt = 2000;
    const merged2 = merge(ownerTrip2, staleReceived);
    ok(merged2.days[0].items[0].actualStart === "10:35", "オーナー側のactualAtの方が新しければ、家族の古いコピーで実績時刻が巻き戻らない", merged2.days[0].items[0].actualStart);
    ok(merged2.days[0].items[0].actualAt === 3000, "actualAtもオーナー側の新しい値のまま", merged2.days[0].items[0].actualAt);
    ok(
      merged2.days[0].items[0].actualLat === 35.72 && merged2.days[0].items[0].actualLon === 139.8,
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

  /* ================================================================ */
  section("12. mergeTripActuals: 端末Aが項目1、端末Bが項目2に実績→合成後に両方残る");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // adopted(採用する側=updatedAtが新しい方): 項目1(i1)にだけ端末Aの実績がある
    const adopted = T.normalizeTrip(
      actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "スポット1", { actualStart: "10:00", actualAt: 1000 }), actualsItem("i2", "スポット2")])])
    );
    // other(もう一方の端末): 項目2(i2)にだけ端末Bの実績がある
    const other = T.normalizeTrip(
      actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "スポット1"), actualsItem("i2", "スポット2", { actualStart: "11:30", actualAt: 500 })])])
    );

    const merged = mergeTripActuals(adopted, other);
    const items = merged.days[0].items;
    ok(items.find((i) => i.id === "i1").actualStart === "10:00", "採用した側(端末A)の項目1の実績が残る", items.find((i) => i.id === "i1"));
    ok(items.find((i) => i.id === "i2").actualStart === "11:30", "もう一方(端末B)にしか無かった項目2の実績も拾い上げられて残る", items.find((i) => i.id === "i2"));
  }

  /* ================================================================ */
  section("13. mergeTripActuals: 新しいactualAtが古い方に勝つ／×クリアが伝わる");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // 13a: 同じ項目に両端末が記録。otherの方がactualAtが新しい→otherの値が勝つ
    const adoptedOld = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: "09:00", actualAt: 1000 })])]));
    const otherNew = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: "09:30", actualAt: 2000 })])]));
    const merged1 = mergeTripActuals(adoptedOld, otherNew);
    ok(merged1.days[0].items[0].actualStart === "09:30", "actualAtが新しい方(other)の実績時刻が勝つ", merged1.days[0].items[0].actualStart);
    ok(merged1.days[0].items[0].actualAt === 2000, "actualAtも新しい方の値になる", merged1.days[0].items[0].actualAt);

    // 13b: ×クリア(actualStart=null)でもactualAtが新しければ伝わる（消去も実績の変更として扱われる）
    const adoptedHasValue = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: "09:00", actualLat: 35.0, actualLon: 139.0, actualAt: 1000 })])]));
    const otherCleared = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: null, actualAt: 3000 })])]));
    const merged2 = mergeTripActuals(adoptedHasValue, otherCleared);
    ok(merged2.days[0].items[0].actualStart === null, "新しい方が×クリア(actualStart=null)なら、クリアの方が伝わる", merged2.days[0].items[0]);
    ok(merged2.days[0].items[0].actualLat === null && merged2.days[0].items[0].actualLon === null, "クリアが勝った場合は座標も一緒にnullになる", merged2.days[0].items[0]);
    ok(merged2.days[0].items[0].actualAt === 3000, "actualAtもクリアした側の新しい値になる", merged2.days[0].items[0].actualAt);
  }

  /* ================================================================ */
  section("14. mergeTripActuals: actualAt同値(両方null含む)ではnon-null優先");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // 14a: 両方actualAt未設定(null=0扱い)で、otherだけ実績値を持つ→otherが優先される
    const adoptedEmpty = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A")])]));
    const otherHasStart = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: "12:00" })])]));
    const merged1 = mergeTripActuals(adoptedEmpty, otherHasStart);
    ok(merged1.days[0].items[0].actualStart === "12:00", "actualAt同値(共にnull)ならnon-nullの実績値を持つ側が優先される", merged1.days[0].items[0].actualStart);

    // 14b: 逆に adopted 側だけ実績値を持つ場合は adopted の値が残る
    const adoptedHasStart = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A", { actualStart: "08:00" })])]));
    const otherEmpty = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A")])]));
    const merged2 = mergeTripActuals(adoptedHasStart, otherEmpty);
    ok(merged2.days[0].items[0].actualStart === "08:00", "actualAt同値でadopted側だけがnon-nullならadopted側が残る", merged2.days[0].items[0].actualStart);

    // 14c: 両方null(未記録)のままなら、結果もnullのまま
    const bothEmptyA = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A")])]));
    const bothEmptyB = T.normalizeTrip(actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("i1", "A")])]));
    const merged3 = mergeTripActuals(bothEmptyA, bothEmptyB);
    ok(merged3.days[0].items[0].actualStart === null, "両方とも未記録ならマージ後もnullのまま", merged3.days[0].items[0].actualStart);
  }

  /* ================================================================ */
  section("15. mergeTripActuals: 項目が別の日へ移動していてもidで照合して実績が合流する");
  {
    const internalsEnv = boot({});
    await tick();
    const T = internalsEnv.win.__tabiShioriCollabInternals;
    const mergeTripActuals = T.mergeTripActuals;

    // adopted側では項目iXはDay2(d2)にある。other側では同じid iXがDay1(d1)にある(＝別端末で日をまたいで移動した)
    const adopted = T.normalizeTrip(
      actualsTrip([actualsDay("d1", "2026-08-01", []), actualsDay("d2", "2026-08-02", [actualsItem("iX", "移動した項目")])])
    );
    const other = T.normalizeTrip(
      actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("iX", "移動した項目", { actualStart: "13:15", actualAt: 9999 })]), actualsDay("d2", "2026-08-02", [])])
    );

    const merged = mergeTripActuals(adopted, other);
    ok(merged.days[0].items.length === 0, "adopted側の日構成(項目はDay2にある)がそのまま使われる");
    const movedItem = merged.days[1].items.find((i) => i.id === "iX");
    ok(!!movedItem, "移動先の日(Day2)に項目が存在する");
    ok(movedItem.actualStart === "13:15", "日をまたいでいてもidで照合され、other側の実績が合流する", movedItem && movedItem.actualStart);
  }

  /* ================================================================ */
  section("16. applyCloudMergePlan経由: クラウド採用時にローカルの実績が拾われ、アップロード対象に入る");
  {
    const STORE_KEY = STORAGE_KEY;
    const localTrip = actualsTrip([
      actualsDay("d1", "2026-08-01", [
        actualsItem("a1", "スポットA", { actualStart: "09:10", actualLat: 35.0, actualLon: 139.0, actualAt: 5000 }),
        actualsItem("a2", "スポットB")
      ])
    ]);
    const storage = {
      [STORE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C1", updatedAt: 1000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    // Firestore呼び出し無しでcloudUpsertEntryが動くよう、ログイン状態を直接セットする
    // （fb.login() 経由の完全なログインフローはruncCloudMerge()を誘発し本テストの主眼をぼかすため、
    // 既存の内部変数(authUser/firebaseReady/fbDb)を直接埋める簡便な方法をとる）
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");
    ok(!!entry && entry.cloudId === "C1", "前提: ローカルのしおりはcloudId=C1を持つ");

    // クラウド側(他端末が既にアップロード済みのバージョン): 項目a2にだけ実績がある。updatedAtはローカルより新しい
    const cloudTrip = actualsTrip([
      actualsDay("d1", "2026-08-01", [actualsItem("a1", "スポットA"), actualsItem("a2", "スポットB", { actualStart: "14:00", actualLat: 35.5, actualLon: 139.5, actualAt: 6000 })])
    ]);
    const plan = {
      uploads: [],
      localUpdates: [{ entry, cloudDoc: { id: "C1", data: JSON.stringify(cloudTrip), updatedAt: 2000, archived: false, publicId: null, editId: null } }],
      newLocalEntries: []
    };

    const callsBefore = env.fb.calls.length;
    T.applyCloudMergePlan(plan);
    await tick();

    const items = entry.data.days[0].items;
    const a1 = items.find((i) => i.id === "a1");
    const a2 = items.find((i) => i.id === "a2");
    ok(a1 && a1.actualStart === "09:10", "採用したクラウド版に、ローカルにしか無かった項目a1の実績が拾われる", a1);
    ok(a2 && a2.actualStart === "14:00", "クラウド側にしか無かった項目a2の実績も残る(両方揃う)", a2);

    const newCalls = env.fb.calls.slice(callsBefore);
    const reuploadCall = newCalls.find((c) => c.op === "set" && c.coll === "trips" && c.id === "C1");
    ok(!!reuploadCall, "ローカルの実績を拾い上げた結果がクラウド版と異なるため、再度クラウドへアップロードされる(cloudUpsertEntry呼び出し)");
    if (reuploadCall) {
      const uploaded = JSON.parse(reuploadCall.payload.data);
      const ua1 = uploaded.days[0].items.find((i) => i.id === "a1");
      ok(ua1 && ua1.actualStart === "09:10", "アップロードされたデータにも、ローカルで拾い上げたa1の実績が含まれる(次に他端末が開いたとき両方揃う)", ua1);
    }
  }

  /* ================================================================ */
  section("17. applyCloudMergePlan経由(uploads方向): クラウド版にしか無い実績が拾われ、アップロード後のデータにもローカルにも残る");
  {
    // ローカル版: 項目x1に実績なし。updatedAtはクラウドと同値（＝前回同期から双方変化なし、
    // または computeTripsMergePlan の仕様で毎回uploadsに入るケースを再現）
    const localTrip = actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("x1", "項目X")])]);
    const storage = {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C2", updatedAt: 2000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");
    ok(!!entry && entry.cloudId === "C2", "前提: ローカルのしおりはcloudId=C2を持つ");

    // クラウド側: 項目x1に他端末が記録した実績がある。updatedAtはローカルと同値
    // （同値なのでcomputeTripsMergePlanの分岐上はuploads扱いになる）
    const cloudTrip = actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("x1", "項目X", { actualStart: "14:20", actualLat: 35.2, actualLon: 139.3, actualAt: 7000 })])]);
    const cloudDoc = { id: "C2", data: JSON.stringify(cloudTrip), updatedAt: 2000, archived: false, publicId: null, editId: null };
    const plan = T.computeTripsMergePlan([entry], [cloudDoc]);
    ok(plan.uploads.length === 1 && plan.uploads[0].entry === entry && plan.uploads[0].cloudDoc === cloudDoc, "updatedAt同値はuploads対象になり、対応するクラウド文書がcloudDocとして添えられる");
    ok(plan.localUpdates.length === 0, "updatedAt同値はlocalUpdatesには入らない");

    const callsBefore = env.fb.calls.length;
    T.applyCloudMergePlan(plan);
    await tick();

    const x1 = entry.data.days[0].items.find((i) => i.id === "x1");
    ok(x1 && x1.actualStart === "14:20", "アップロード前にクラウド版の実績が拾われ、ローカルのentry.dataにも取り込まれる", x1);

    const newCalls = env.fb.calls.slice(callsBefore);
    const uploadCall = newCalls.find((c) => c.op === "set" && c.coll === "trips" && c.id === "C2");
    ok(!!uploadCall, "通常どおりアップロードが実行される");
    if (uploadCall) {
      const uploaded = JSON.parse(uploadCall.payload.data);
      const ux1 = uploaded.days[0].items.find((i) => i.id === "x1");
      ok(ux1 && ux1.actualStart === "14:20", "アップロードされるデータにもクラウド版の実績が残り、丸ごと上書きで消えない(他端末の実績が消失するバグの再発防止)", ux1);
    }
  }

  /* ================================================================ */
  section("18. applyCloudMergePlan経由(uploads方向): ローカル・クラウド双方の別項目の実績が合流する");
  {
    const localTrip = actualsTrip([
      actualsDay("d1", "2026-08-01", [actualsItem("y1", "項目Y1", { actualStart: "08:00", actualAt: 3000 }), actualsItem("y2", "項目Y2")])
    ]);
    const storage = {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C3", updatedAt: 3000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");
    const cloudTrip = actualsTrip([
      actualsDay("d1", "2026-08-01", [actualsItem("y1", "項目Y1"), actualsItem("y2", "項目Y2", { actualStart: "16:45", actualAt: 4000 })])
    ]);
    const cloudDoc = { id: "C3", data: JSON.stringify(cloudTrip), updatedAt: 3000, archived: false, publicId: null, editId: null };
    const plan = T.computeTripsMergePlan([entry], [cloudDoc]);

    T.applyCloudMergePlan(plan);
    await tick();

    const items = entry.data.days[0].items;
    const y1 = items.find((i) => i.id === "y1");
    const y2 = items.find((i) => i.id === "y2");
    ok(y1 && y1.actualStart === "08:00", "ローカルにしか無かった項目Y1の実績が残る", y1);
    ok(y2 && y2.actualStart === "16:45", "クラウドにしか無かった項目Y2の実績も合流して残る", y2);
  }

  /* ================================================================ */
  section("19. applyCloudMergePlan経由(uploads方向): クラウド版dataが壊れたJSONでも例外にならず従来通りアップロードされる");
  {
    const localTrip = actualsTrip([actualsDay("d1", "2026-08-01", [actualsItem("z1", "項目Z", { actualStart: "07:00", actualAt: 1000 })])]);
    const storage = {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "loc1",
        trips: [{ id: "loc1", data: localTrip, archived: false, cloudId: "C4", updatedAt: 9000, publicId: null, editId: null }]
      })
    };
    const env = boot({ localStorage: storage });
    await tick();

    const T = env.win.__tabiShioriCollabInternals;
    env.win.authUser = { uid: "test-uid", email: "t@example.com", displayName: "T", photoURL: "" };
    env.win.firebaseReady = true;
    env.win.fbDb = env.fb.firebase.firestore();

    const entry = env.win.tripsStore.find((e) => e.id === "loc1");
    // 壊れたJSON（例えば通信エラー時の空文字列や破損データを想定）
    const cloudDoc = { id: "C4", data: "{not valid json", updatedAt: 9000, archived: false, publicId: null, editId: null };
    const plan = T.computeTripsMergePlan([entry], [cloudDoc]);

    let threw = false;
    const callsBefore = env.fb.calls.length;
    try {
      T.applyCloudMergePlan(plan);
      await tick();
    } catch (e) {
      threw = true;
    }
    ok(!threw, "クラウド版dataが壊れたJSONでも例外を投げない");

    const z1 = entry.data.days[0].items.find((i) => i.id === "z1");
    ok(z1 && z1.actualStart === "07:00", "マージをスキップしてローカルのentry.dataはそのまま残る", z1);

    const newCalls = env.fb.calls.slice(callsBefore);
    const uploadCall = newCalls.find((c) => c.op === "set" && c.coll === "trips" && c.id === "C4");
    ok(!!uploadCall, "壊れたJSONでもアップロード自体は従来通り実行される");
    if (uploadCall) {
      const uploaded = JSON.parse(uploadCall.payload.data);
      const uz1 = uploaded.days[0].items.find((i) => i.id === "z1");
      ok(uz1 && uz1.actualStart === "07:00", "アップロードされるデータはローカルの実績を保持したまま丸ごとアップロードされる", uz1);
    }
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
