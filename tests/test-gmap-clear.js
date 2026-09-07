/**
 * 場所リンク（Googleマップ欄）の❌一発削除ボタン検証ハーネス
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで挙動を確認する。
 * harness.js（boot/tick/ok/section）を再利用する（test-actual.js と同じ方式）。
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
            id: "g1",
            cat: "sight",
            name: "リンクあり(gmap座標)",
            loc: "",
            dur: 60,
            note: "",
            lat: 35.1,
            lon: 139.2,
            coordSrc: "gmap",
            priv: false,
            notePriv: false,
            fixedStart: null,
            actualStart: null,
            actualLat: null,
            actualLon: null,
            gmap: "https://maps.google.com/maps?q=35.1,139.2",
            gmapAuto: false,
            names: {}
          },
          {
            id: "g2",
            cat: "sight",
            name: "リンクなし",
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
          {
            id: "g3",
            cat: "sight",
            name: "リンクあり(座標はgeo由来)",
            loc: "",
            dur: 30,
            note: "",
            lat: 36.0,
            lon: 140.0,
            coordSrc: "geo",
            priv: false,
            notePriv: false,
            fixedStart: null,
            actualStart: null,
            actualLat: null,
            actualLon: null,
            gmap: "https://maps.google.com/maps/place/どこか",
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

(async () => {
  /* ================================================================ */
  section("1. gmapが空の項目にはボタンが出ない/gmapがある項目には出る");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    const card1 = env.doc.querySelector("#timeline .item-card[data-id='g1']");
    ok(!!card1.querySelector(".item-gmap-clear-btn"), "gmapがある項目(g1)には❌ボタンが出る");

    const card2 = env.doc.querySelector("#timeline .item-card[data-id='g2']");
    ok(!card2.querySelector(".item-gmap-clear-btn"), "gmapが空の項目(g2)には❌ボタンが出ない");

    const card3 = env.doc.querySelector("#timeline .item-card[data-id='g3']");
    ok(!!card3.querySelector(".item-gmap-clear-btn"), "gmapがある項目(g3)にも❌ボタンが出る");
  }

  /* ================================================================ */
  section("2. クリックでgmapが空になり、gmap由来の座標(coordSrc==='gmap')も一緒に消える");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    const card1 = env.doc.querySelector("#timeline .item-card[data-id='g1']");
    const clearBtn1 = card1.querySelector(".item-gmap-clear-btn");
    clearBtn1.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const g1 = saved.trips[0].data.days[0].items.find((i) => i.id === "g1");
    ok(g1.gmap === "", "クリック後、gmapが空文字列になる", g1.gmap);
    ok(g1.lat === null && g1.lon === null && g1.coordSrc === null, "coordSrc==='gmap'だった座標(lat/lon/coordSrc)もnullになる", g1);
  }

  /* ================================================================ */
  section("3. coordSrc==='geo'の座標はクリックしても消えない(handleGmapChangeの既存挙動の回帰確認)");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    const card3 = env.doc.querySelector("#timeline .item-card[data-id='g3']");
    const clearBtn3 = card3.querySelector(".item-gmap-clear-btn");
    clearBtn3.click();
    await tick();

    const saved = JSON.parse(env.store[STORAGE_KEY]);
    const g3 = saved.trips[0].data.days[0].items.find((i) => i.id === "g3");
    ok(g3.gmap === "", "クリック後、gmapは空文字列になる", g3.gmap);
    ok(g3.lat === 36.0 && g3.lon === 140.0 && g3.coordSrc === "geo", "coordSrc==='geo'だった座標は消えずに残る", g3);
  }

  /* ================================================================ */
  section("4. クリック後は入力欄が空で再描画され、ボタンも消える");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    let card1 = env.doc.querySelector("#timeline .item-card[data-id='g1']");
    card1.querySelector(".item-gmap-clear-btn").click();
    await tick();

    card1 = env.doc.querySelector("#timeline .item-card[data-id='g1']");
    const gmapInput = card1.querySelector(".item-gmap-input");
    ok(!!gmapInput && gmapInput.value === "", "再描画後、入力欄の値が空になっている", gmapInput && gmapInput.value);
    ok(!card1.querySelector(".item-gmap-clear-btn"), "再描画後、❌ボタンは消えている");
  }

  /* ================================================================ */
  section("5. トースト表示: クリック後にtoast.gmapClearedが表示される");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();

    const card1 = env.doc.querySelector("#timeline .item-card[data-id='g1']");
    card1.querySelector(".item-gmap-clear-btn").click();
    await tick();

    const expected = env.win.I18N.t("ja", "toast.gmapCleared");
    const toastEl = env.doc.querySelector("#toastContainer .toast");
    ok(!!toastEl && toastEl.textContent.indexOf(expected) !== -1, "クリック後にトースト「場所リンクを削除しました」が表示される", toastEl && toastEl.textContent);
  }

  /* ================================================================ */
  section("6. viewOnly(公開URL閲覧)では❌ボタンを表示しない");
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
              {
                id: "v1",
                cat: "sight",
                name: "京都駅",
                dur: 30,
                note: "",
                lat: 35.0,
                lon: 135.7,
                coordSrc: "gmap",
                gmap: "https://maps.google.com/maps?q=35.0,135.7"
              }
            ]
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

    const card = env.doc.querySelector("#timeline .item-card[data-id='v1']");
    ok(!!card, "公開データのカードが描画される");
    ok(!!card.querySelector(".item-gmap-input"), "gmap入力欄自体は表示される");
    ok(!card.querySelector(".item-gmap-clear-btn"), "viewOnlyでは❌ボタンが描画されない");
  }

  /* ================================================================ */
  section("7. 4言語の新規文字列");
  {
    const env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    const keys = ["timeline.gmapClearAria", "toast.gmapCleared"];
    ["ja", "en", "zh", "th"].forEach((L) => {
      keys.forEach((k) => {
        const v = env.win.I18N.t(L, k);
        ok(typeof v === "string" && v.length > 0 && v !== k, `${L}: ${k} が定義されている`, v);
      });
    });
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
