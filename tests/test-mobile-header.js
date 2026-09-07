/**
 * モバイルヘッダー簡略化の検証ハーネス。
 * iPhoneで開くとヘッダー（タイトル・ツールバー・日タブ・日の設定）が画面の半分近くを占め、
 * 行程が見にくいというユーザー報告への対応。日の設定(.day-meta)をトグルで折りたたみ（既定は閉）、
 * 開閉状態は localStorage に保存する。CSSでの表示切り替え自体（幅による出し分け）は jsdom に
 * matchMedia が無いため検証できないので、ここでは「クラスの付け外し・要約テキスト・
 * localStorageへの保存・4言語でのaria-label」という、JS側が担う部分を確認する
 * （実物の index.html / i18n.js / app.js を jsdom で読み込む方式は他のテストと同じ）。
 */
const { boot, tick, ok, section, results } = require("./harness");

const STORAGE_KEY = "tabi-shiori-v2";
const DAYMETA_OPEN_KEY = "tabi-shiori-daymeta-open";

function fixtureTrip() {
  return {
    v: 1,
    title: "テスト旅行",
    titles: { ja: "テスト旅行" },
    lang: "ja",
    days: [
      {
        id: "d1",
        date: "2026-09-08",
        startTime: "06:00",
        tz: "",
        priv: false,
        dateManual: false,
        items: []
      },
      {
        id: "d2",
        date: "2026-09-09",
        startTime: "09:00",
        tz: "",
        priv: false,
        dateManual: false,
        items: []
      }
    ],
    packing: [],
    todos: []
  };
}

function fixtureStore(trip, extra) {
  return Object.assign(
    {
      [STORAGE_KEY]: JSON.stringify({
        currentId: "t1",
        trips: [{ id: "t1", data: trip, archived: false, cloudId: null, updatedAt: 1000, publicId: null }]
      })
    },
    extra || {}
  );
}

(async () => {
  /* ================================================================ */
  section("1. 初期状態: トグルは存在し、既定で閉");
  let env, toggle, meta;
  {
    env = boot({ localStorage: fixtureStore(fixtureTrip()) });
    await tick();
    toggle = env.doc.getElementById("dayMetaToggle");
    meta = env.doc.getElementById("dayMeta");

    ok(!!toggle, "#dayMetaToggle が存在する");
    ok(!!meta, "#dayMeta (.day-meta) が存在する");
    ok(toggle.getAttribute("aria-controls") === "dayMeta", "aria-controlsがdayMetaを指す", toggle.getAttribute("aria-controls"));
    ok(!meta.classList.contains("is-open"), "初期状態では.is-openが付いていない（既定は閉）");
    ok(toggle.getAttribute("aria-expanded") === "false", "初期状態のaria-expandedはfalse", toggle.getAttribute("aria-expanded"));
    ok(env.store[DAYMETA_OPEN_KEY] === undefined, "初期状態ではlocalStorageにまだ何も書かれていない");
  }

  /* ================================================================ */
  section("2. クリックで開く → .is-open / aria-expanded / localStorage が揃って変わる");
  {
    toggle.click();
    ok(meta.classList.contains("is-open"), "クリック後は.is-openが付く");
    ok(toggle.getAttribute("aria-expanded") === "true", "クリック後のaria-expandedはtrue", toggle.getAttribute("aria-expanded"));
    ok(env.store[DAYMETA_OPEN_KEY] === "1", "localStorageに開状態(1)が保存される", env.store[DAYMETA_OPEN_KEY]);
  }

  /* ================================================================ */
  section("3. 再クリックで閉じる → 元に戻る");
  {
    toggle.click();
    ok(!meta.classList.contains("is-open"), "再クリック後は.is-openが外れる");
    ok(toggle.getAttribute("aria-expanded") === "false", "再クリック後のaria-expandedはfalse", toggle.getAttribute("aria-expanded"));
    ok(env.store[DAYMETA_OPEN_KEY] === "0", "localStorageに閉状態(0)が保存される", env.store[DAYMETA_OPEN_KEY]);
  }

  /* ================================================================ */
  section("4. 要約テキストに日付・開始時刻・tz未設定文言が含まれる");
  {
    const noneLabel = env.win.I18N.t("ja", "day.tzNone");
    const txt = toggle.textContent;
    ok(txt.indexOf("2026/09/08") !== -1, "日付が含まれる(2026/09/08)", txt);
    ok(txt.indexOf("6:00") !== -1, "開始時刻が含まれる(6:00、先頭ゼロなし)", txt);
    ok(txt.indexOf(noneLabel) !== -1, "tz未設定の文言(day.tzNone)が含まれる", txt);
    ok(txt.indexOf("▸") !== -1, "閉じているときは末尾が▸", txt);
  }

  /* ================================================================ */
  section("5. タイムゾーンを変更すると要約に反映される");
  {
    const tzSelect = env.doc.getElementById("dayTzSelect");
    tzSelect.value = "Asia/Tokyo";
    tzSelect.dispatchEvent(new env.win.Event("change"));
    await tick();
    ok(toggle.textContent.indexOf("Asia/Tokyo") !== -1, "tz変更後の要約にAsia/Tokyoが含まれる", toggle.textContent);
  }

  /* ================================================================ */
  section("6. 日を切り替えると要約がその日の内容に変わる");
  {
    const tab2 = env.doc.querySelector('#dayTabs .day-tab[data-index="1"]');
    ok(!!tab2, "2つ目の日タブが存在する");
    tab2.click();
    ok(toggle.textContent.indexOf("2026/09/09") !== -1, "Day2の日付(2026/09/09)に切り替わる", toggle.textContent);
    ok(toggle.textContent.indexOf("9:00") !== -1, "Day2の開始時刻(9:00)に切り替わる", toggle.textContent);
  }

  /* ================================================================ */
  section("7. #shareBtn / #textioBtn の aria-label が4言語すべてで存在する");
  {
    const langSel = env.doc.getElementById("langSelect");
    ["ja", "en", "zh", "th"].forEach((L) => {
      langSel.value = L;
      langSel.dispatchEvent(new env.win.Event("change"));
      const shareBtn = env.doc.getElementById("shareBtn");
      const textioBtn = env.doc.getElementById("textioBtn");
      const expectedShare = env.win.I18N.t(L, "header.share");
      const expectedTextio = env.win.I18N.t(L, "header.textio");
      ok(
        shareBtn.getAttribute("aria-label") === expectedShare,
        "[" + L + "] #shareBtn の aria-label が翻訳と一致",
        shareBtn.getAttribute("aria-label")
      );
      ok(
        textioBtn.getAttribute("aria-label") === expectedTextio,
        "[" + L + "] #textioBtn の aria-label が翻訳と一致",
        textioBtn.getAttribute("aria-label")
      );
      // アイコン化してもボタン内の可視テキスト（.btn-label）は言語切替で正しく更新される
      ok(
        shareBtn.querySelector(".btn-label").textContent === expectedShare,
        "[" + L + "] #shareBtn の .btn-label テキストも翻訳と一致",
        shareBtn.querySelector(".btn-label").textContent
      );
    });
  }

  /* ================================================================ */
  section("8. コンソールエラーが無い");
  {
    ok(env.errors.length === 0, "コンソールエラーが無い", env.errors);
  }

  console.log("\n=== 結果 ===");
  const r = results();
  console.log(`PASS=${r.pass} FAIL=${r.fail}`);
  process.exit(r.fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
