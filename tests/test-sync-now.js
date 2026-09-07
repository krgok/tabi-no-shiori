/**
 * 「今すぐ同期」（新機能）検証ハーネス
 * - 🔄ボタンの表示条件（renderSyncStatus と同じ: ログイン済み・firebaseReady・viewOnlyでない・collabModeでない）
 * - クリック: デバウンス中の未送信を即時反映してからクラウドとマージする
 * - 前面復帰(visibilitychange visible)・オンライン復帰(online)時の自動同期。30秒以内の連続実行は無視する
 * - 前面離脱(visibilitychange hidden)・pagehide時の未送信データの即時送信（閉じる直前の対策）
 * - 位置が特定できなかった項目のうち短縮リンク由来のものがあるときのトースト案内文言
 *
 * 実物の index.html / i18n.js / js/*.js を jsdom で読み込んで検証する（モックではなく実コード）。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const USER = { uid: "uid-owner", email: "owner@example.com", displayName: "Owner" };

function sightItem(id, name, extra) {
  return Object.assign(
    {
      id: id, cat: "sight", name: name, loc: "", dur: 30, note: "", lat: null, lon: null,
      coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false,
      names: {}, noteNames: {}
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

function entry(id, data, extra) {
  return Object.assign(
    { id: id, data: data, archived: false, cloudId: null, updatedAt: 1, publicId: null, editId: null },
    extra || {}
  );
}

// document.visibilityState は jsdom では書き換え不可のスロット実装のため、プロパティごと再定義する
function setVisibilityState(doc, value) {
  Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => value });
}

// 位置解決チェーン（resolveStopCoords）は複数の.thenを経由するため、条件が満たされるまで
// 実時間でポーリングする（test-geocode-sanity.jsと同じ方式）
async function waitUntil(cond, timeoutMs, stepMs) {
  var waited = 0;
  stepMs = stepMs || 30;
  while (!cond() && waited < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    waited += stepMs;
  }
  return cond();
}

// Nominatim/Places への fetch をスタブする。nominatimByQuery に無いクエリは「該当なし」を返す
function makeNotFoundFetchStub(callLog) {
  return function (url) {
    var urlStr = String(url);
    if (urlStr.indexOf("nominatim.openstreetmap.org") !== -1) {
      callLog.push({ type: "osm", url: urlStr });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    }
    if (urlStr.indexOf("places.googleapis.com") !== -1) {
      callLog.push({ type: "places", url: urlStr });
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    }
    callLog.push({ type: "other", url: urlStr });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

(async () => {
  /* ================================================================ */
  section("1. 🔄ボタンの表示条件（未ログインでは隠れ、ログインで表示される）");
  {
    const env = boot({ localStorage: storeWith([entry("t1", tripData([dayWith("2026-08-01", [sightItem("a1", "A")])]), { cloudId: "C1" })]) });
    await tick();
    const btn = env.doc.getElementById("syncNowBtn");
    ok(!!btn, "🔄ボタンの要素がある");
    ok(btn.classList.contains("hidden"), "未ログインでは隠れている");

    env.fb.login(USER);
    await tick();
    ok(!btn.classList.contains("hidden"), "ログインすると表示される");
    ok(btn.getAttribute("aria-label") === "今すぐ同期", "aria-labelが日本語で設定される（data-i18n-aria）", btn.getAttribute("aria-label"));
  }

  /* ================================================================ */
  section("2. クリック: デバウンス中の未送信を即時反映してからクラウドとマージする");
  {
    const env = boot({ localStorage: storeWith([entry("t2", tripData([dayWith("2026-08-01", [sightItem("a1", "A")])]), { cloudId: "C2" })]) });
    await tick();
    const doc = env.doc;
    const btn = doc.getElementById("syncNowBtn");

    env.fb.login(USER);
    await tick(); // ログイン直後の runCloudMerge が1回走って収まるのを待つ

    // 何か編集してデバウンス（2秒）中の未送信を作る
    const note = doc.querySelector("#timeline .item-card .item-note");
    note.value = "編集した";
    note.dispatchEvent(new env.win.Event("change"));
    ok(env.win.cloudSyncTimer !== null, "編集直後はデバウンスタイマーが残っている（前提確認）");

    const callsBefore = env.fb.calls.length;
    btn.click();

    const newCalls = env.fb.calls.slice(callsBefore);
    const setCall = newCalls.find((c) => c.op === "set" && c.coll === "trips" && c.id === "C2");
    ok(!!setCall, "クリックでデバウンス中の書き込みが即時に送られる（cloudUpsertEntry）", newCalls);
    ok(env.win.cloudSyncTimer === null, "即時送信後、デバウンスタイマーは解除される");

    const queryCall = newCalls.find((c) => c.op === "query" && c.coll === "trips");
    ok(!!queryCall, "続けてクラウドとのマージ（where().get()）が呼ばれる", newCalls);

    await tick();
    ok(!btn.classList.contains("is-syncing"), "同期完了後はis-syncingクラスが外れる");
    ok(!btn.disabled, "同期完了後はdisabledが解除される");
  }

  /* ================================================================ */
  section("3. 前面復帰(visibilitychange visible)・オンライン復帰時の自動同期。30秒以内の連続実行は無視する");
  {
    const env = boot({ localStorage: storeWith([entry("t3", tripData([dayWith("2026-08-01", [sightItem("a1", "A")])]), { cloudId: "C3" })]) });
    await tick();
    const doc = env.doc;

    env.fb.login(USER);
    await tick(); // ログイン直後の runCloudMerge が収まるのを待つ

    const callsBefore = env.fb.calls.length;
    setVisibilityState(doc, "visible");
    doc.dispatchEvent(new env.win.Event("visibilitychange"));
    let newCalls = env.fb.calls.slice(callsBefore);
    ok(newCalls.some((c) => c.op === "query" && c.coll === "trips"), "前面復帰で自動的にクラウドとマージされる（静かに、トーストは出さない）");
    await tick(); // cloudMergeInProgress が解除されるのを待つ

    // 直後にもう一度visibleになっても、30秒以内なので何もしない
    const callsBefore2 = env.fb.calls.length;
    doc.dispatchEvent(new env.win.Event("visibilitychange"));
    await tick();
    let newCalls2 = env.fb.calls.slice(callsBefore2);
    ok(!newCalls2.some((c) => c.op === "query" && c.coll === "trips"), "30秒以内の2回目は自動同期が走らない（連打防止）", newCalls2);

    // 30秒以上前に自動同期したことにする（最終実行時刻を直接操作）と、次はまた走る
    env.win.lastAutoSyncAt = Date.now() - 40000;
    const callsBefore3 = env.fb.calls.length;
    doc.dispatchEvent(new env.win.Event("visibilitychange"));
    await tick();
    let newCalls3 = env.fb.calls.slice(callsBefore3);
    ok(newCalls3.some((c) => c.op === "query" && c.coll === "trips"), "30秒以上経てば自動同期が再び走る");
    await tick();

    // online イベントでも同様に自動同期が走る（間隔が空いていれば）
    env.win.lastAutoSyncAt = Date.now() - 40000;
    const callsBefore4 = env.fb.calls.length;
    env.win.dispatchEvent(new env.win.Event("online"));
    await tick();
    let newCalls4 = env.fb.calls.slice(callsBefore4);
    ok(newCalls4.some((c) => c.op === "query" && c.coll === "trips"), "オンライン復帰でも自動同期が走る");
  }

  /* ================================================================ */
  section("4. 前面離脱(visibilitychange hidden)・pagehideで未送信データが即時送信される");
  {
    const env = boot({ localStorage: storeWith([entry("t4", tripData([dayWith("2026-08-01", [sightItem("a1", "A")])]), { cloudId: "C4" })]) });
    await tick();
    const doc = env.doc;

    env.fb.login(USER);
    await tick();

    // 4a: visibilitychange(hidden)
    let note = doc.querySelector("#timeline .item-card .item-note");
    note.value = "編集A";
    note.dispatchEvent(new env.win.Event("change"));
    ok(env.win.cloudSyncTimer !== null, "編集直後はデバウンスタイマーが残っている（前提確認）");

    let callsBefore = env.fb.calls.length;
    setVisibilityState(doc, "hidden");
    doc.dispatchEvent(new env.win.Event("visibilitychange"));
    let newCalls = env.fb.calls.slice(callsBefore);
    ok(newCalls.some((c) => c.op === "set" && c.coll === "trips" && c.id === "C4"), "前面離脱(hidden)で未送信のデバウンス書き込みが即時送信される", newCalls);
    ok(env.win.cloudSyncTimer === null, "即時送信後、デバウンスタイマーは解除される");
    setVisibilityState(doc, "visible");

    // 4b: pagehide
    note = doc.querySelector("#timeline .item-card .item-note");
    note.value = "編集B";
    note.dispatchEvent(new env.win.Event("change"));
    ok(env.win.cloudSyncTimer !== null, "再度編集した直後はデバウンスタイマーが残っている（前提確認）");

    callsBefore = env.fb.calls.length;
    env.win.dispatchEvent(new env.win.Event("pagehide"));
    newCalls = env.fb.calls.slice(callsBefore);
    ok(newCalls.some((c) => c.op === "set" && c.coll === "trips" && c.id === "C4"), "pagehideでも未送信のデバウンス書き込みが即時送信される", newCalls);
    ok(env.win.cloudSyncTimer === null, "pagehide後もデバウンスタイマーは解除される");
  }

  /* ================================================================ */
  section("5. 位置が特定できなかった項目のうち短縮リンク由来のものがあるときの案内トースト");
  {
    // 5a: 短縮リンク(maps.app.goo.gl)の項目が未解決 -> ヒント文言が付く
    const tripA = tripData([
      dayWith("2026-08-01", [sightItem("s1", "謎のホテル", { gmap: "https://maps.app.goo.gl/abcXYZ" })])
    ]);
    const envA = boot({ localStorage: storeWith([entry("ta", tripA)]) });
    await tick();
    const callLogA = [];
    envA.win.fetch = makeNotFoundFetchStub(callLogA);
    const toastsA = [];
    envA.win.showToast = (msg, type) => toastsA.push({ msg, type });

    envA.win.runMapUpdate();
    await waitUntil(() => toastsA.length > 0, 5000, 50);

    ok(toastsA.length > 0, "位置未解決のトーストが出る（前提確認）", toastsA);
    const errToastA = toastsA.find((x) => x.type === "error");
    ok(!!errToastA, "見つからなかった場所のトースト(error)が出る", toastsA);
    ok(errToastA && errToastA.msg.indexOf("見つからなかった場所") !== -1, "本文に既存の見つからなかった場所メッセージが含まれる", errToastA);
    ok(errToastA && errToastA.msg.indexOf("短縮リンク") !== -1, "短縮リンク項目が含まれる場合はヒント文言が付く", errToastA && errToastA.msg);

    // 5b: 短縮リンクではないフルURLの項目だけが未解決 -> ヒント文言は付かない
    const tripB = tripData([
      dayWith("2026-08-01", [sightItem("s2", "謎のレストラン", { gmap: "https://www.google.com/maps/place/Somewhere/@35.0,139.0,17z" })])
    ]);
    const envB = boot({ localStorage: storeWith([entry("tb", tripB)]) });
    await tick();
    const callLogB = [];
    envB.win.fetch = makeNotFoundFetchStub(callLogB);
    const toastsB = [];
    envB.win.showToast = (msg, type) => toastsB.push({ msg, type });

    envB.win.runMapUpdate();
    await waitUntil(() => toastsB.length > 0, 5000, 50);

    const errToastB = toastsB.find((x) => x.type === "error");
    ok(!!errToastB, "こちらも見つからなかった場所のトースト(error)が出る（前提確認）", toastsB);
    ok(errToastB && errToastB.msg.indexOf("短縮リンク") === -1, "短縮リンクではないフルURLの未解決項目だけのときはヒント文言が付かない", errToastB && errToastB.msg);
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e.stack || e);
  process.exit(1);
});
