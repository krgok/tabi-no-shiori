/**
 * 位置解決（ジオコーディング）の誤マッチ防止（SPEC 6d 追記）:
 * 実ユーザーで発生した不具合「お食事処 味路喜」の位置解決で Nominatim が中国・南昌市の
 * 無関係な低品質マッチ（importance が極端に低い）を返し、地図に無関係な国のピンが立った件の修正検証。
 *
 * 1. 参照座標（東京周辺）があるとき、遠方（中国）の解決結果が不採用になり unresolved になる
 * 2. 近距離（参照から300km以内）の結果は採用される
 * 3. 参照座標ゼロのしおりでは従来通り採用される
 * 4. 飛行機移動があるしおり（バンコクと東京の両方に参照座標）で、成田近くの解決結果が
 *    正しく採用される（最も近い参照との距離で判定していることの確認）
 * 5. 地図更新（runMapUpdate）で coordSrc "geo" の遠方座標が再解決され、"gmap" 由来は触られない
 *
 * 実物の index.html / i18n.js / js/*.js を jsdom で読み込んで検証する（モックではなく実コード）。
 */
const { boot, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function sightItem(id, name, extra) {
  return Object.assign(
    {
      id: id, cat: "sight", name: name, loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null,
      priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {}, noteNames: {}
    },
    extra || {}
  );
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

// Nominatim/Places/その他への fetch をスタブする。nominatimByQuery は「q パラメータの値」→
// { lat, lon } | null のマップ。未登録のクエリは「該当なし」として空配列を返す
function makeFetchStub(nominatimByQuery, callLog) {
  return function (url, opts) {
    var urlStr = String(url);
    if (urlStr.indexOf("nominatim.openstreetmap.org") !== -1) {
      var m = /[?&]q=([^&]*)/.exec(urlStr);
      var q = m ? decodeURIComponent(m[1]) : "";
      callLog.push({ type: "osm", q: q });
      var hit = Object.prototype.hasOwnProperty.call(nominatimByQuery, q) ? nominatimByQuery[q] : null;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve(hit ? [{ lat: String(hit.lat), lon: String(hit.lon) }] : []);
        }
      });
    }
    if (urlStr.indexOf("places.googleapis.com") !== -1) {
      callLog.push({ type: "places", url: urlStr, body: opts && opts.body });
      return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
    }
    callLog.push({ type: "other", url: urlStr });
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  };
}

async function waitUntil(cond, timeoutMs, stepMs) {
  var waited = 0;
  stepMs = stepMs || 30;
  while (!cond() && waited < timeoutMs) {
    await new Promise(function (r) { setTimeout(r, stepMs); });
    waited += stepMs;
  }
  return cond();
}

// 東京駅（参照座標として使う）
const TOKYO = { lat: 35.6812, lon: 139.7671 };
// 実際に踏んだ不具合の再現座標: 中国・南昌市の無関係な施設（東京から約2100km）
const NANCHANG_CN = { lat: 28.7, lon: 115.9 };
// 東京から約100km（300km以内）: 水戸付近
const MITO = { lat: 36.3418, lon: 140.4468 };
// バンコク中心部（参照座標として使う）
const BANGKOK = { lat: 13.7563, lon: 100.5018 };
// 成田空港付近（東京から約65km・バンコクから約4600km）
const NARITA = { lat: 35.7647, lon: 140.3864 };

(async () => {
  /* ================================================================ */
  section("1. 参照座標あり・遠方(中国)の結果は不採用になりunresolvedになる");
  {
    const query = "お食事処 味路喜";
    const trip = tripData([
      dayWith("2026-08-01", [
        sightItem("ref-1", "東京駅", { lat: TOKYO.lat, lon: TOKYO.lon, coordSrc: "geo" }),
        sightItem("target-1", query)
      ])
    ]);
    const { win } = await boot({ localStorage: storeWith([entry("t1", trip)]) });

    const callLog = [];
    win.fetch = makeFetchStub({ [query]: NANCHANG_CN }, callLog);

    const day = win.trip.days[0];
    const target = day.items.find((it) => it.id === "target-1");
    const result = await win.resolveStopCoords(target, day);

    ok(result === null, "遠方の誤マッチは不採用になりnullが返る（APIキー無しなのでPlacesにも進めずunresolved）", result);
    ok(target.lat === null && target.lon === null, "不採用時、項目のlat/lonは書き込まれない", { lat: target.lat, lon: target.lon });
    ok(target.coordSrc === null, "不採用時、coordSrcも書き込まれない", target.coordSrc);
    ok(callLog.some((c) => c.type === "osm" && c.q === query), "Nominatimへは問い合わせている（前提確認）", callLog);
  }

  /* ================================================================ */
  section("2. 参照座標あり・近距離(300km以内)の結果は採用される");
  {
    const query = "たい焼き屋";
    const trip = tripData([
      dayWith("2026-08-01", [
        sightItem("ref-1", "東京駅", { lat: TOKYO.lat, lon: TOKYO.lon, coordSrc: "geo" }),
        sightItem("target-1", query)
      ])
    ]);
    const { win } = await boot({ localStorage: storeWith([entry("t2", trip)]) });

    const callLog = [];
    win.fetch = makeFetchStub({ [query]: MITO }, callLog);

    const day = win.trip.days[0];
    const target = day.items.find((it) => it.id === "target-1");
    const result = await win.resolveStopCoords(target, day);

    ok(result !== null && Math.abs(result.lat - MITO.lat) < 1e-6, "300km以内の結果は採用される", result);
    ok(target.lat === MITO.lat && target.lon === MITO.lon, "項目のlat/lonに反映される", { lat: target.lat, lon: target.lon });
    ok(target.coordSrc === "geo", "coordSrcはgeoになる", target.coordSrc);
  }

  /* ================================================================ */
  section("3. 参照座標ゼロのしおりでは従来通り採用される");
  {
    const query = "お食事処 味路喜";
    const trip = tripData([dayWith("2026-08-01", [sightItem("target-1", query)])]);
    const { win } = await boot({ localStorage: storeWith([entry("t3", trip)]) });

    const callLog = [];
    win.fetch = makeFetchStub({ [query]: NANCHANG_CN }, callLog);

    const day = win.trip.days[0];
    const target = day.items.find((it) => it.id === "target-1");
    const result = await win.resolveStopCoords(target, day);

    ok(
      result !== null && result.lat === NANCHANG_CN.lat && result.lon === NANCHANG_CN.lon,
      "参照座標が無いしおりでは判定材料が無いため従来通り採用される（ガードが働かない）",
      result
    );
    ok(target.coordSrc === "geo", "coordSrcはgeoになる", target.coordSrc);
  }

  /* ================================================================ */
  section("4. 飛行機移動(バンコク・東京の両方に参照座標)で成田近くの結果が正しく採用される");
  {
    const query = "成田空港";
    const trip = tripData([
      dayWith("2026-08-01", [sightItem("ref-bkk", "バンコク中心部", { lat: BANGKOK.lat, lon: BANGKOK.lon, coordSrc: "geo" })]),
      dayWith("2026-08-02", [
        sightItem("ref-tyo", "東京駅", { lat: TOKYO.lat, lon: TOKYO.lon, coordSrc: "geo" }),
        sightItem("target-1", query)
      ])
    ]);
    const { win } = await boot({ localStorage: storeWith([entry("t4", trip)]) });

    const callLog = [];
    win.fetch = makeFetchStub({ [query]: NARITA }, callLog);

    const day2 = win.trip.days[1];
    const target = day2.items.find((it) => it.id === "target-1");
    const result = await win.resolveStopCoords(target, day2);

    ok(
      result !== null && result.lat === NARITA.lat && result.lon === NARITA.lon,
      "バンコク参照からは遠くても、最も近い東京参照(約65km)との距離で合格し採用される",
      result
    );
    ok(target.coordSrc === "geo", "coordSrcはgeoになる", target.coordSrc);
  }

  /* ================================================================ */
  section("5. 地図更新でcoordSrc\"geo\"の遠方座標は再解決され、\"gmap\"由来は触られない");
  {
    const query = "お食事処 味路喜";
    const trip = tripData([
      dayWith("2026-08-01", [
        // gmap由来(ユーザーが貼ったリンク): たとえ他の座標から見て遠く見えても絶対に触らない対象。
        // ここでは通常の東京の座標にしておき、自己修復ガードで item2 を判定するときの参照にもなる
        sightItem("gmap-1", "浅草寺", { lat: 35.71, lon: 139.79, coordSrc: "gmap" }),
        // 過去にNominatimの誤マッチで保存されてしまった中国の座標（今回の不具合の再現データ）
        sightItem("geo-bad", query, { lat: NANCHANG_CN.lat, lon: NANCHANG_CN.lon, coordSrc: "geo" }),
        // 既に正しく解決済み・参照からも近いので触られないはずの項目
        sightItem("geo-ok", "上野公園", { lat: 35.7141, lon: 139.7744, coordSrc: "geo" })
      ])
    ]);
    const { win, doc } = await boot({ localStorage: storeWith([entry("t5", trip)]) });

    const newCoord = { lat: 35.72, lon: 139.8 };
    const callLog = [];
    win.fetch = makeFetchStub({ [query]: newCoord }, callLog);

    win.runMapUpdate();
    await waitUntil(() => {
      const it = win.trip.days[0].items.find((x) => x.id === "geo-bad");
      return it.lat !== NANCHANG_CN.lat;
    }, 5000, 50);
    // saveState/render を含む完了処理が確実に終わるまで少し待つ
    await new Promise((r) => setTimeout(r, 100));

    const gmapItem = win.trip.days[0].items.find((it) => it.id === "gmap-1");
    const badItem = win.trip.days[0].items.find((it) => it.id === "geo-bad");
    const okItem = win.trip.days[0].items.find((it) => it.id === "geo-ok");

    ok(
      gmapItem.lat === 35.71 && gmapItem.lon === 139.79 && gmapItem.coordSrc === "gmap",
      "gmap由来の座標は地図更新でも一切変更されない",
      gmapItem
    );
    ok(
      badItem.lat === newCoord.lat && badItem.lon === newCoord.lon && badItem.coordSrc === "geo",
      "coordSrc:geoの遠方(中国)座標は破棄され、妥当性ガードを通った新しい座標に再解決される",
      badItem
    );
    ok(
      okItem.lat === 35.7141 && okItem.lon === 139.7744 && okItem.coordSrc === "geo",
      "既に妥当なcoordSrc:geoの座標は自己修復の対象にならず変更されない",
      okItem
    );
    ok(
      callLog.filter((c) => c.type === "osm").length === 1,
      "Nominatimへの問い合わせは再解決が必要な1件分のみ（gmap由来・妥当な既存geoは問い合わせない）",
      callLog
    );

    const st = JSON.parse(win.localStorage.getItem(STORAGE_KEY));
    const savedTrip = st.trips.find((t) => t.id === st.currentId).data;
    const savedBad = savedTrip.days[0].items.find((it) => it.id === "geo-bad");
    ok(
      savedBad.lat === newCoord.lat && savedBad.lon === newCoord.lon,
      "自己修復の結果がlocalStorageにも保存される",
      savedBad
    );
    void doc;
  }

  const r = results();
  console.log("\n==== 合計: PASS=" + r.pass + " FAIL=" + r.fail + " ====");
  if (r.fail > 0) process.exitCode = 1;
})().catch((e) => {
  console.log("ERR", e.stack);
  process.exitCode = 1;
});
