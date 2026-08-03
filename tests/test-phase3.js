/**
 * Phase3 の検証
 * - 出発カウントダウン（未来 / 当日 / 過去 / 日付なし）
 * - しおりの複製（共有・編集リンクを引き継がないこと）
 * - 上下移動と日跨ぎ移動
 * - クラウド同期の状態表示
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const USER = { uid: "uid-owner", email: "owner@example.com", displayName: "Owner" };

function sightItem(id, name) {
  return {
    id: id, cat: "sight", name: name, loc: "", dur: 30, note: "", lat: null, lon: null,
    coordSrc: null, priv: false, notePriv: false, fixedStart: null, gmap: "", gmapAuto: false,
    names: {}, noteNames: {}
  };
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

// 今日から n 日後の "YYYY-MM-DD"
function dateOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

(async () => {
  /* ================================================================ */
  section("1. 出発カウントダウン");
  {
    const cases = [
      ["32日後", dateOffset(32), "あと 32 日", false],
      ["当日", dateOffset(0), "いよいよ今日！", false],
      ["過去", dateOffset(-5), "", true],
      ["日付なし", "", "", true]
    ];
    for (const [label, date, expectText, expectHidden] of cases) {
      const env = boot({ localStorage: storeWith([entry("t1", tripData([dayWith(date, [sightItem("a1", "A")])]))]) });
      await tick();
      const cd = env.doc.getElementById("tripCountdown");
      ok(!!cd, label + ": カウントダウン要素がある");
      ok(cd.classList.contains("hidden") === expectHidden, label + ": 表示/非表示が正しい", cd.classList.contains("hidden"));
      if (!expectHidden) ok(cd.textContent === expectText, label + ": 文言", cd.textContent);
    }
  }

  section("1b. カウントダウンの4言語");
  {
    const env = boot({ localStorage: storeWith([entry("t1", tripData([dayWith(dateOffset(10), [sightItem("a1", "A")])]))]) });
    await tick();
    const expect = { ja: "あと 10 日", en: "10 days to go", zh: "还有 10 天", th: "อีก 10 วัน" };
    for (const lang of ["ja", "en", "zh", "th"]) {
      const sel = env.doc.getElementById("langSelect");
      sel.value = lang;
      sel.dispatchEvent(new env.win.Event("change", { bubbles: true }));
      await tick();
      ok(env.doc.getElementById("tripCountdown").textContent === expect[lang], lang + ": カウントダウン文言", env.doc.getElementById("tripCountdown").textContent);
    }
  }

  /* ================================================================ */
  section("2. しおりの複製");
  {
    const env = boot({
      localStorage: storeWith([
        entry("t1", tripData([dayWith("2026-07-24", [sightItem("a1", "浅草寺"), sightItem("a2", "上野")])]), {
          cloudId: "CLOUD1", publicId: "PUB1", editId: "EDIT1"
        })
      ])
    });
    await tick();
    const doc = env.doc;
    doc.getElementById("tripsBtn").click();
    const dup = doc.querySelector(".trip-list-item-duplicate");
    ok(!!dup, "しおり一覧に複製ボタンがある");
    dup.click();
    await tick();

    const st = JSON.parse(env.store[STORAGE_KEY]);
    ok(st.trips.length === 2, "しおりが2件になる", st.trips.length);
    const copy = st.trips[1];
    const orig = st.trips[0];
    ok(copy.data.days[0].items.length === orig.data.days[0].items.length, "項目がすべて複製される");
    ok(copy.data.days[0].items[0].name === "浅草寺", "中身が同じ");
    ok(copy.publicId === null, "共有リンク(publicId)は引き継がない（元の共有先に混ざらない）");
    ok(copy.editId === null, "編集リンク(editId)は引き継がない");
    ok(copy.cloudId === null, "cloudId は引き継がない（新規ドキュメントとして作られる）");
    ok(orig.publicId === "PUB1", "元のしおりの共有リンクは無傷");
    ok(st.currentId === copy.id, "複製したしおりに切り替わる");
    ok(copy.data.title === "テスト旅行 のコピー", "タイトルに「のコピー」が付く", copy.data.title);
  }

  /* ================================================================ */
  section("3. 上下移動（同じ日の中）");
  {
    const env = boot({
      localStorage: storeWith([
        entry("t1", tripData([dayWith("2026-07-24", [sightItem("a1", "A"), sightItem("a2", "B"), sightItem("a3", "C")])]))
      ])
    });
    await tick();
    const doc = env.doc;
    const ids = () => JSON.parse(env.store[STORAGE_KEY]).trips[0].data.days[0].items.map((i) => i.id);

    // 2番目を上へ
    doc.querySelectorAll("#timeline .item-card")[1].querySelectorAll(".item-nudge")[0].click();
    await tick();
    ok(ids().join(",") === "a2,a1,a3", "上へ移動で入れ替わる", ids());

    // 1番目（現在a2）を下へ
    doc.querySelectorAll("#timeline .item-card")[0].querySelectorAll(".item-nudge")[1].click();
    await tick();
    ok(ids().join(",") === "a1,a2,a3", "下へ移動で戻る", ids());

    // 先頭で「上へ」は隣の日が無いので何も起きない
    doc.querySelectorAll("#timeline .item-card")[0].querySelectorAll(".item-nudge")[0].click();
    await tick();
    ok(ids().join(",") === "a1,a2,a3", "1日しか無いとき先頭で上へ押しても変化しない", ids());
  }

  /* ================================================================ */
  section("4. 日跨ぎ移動");
  {
    const env = boot({
      localStorage: storeWith([
        entry("t1", tripData([
          dayWith("2026-07-24", [sightItem("a1", "A"), sightItem("a2", "B")]),
          dayWith("2026-07-25", [sightItem("b1", "C")])
        ]))
      ])
    });
    await tick();
    const doc = env.doc;
    const days = () => JSON.parse(env.store[STORAGE_KEY]).trips[0].data.days;

    // Day1の末尾を下へ → Day2の先頭へ
    const cards = doc.querySelectorAll("#timeline .item-card");
    cards[cards.length - 1].querySelectorAll(".item-nudge")[1].click();
    await tick();
    let d = days();
    ok(d[0].items.length === 1, "Day1が1件になる", d[0].items.length);
    ok(d[1].items.length === 2, "Day2が2件になる", d[1].items.length);
    ok(d[1].items[0].id === "a2", "Day2の先頭に入る", d[1].items.map((i) => i.id));
    const activeIdx = [...doc.querySelectorAll(".day-tab")].findIndex((t) => t.classList.contains("active"));
    ok(activeIdx === 1, "表示中の日が移動先に追従する", activeIdx);

    // Day2の先頭を上へ → Day1の末尾へ戻る
    doc.querySelectorAll("#timeline .item-card")[0].querySelectorAll(".item-nudge")[0].click();
    await tick();
    d = days();
    ok(d[0].items.length === 2 && d[0].items[1].id === "a2", "上へでDay1の末尾に戻る", d[0].items.map((i) => i.id));
  }

  /* ================================================================ */
  section("5. クラウド同期の状態表示");
  {
    const env = boot({ localStorage: storeWith([entry("t1", tripData([dayWith("2026-07-24", [sightItem("a1", "A")])]), { cloudId: "C1" })]) });
    await tick();
    const doc = env.doc;
    const status = doc.getElementById("syncStatus");
    ok(!!status, "同期状態の要素がある");
    ok(status.classList.contains("hidden"), "未ログインでは何も出さない");

    env.fb.login(USER);
    await tick();
    // 何か編集して同期を走らせる
    const note = doc.querySelector("#timeline .item-card .item-note");
    note.value = "編集";
    note.dispatchEvent(new env.win.Event("change"));
    await tick(2600);
    ok(!status.classList.contains("hidden"), "ログイン中は同期状態が表示される");
    ok(/保存済み/.test(status.textContent), "保存済みの表示になる", status.textContent);
  }

  const r = results();
  console.log("\n================================");
  console.log("PASS: " + r.pass + "   FAIL: " + r.fail);
  console.log("================================");
  process.exitCode = r.fail > 0 ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
