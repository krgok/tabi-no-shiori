/**
 * APIキー未設定時の案内トースト（3c/6e 追記）検証テスト
 * 実物の index.html / i18n.js / app.js を jsdom で読み込んで検証する。
 * harness.js の既定 fetch スタブは常に { ok:false, status:500 } を返すため、
 * OSM/Places/Translation いずれも「成功しない」状態になる（APIキーが無い状況の再現に十分）。
 * 403/400（未有効化）系のシナリオだけ専用の fetch スタブに差し替える。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";

function sightItem(id, name, extra) {
  return Object.assign(
    {
      id, cat: "sight", name, loc: "", dur: 30, note: "", lat: null, lon: null, coordSrc: null,
      priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false, names: {}, noteNames: {}
    },
    extra || {}
  );
}
function moveItem(id, name, extra) {
  return Object.assign(
    {
      id, cat: "move", name, loc: "", dur: 10, note: "", lat: null, lon: null, coordSrc: null,
      priv: false, notePriv: false, fixedStart: null, mode: "car", distKm: null, auto: false,
      approx: false, unresolved: false, arriveTz: "", names: {}, noteNames: {}
    },
    extra || {}
  );
}
function day(id, items, extra) {
  return Object.assign({ id, date: "2026-08-01", startTime: "09:00", tz: "", priv: false, dateManual: false, items }, extra || {});
}
function baseTrip(days, extra) {
  return Object.assign(
    { v: 1, title: "旅", titles: { ja: "旅" }, lang: "ja", days, packing: [], todos: [], packingPriv: false, todosPriv: false },
    extra || {}
  );
}
function fixtureStore(trip) {
  return {
    [STORAGE_KEY]: JSON.stringify({
      currentId: "loc1",
      trips: [{ id: "loc1", data: trip, archived: false }]
    })
  };
}

// noKeyNotice トーストだけを抽出する（i18n文字列そのものを実行時に引いて比較する）
function noKeyToasts(win, doc, targetLang) {
  const expected = win.I18N.t(targetLang, "toast.noKeyNotice");
  return [...doc.querySelectorAll("#toastContainer .toast")].filter((t) => t.textContent.trim() === expected);
}

(async () => {
  /* ================================================================ */
  section("1. キー未設定 + 未翻訳のmove/メモあり + 言語切替 → 案内トーストがちょうど1回");
  {
    const trip = baseTrip([
      day("d1", [
        sightItem("s1", "浅草寺", { note: "雷門で写真", names: { en: "Sensoji Temple" } }), // names.en済み・noteは未翻訳
        moveItem("m1", "浅草寺 → 上野", { note: "" }) // move名は未翻訳（OSM/Placesはそもそも呼ばない）
      ])
    ]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    const toasts = noKeyToasts(env.win, env.doc, "en");
    ok(toasts.length === 1, "案内トーストがちょうど1回表示される", toasts.length);
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
  }

  /* ================================================================ */
  section("2. APIキー設定済み → 案内トーストは出ない");
  {
    const trip = baseTrip([
      day("d1", [
        sightItem("s1", "浅草寺", { note: "雷門で写真" }),
        moveItem("m1", "浅草寺 → 上野", { note: "" })
      ])
    ]);
    const env = boot({ localStorage: Object.assign({ "tabi-gmaps-key": "test-key-xyz" }, fixtureStore(trip)) });
    await tick();
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    const toasts = noKeyToasts(env.win, env.doc, "en");
    ok(toasts.length === 0, "APIキーがあれば案内トーストは出ない", toasts.length);
  }

  /* ================================================================ */
  section("3. 全項目翻訳済み（対象0件）→ 出ない");
  {
    const trip = baseTrip(
      [
        day("d1", [
          sightItem("s1", "浅草寺", { note: "雷門で写真", names: { en: "Sensoji Temple" }, noteNames: { en: "Photo at Kaminarimon" } })
        ])
      ],
      { titles: { ja: "旅", en: "Trip" } } // タイトルも翻訳済み
    );
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    const toasts = noKeyToasts(env.win, env.doc, "en");
    ok(toasts.length === 0, "翻訳対象が無ければ案内トーストは出ない", toasts.length);
  }

  /* ================================================================ */
  section("4. ja へ切替 → 出ない");
  {
    const trip = baseTrip([
      day("d1", [
        sightItem("s1", "Sensoji Temple", { note: "Photo at Kaminarimon" }),
        moveItem("m1", "Sensoji Temple -> Ueno", { note: "" })
      ], {}),
    ], { lang: "en", titles: { ja: "旅" } });
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "ja";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    const toasts = noKeyToasts(env.win, env.doc, "ja");
    ok(toasts.length === 0, "ja へ切替では案内トーストは出ない", toasts.length);
  }

  /* ================================================================ */
  section("5. 連続で言語切替 → その都度1回ずつ（累積しない）");
  {
    const trip = baseTrip([
      day("d1", [
        sightItem("s1", "浅草寺", { note: "雷門で写真" }),
        moveItem("m1", "浅草寺 → 上野", { note: "" })
      ])
    ]);
    const env = boot({ localStorage: fixtureStore(trip) });
    await tick();
    const langSel = env.doc.getElementById("langSelect");

    // 進捗トースト（スポット名取得中…）等、案内トースト以外のトーストも表示されうるため、
    // 「総トースト数」ではなく noKeyNotice のテキストに一致するものだけを言語別にカウントして
    // 累積（1回の切替につき1回だけ増える）ことを確認する
    const cumulative = () =>
      noKeyToasts(env.win, env.doc, "en").length +
      noKeyToasts(env.win, env.doc, "zh").length +
      noKeyToasts(env.win, env.doc, "ja").length +
      noKeyToasts(env.win, env.doc, "th").length;

    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    ok(noKeyToasts(env.win, env.doc, "en").length === 1, "1回目の切替(en)で1回", noKeyToasts(env.win, env.doc, "en").length);
    ok(cumulative() === 1, "累積件数が1", cumulative());

    langSel.value = "zh";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    ok(noKeyToasts(env.win, env.doc, "zh").length === 1, "2回目の切替(zh)でもちょうど1回（新規）", noKeyToasts(env.win, env.doc, "zh").length);
    ok(cumulative() === 2, "累積件数が2（1回目のen用+2回目のzh用、多重生成なし）", cumulative());

    langSel.value = "ja";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    ok(cumulative() === 2, "ja切替では増えない（累積しない）", cumulative());

    langSel.value = "th";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    ok(noKeyToasts(env.win, env.doc, "th").length === 1, "3回目の切替(th)でもちょうど1回（新規）", noKeyToasts(env.win, env.doc, "th").length);
    ok(cumulative() === 3, "都度1回ずつ増える（3回の非ja切替で合計3）", cumulative());
  }

  /* ================================================================ */
  section("6. 既存の Places/Translation 未有効トーストと混ざって多重に出ないこと（キーはあるが未有効化）");
  {
    const trip = baseTrip([
      day("d1", [
        sightItem("s1", "浅草寺", { note: "雷門で写真" }),
        moveItem("m1", "浅草寺 → 上野", { note: "" })
      ])
    ]);
    const env = boot({ localStorage: Object.assign({ "tabi-gmaps-key": "test-key-xyz" }, fixtureStore(trip)) });
    // APIキーはあるが、Places/Translationともに403（未有効化）を返すスタブに差し替える
    env.win.fetch = function (url) {
      const urlStr = String(url);
      if (urlStr.indexOf("nominatim.openstreetmap.org") !== -1) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
    };
    await tick();
    const langSel = env.doc.getElementById("langSelect");
    langSel.value = "en";
    langSel.dispatchEvent(new env.win.Event("change"));
    await tick();
    await tick();
    const noKey = noKeyToasts(env.win, env.doc, "en");
    const translateNotEnabled = [...env.doc.querySelectorAll("#toastContainer .toast")].filter(
      (t) => t.textContent.trim() === env.win.I18N.t("en", "toast.translateApiNotEnabled")
    );
    ok(noKey.length === 0, "キーがある(未有効化)場合はAPIキー未設定案内は出ない", noKey.length);
    ok(translateNotEnabled.length === 1, "Translation API未有効化トーストが1回だけ出る", translateNotEnabled.length);
  }

  console.log("\n================================");
  const r = results();
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exitCode = 1; });
