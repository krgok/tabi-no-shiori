/**
 * 場所リンク欄への「座標そのもの」直貼り対応の検証ハーネス。
 * 携帯(iPhone)のGoogleマップアプリで場所を共有すると短縮リンク(maps.app.goo.gl)しか得られず、
 * ブラウザ単体では展開できない(CORS)。一方、地図を長押しして「ピンを立てる」と画面上部に
 * 「35.6812, 139.7671」のような座標そのものが表示されコピーできるため、それをそのまま
 * 場所リンク欄に貼れば位置が確定するようにした(parseBareCoords / handleGmapChange, js/10-gmaps.js)。
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する（test-gmap-clear.js と同じ方式）。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function todayStr() {
  var d = new Date();
  var pad = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// gmap欄が出るのは item.cat !== "move" のときだけなので、全項目 sight にしておく
function fixtureTrip() {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [
      {
        date: todayStr(),
        startTime: "09:00",
        tz: "",
        items: [
          {
            id: "p1",
            cat: "sight",
            name: "",
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
          }
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

function setInputAndChange(env, id, value) {
  const card = env.doc.querySelector("#timeline .item-card[data-id='" + id + "']");
  const input = card.querySelector(".item-gmap-input");
  input.value = value;
  input.dispatchEvent(new env.win.Event("change"));
}

function getItem(env, id) {
  const saved = JSON.parse(env.store[STORAGE_KEY]);
  return saved.trips[0].data.days[0].items.find((i) => i.id === id);
}

(async () => {
  /* ================================================================ */
  section("1. parseBareCoords: 受理される形式");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    const f = env.win.parseBareCoords;

    ok(
      JSON.stringify(f("35.6812, 139.7671")) === JSON.stringify({ lat: 35.6812, lon: 139.7671 }),
      "カンマ+空白区切り",
      f("35.6812, 139.7671")
    );
    ok(
      JSON.stringify(f("35.6812,139.7671")) === JSON.stringify({ lat: 35.6812, lon: 139.7671 }),
      "カンマのみ区切り",
      f("35.6812,139.7671")
    );
    ok(
      JSON.stringify(f("-33.86 151.21")) === JSON.stringify({ lat: -33.86, lon: 151.21 }),
      "空白区切り・符号付き",
      f("-33.86 151.21")
    );
    ok(
      JSON.stringify(f("  35.6812,  139.7671  ")) === JSON.stringify({ lat: 35.6812, lon: 139.7671 }),
      "前後・区切りの余分な空白は無視される",
      f("  35.6812,  139.7671  ")
    );
    ok(
      JSON.stringify(f("35.6812，139.7671")) === JSON.stringify({ lat: 35.6812, lon: 139.7671 }),
      "全角カンマ「，」区切り",
      f("35.6812，139.7671")
    );
    ok(
      JSON.stringify(f("35.6812、139.7671")) === JSON.stringify({ lat: 35.6812, lon: 139.7671 }),
      "全角カンマ「、」区切り",
      f("35.6812、139.7671")
    );
    ok(
      JSON.stringify(f("geo:35.68,139.76")) === JSON.stringify({ lat: 35.68, lon: 139.76 }),
      "geo: URI形式",
      f("geo:35.68,139.76")
    );
  }

  /* ================================================================ */
  section("2. parseBareCoords: 拒否される形式");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    const f = env.win.parseBareCoords;

    ok(f("91,0") === null, "緯度が範囲外(91)はnull", f("91,0"));
    ok(f("0,181") === null, "経度が範囲外(181)はnull", f("0,181"));
    ok(f("35.68") === null, "数値1個だけはnull", f("35.68"));
    ok(f("https://maps.google.com/?q=35.68,139.76") === null, "URLはnull", f("https://maps.google.com/?q=35.68,139.76"));
    ok(f("") === null, "空文字はnull", f(""));
    ok(f(null) === null, "nullはnull", f(null));
    ok(f("東京駅") === null, "座標でない文字列はnull", f("東京駅"));
  }

  /* ================================================================ */
  section("3. 入力欄に座標を貼るとlat/lon/coordSrc/gmapが確定し、再描画・トーストも正しい");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    setInputAndChange(env, "p1", "35.6812, 139.7671");
    await tick();

    const p1 = getItem(env, "p1");
    ok(p1.lat === 35.6812 && p1.lon === 139.7671, "lat/lonが座標から設定される", { lat: p1.lat, lon: p1.lon });
    ok(p1.coordSrc === "gmap", "coordSrcが'gmap'になる（自己修復の対象外にするため）", p1.coordSrc);
    ok(
      p1.gmap === "https://www.google.com/maps?q=35.6812,139.7671",
      "gmapには生の文字列でなく正規のq=形式URLが保存される",
      p1.gmap
    );
    ok(p1.gmapAuto === false, "gmapAutoはfalse（手入力扱い）のまま", p1.gmapAuto);

    const card = env.doc.querySelector("#timeline .item-card[data-id='p1']");
    const input = card.querySelector(".item-gmap-input");
    ok(
      input.value === "https://www.google.com/maps?q=35.6812,139.7671",
      "再描画後、入力欄の値は正規URLになっている",
      input.value
    );

    const expectedToast = env.win.I18N.t("ja", "toast.gmapCoordsPasted");
    const toastEl = env.doc.querySelector("#toastContainer .toast");
    ok(
      !!toastEl && toastEl.textContent.indexOf(expectedToast) !== -1,
      "トースト「座標から位置を設定しました」が表示される",
      toastEl && toastEl.textContent
    );
  }

  /* ================================================================ */
  section("4. 既存挙動の回帰確認: 通常URL・短縮リンク・空文字");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    setInputAndChange(env, "p1", "https://www.google.com/maps?q=35.1,139.2");
    await tick();
    let p1 = getItem(env, "p1");
    ok(p1.lat === 35.1 && p1.lon === 139.2 && p1.coordSrc === "gmap", "通常URLからは従来通り座標を抽出する", p1);
    ok(p1.gmap === "https://www.google.com/maps?q=35.1,139.2", "gmapには貼ったURLがそのまま保存される", p1.gmap);

    setInputAndChange(env, "p1", "https://maps.app.goo.gl/abcXYZ");
    await tick();
    p1 = getItem(env, "p1");
    ok(p1.gmap === "https://maps.app.goo.gl/abcXYZ", "短縮リンクはそのまま保存される", p1.gmap);
    ok(p1.lat === null && p1.lon === null && p1.coordSrc === null, "短縮リンクからは座標が取れないためnullに戻る", p1);
    const expectedShortToast = env.win.I18N.t("ja", "toast.gmapShortLink");
    // トーストは自動消滅まで積み重なるため、直前の操作分は末尾の要素で確認する
    const toasts = env.doc.querySelectorAll("#toastContainer .toast");
    const lastToast = toasts[toasts.length - 1];
    ok(
      !!lastToast && lastToast.textContent.indexOf(expectedShortToast) !== -1,
      "短縮リンクの警告トーストが従来通り表示される",
      lastToast && lastToast.textContent
    );

    setInputAndChange(env, "p1", "");
    await tick();
    p1 = getItem(env, "p1");
    ok(p1.gmap === "", "空文字を入れるとgmapが空になる（従来通り）", p1.gmap);
    ok(p1.lat === null && p1.lon === null && p1.coordSrc === null, "空文字でクリアするとgmap由来の座標も消える（従来通り）", p1);
  }

  /* ================================================================ */
  section("5. 座標貼り付け後、❌ボタンで消すと座標も一緒に消える（既存機能との連携）");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    setInputAndChange(env, "p1", "35.6812, 139.7671");
    await tick();

    let card = env.doc.querySelector("#timeline .item-card[data-id='p1']");
    const clearBtn = card.querySelector(".item-gmap-clear-btn");
    ok(!!clearBtn, "座標貼り付け後は❌ボタンが表示される");
    clearBtn.click();
    await tick();

    const p1 = getItem(env, "p1");
    ok(p1.gmap === "", "❌クリックでgmapが空になる", p1.gmap);
    ok(p1.lat === null && p1.lon === null && p1.coordSrc === null, "座標貼り付けで確定した座標も❌で一緒に消える", p1);
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
